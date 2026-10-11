import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { config } from "../config.js";
import { AppError, notConfigured } from "./errors.js";
import { logger } from "./logger.js";

export const CLAUDE_MODEL = "claude-opus-5-5";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!config.ANTHROPIC_API_KEY) throw notConfigured("AI features (ANTHROPIC_API_KEY)");
  client ??= new Anthropic({ apiKey: config.ANTHROPIC_API_KEY, timeout: 60_000, maxRetries: 1 });
  return client;
}

type ParseParams = Parameters<Anthropic["beta"]["messages"]["parse"]>[0];
type ParsedResponse = Awaited<ReturnType<Anthropic["beta"]["messages"]["parse"]>>;

/** The single raw call site (tests stub `ai.call`). */
export const ai = {
  isConfigured: () => !!config.ANTHROPIC_API_KEY,
  call: (params: ParseParams): Promise<ParsedResponse> => getClient().beta.messages.parse(params),
};

const unavailable = (msg = "The AI assistant is unavailable right now, try again later") =>
  new AppError(503, "AI_UNAVAILABLE", msg);

export type StructuredRequest<S extends z.ZodType> = {
  schema: S;
  system: string;
  prompt: string;
  effort: "low" | "medium" | "high";
  maxTokens?: number;
  tools?: ParseParams["tools"];
};

/**
 * One structured-output request to Claude (backend/10):
 * - model claude-opus-5-5, adaptive thinking, explicit effort, server-side refusal fallback (`fallbacks: "default"`);
 * - JSON constrained by the zod schema (structured outputs) and validated AGAIN with zod before it is returned;
 * - `stop_reason` checked before reading content: refusal → 422 AI_REFUSED, max_tokens → 503, pause_turn (server tools) → resumed;
 * - SDK errors (rate limit, API, connection, 60 s timeout) → 503 AI_UNAVAILABLE.
 * Claude never touches the database: callers validate the result and decide what to save.
 */
export async function structured<S extends z.ZodType>(req: StructuredRequest<S>): Promise<{ data: z.infer<S>; webSearchErrors: string[] }> {
  if (!ai.isConfigured()) throw notConfigured("AI features (ANTHROPIC_API_KEY)");
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: req.prompt }];
  const webSearchErrors: string[] = [];

  for (let turn = 0; turn < 4; turn++) {
    let res: ParsedResponse;
    try {
      res = await ai.call({
        model: CLAUDE_MODEL,
        max_tokens: req.maxTokens ?? 16000,
        system: req.system,
        messages,
        thinking: { type: "adaptive" },
        output_config: { effort: req.effort, format: betaZodOutputFormat(req.schema) },
        ...(req.tools ? { tools: req.tools } : {}),
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (err instanceof Anthropic.RateLimitError) logger.warn("Claude rate limited");
      else if (err instanceof Anthropic.APIError) logger.warn({ status: err.status }, "Claude API error");
      else logger.warn({ err: String(err) }, "Claude call failed");
      throw unavailable();
    }

    for (const block of res.content) {
      if (block.type === "web_search_tool_result" && !Array.isArray(block.content)) {
        webSearchErrors.push(String((block.content as { error_code?: string }).error_code ?? "unknown"));
      }
    }

    switch (res.stop_reason) {
      case "refusal":
        throw new AppError(422, "AI_REFUSED", "The AI assistant declined this request");
      case "max_tokens":
        throw unavailable("The AI answer was too long, try again with fewer items");
      case "pause_turn":
        messages.push({ role: "assistant", content: res.content });
        continue;
      default: {
        const parsed = req.schema.safeParse(res.parsed_output);
        if (!parsed.success) {
          logger.warn({ issues: parsed.error.issues.slice(0, 5) }, "Claude output failed validation");
          throw new AppError(502, "AI_BAD_OUTPUT", "The AI assistant returned an unusable answer, try again");
        }
        return { data: parsed.data, webSearchErrors };
      }
    }
  }
  throw unavailable("The AI assistant took too long, try again");
}
