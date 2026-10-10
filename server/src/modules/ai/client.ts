import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessage, BetaMessageParam, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/beta/messages/messages.js";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { AppError } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";

export const AI_MODEL = "claude-opus-5-5";
export const AI_TIMEOUT_MS = 60_000;
const MAX_PAUSE_CONTINUATIONS = 3;

/** Only the part of the SDK we call, so tests can pass a stub. */
export type AiClient = { beta: { messages: { create: (...args: any[]) => Promise<unknown> } } };

let defaultClient: AiClient | undefined;
export function getAiClient(): AiClient {
  // Reads ANTHROPIC_API_KEY from the environment. No retries: the 60 s timeout is the wall-clock budget.
  return (defaultClient ??= new Anthropic({ maxRetries: 0 }) as unknown as AiClient);
}

export const aiUnavailable = (message = "AI features are temporarily unavailable") =>
  new AppError(503, "AI_UNAVAILABLE", message);

type CallParams = Omit<MessageCreateParamsNonStreaming, "model" | "output_config" | "messages" | "max_tokens"> & {
  messages: BetaMessageParam[];
  effort: "low" | "medium";
};

/**
 * One structured-output request to Claude. Returns the zod-validated object or throws 503 AI_UNAVAILABLE.
 * Every failure (network, timeout, rate limit, refusal, truncation, bad JSON, schema mismatch) maps to 503.
 */
export async function callStructured<S extends z.ZodType>(
  client: AiClient,
  { effort, messages, ...rest }: CallParams,
  schema: S,
): Promise<{ data: z.infer<S>; message: BetaMessage }> {
  try {
    const history = [...messages];
    for (let i = 0; ; i++) {
      const message = (await client.beta.messages.create(
        {
          ...rest,
          model: AI_MODEL,
          max_tokens: 16000,
          thinking: { type: "adaptive" },
          output_config: { effort, format: betaZodOutputFormat(schema) },
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          messages: history,
        },
        { timeout: AI_TIMEOUT_MS },
      )) as BetaMessage;

      // Check stop_reason before touching content.
      if (message.stop_reason === "pause_turn" && i < MAX_PAUSE_CONTINUATIONS) {
        history.push({ role: "assistant", content: message.content as BetaMessageParam["content"] });
        continue;
      }
      if (message.stop_reason !== "end_turn") {
        throw aiUnavailable(
          message.stop_reason === "refusal"
            ? "The AI declined this request"
            : `AI response incomplete (${message.stop_reason})`,
        );
      }

      // Structured output is the text after the last server-tool block (web search may precede it).
      let start = 0;
      message.content.forEach((b, idx) => {
        if (b.type !== "text" && b.type !== "thinking") start = idx + 1;
      });
      const text = message.content
        .slice(start)
        .flatMap((b) => (b.type === "text" ? [b.text] : []))
        .join("");
      const parsed = schema.safeParse(JSON.parse(text));
      if (!parsed.success) throw aiUnavailable("AI returned malformed data");
      return { data: parsed.data, message };
    }
  } catch (err) {
    if (err instanceof AppError) {
      logger.warn({ code: err.code, msg: err.message }, "claude call rejected");
      throw err;
    }
    // Anthropic.APIError covers RateLimitError, APIConnectionTimeoutError, 5xx; SyntaxError is bad JSON.
    logger.warn({ err, kind: err instanceof Anthropic.APIError ? "api" : "other" }, "claude call failed");
    throw aiUnavailable();
  }
}
