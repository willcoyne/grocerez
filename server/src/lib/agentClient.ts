import { config } from "../config.js";
import type { AgentRunRequest } from "../contracts/agent.js";
import { http } from "./http.js";

const TIMEOUT_MS = 5000;

/**
 * Outbound call to the Pantry Agent service (agent/API.md): POST {AGENT_URL}/runs with X-Agent-Secret.
 * The agent answers 202 and runs in the background. Any network error, timeout or non-2xx throws.
 * Tests stub `agentClient.startRun`.
 */
export const agentClient = {
  async startRun(body: AgentRunRequest): Promise<void> {
    if (!config.AGENT_URL || !config.AGENT_SHARED_SECRET) throw new Error("Pantry Agent is not configured");
    const res = await http.fetch(`${config.AGENT_URL.replace(/\/+$/, "")}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Agent-Secret": config.AGENT_SHARED_SECRET },
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`agent answered ${res.status}`);
  },
};
