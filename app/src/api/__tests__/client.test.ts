import { api, ApiError, configureApiSession, errorMessage, isRetryable } from "../client";

function mockFetch(status: number, body?: unknown) {
  const fn = jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? "" : JSON.stringify(body)),
  }));
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe("api client", () => {
  afterEach(() => configureApiSession({ getToken: () => null, onUnauthorized: () => {} }));

  it("adds the base URL, Bearer token and JSON body", async () => {
    configureApiSession({ getToken: () => "jwt-123" });
    const fetchMock = mockFetch(200, { ok: true });
    const res = await api<{ ok: boolean }>("/groups", { method: "POST", body: { name: "Home" }, query: { q: "a b" } });
    expect(res).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:3000/api/groups?q=a%20b");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer jwt-123");
    expect(init.body).toBe(JSON.stringify({ name: "Home" }));
  });

  it("turns {error:{code,message}} into an ApiError", async () => {
    mockFetch(409, { error: { code: "ALREADY_MEMBER", message: "Already a member" } });
    await expect(api("/groups/x/invites", { method: "POST", body: {} })).rejects.toMatchObject({
      name: "ApiError",
      status: 409,
      code: "ALREADY_MEMBER",
      message: "Already a member",
    });
  });

  it("clears the session on 401 when a token was sent", async () => {
    const onUnauthorized = jest.fn();
    configureApiSession({ getToken: () => "expired", onUnauthorized });
    mockFetch(401, { error: { code: "UNAUTHENTICATED", message: "nope" } });
    await expect(api("/me")).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("returns undefined for 204", async () => {
    mockFetch(204);
    await expect(api("/groups/x", { method: "DELETE" })).resolves.toBeUndefined();
  });

  it("maps network failures to status 0 NETWORK_ERROR", async () => {
    globalThis.fetch = jest.fn(async () => {
      throw new TypeError("Network request failed");
    }) as unknown as typeof fetch;
    await expect(api("/health")).rejects.toMatchObject({ status: 0, code: "NETWORK_ERROR" });
  });

  it("retries network errors and 5xx, but not 4xx or NOT_CONFIGURED", () => {
    expect(isRetryable(new ApiError(0, "NETWORK_ERROR", ""))).toBe(true);
    expect(isRetryable(new ApiError(502, "UPSTREAM_UNAVAILABLE", ""))).toBe(true);
    expect(isRetryable(new ApiError(503, "NOT_CONFIGURED", ""))).toBe(false);
    expect(isRetryable(new ApiError(404, "NOT_FOUND", ""))).toBe(false);
  });

  it("has friendly messages for rate limits and AI errors", () => {
    expect(errorMessage(new ApiError(429, "RATE_LIMITED", "x"))).toMatch(/Too many requests/);
    expect(errorMessage(new ApiError(503, "AI_UNAVAILABLE", "x"))).toMatch(/unavailable/);
    expect(errorMessage(new ApiError(503, "NOT_CONFIGURED", "x"))).toMatch(/isn't set up/);
  });
});
