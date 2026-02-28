import { describe, test, expect, beforeAll, afterAll, mock } from "bun:test";
import { createProxyServer, type ProxyConfig } from "./server";

let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;

// Mock fetch to avoid real Vertex AI calls
const originalFetch = globalThis.fetch;

const TEST_CONFIG: ProxyConfig = {
  project: "test-project",
  location: "europe-west1",
  overrides: {
    "claude-haiku-4-5": "claude-haiku-4-5@20251001",
  },
  getToken: () => Promise.resolve("ya29.test-token"),
  port: 0, // random available port
};

describe("proxy server", () => {
  beforeAll(() => {
    server = createProxyServer(TEST_CONFIG);
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
    globalThis.fetch = originalFetch;
  });

  describe("GET /health", () => {
    test("returns 200 with ok status", async () => {
      const response = await fetch(`${baseUrl}/health`);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ status: "ok" });
    });
  });

  describe("POST /v1/messages", () => {
    test("returns 400 when body has no model field", async () => {
      const response = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Hi" }],
          max_tokens: 100,
        }),
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toContain("model");
    });

    test("forwards request to Vertex AI with correct URL and auth", async () => {
      let capturedUrl = "";
      let capturedHeaders: Record<string, string> = {};
      let capturedBody: Record<string, unknown> = {};

      globalThis.fetch = (async (input: string | Request | URL, init?: RequestInit) => {
        if (typeof input === "string" && input.includes("aiplatform")) {
          capturedUrl = input;
          capturedHeaders = Object.fromEntries(
            new Headers(init?.headers).entries(),
          );
          capturedBody = JSON.parse(init?.body as string);
          return new Response(
            JSON.stringify({ id: "msg_123", type: "message", content: [] }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        return originalFetch(input, init);
      }) as typeof fetch;

      const response = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-opus-4-6",
          messages: [{ role: "user", content: "Hello" }],
          max_tokens: 100,
        }),
      });

      expect(response.status).toBe(200);
      expect(capturedUrl).toBe(
        "https://europe-west1-aiplatform.googleapis.com/v1/projects/test-project/locations/europe-west1/publishers/anthropic/models/claude-opus-4-6:rawPredict",
      );
      expect(capturedHeaders["authorization"]).toBe("Bearer ya29.test-token");
      expect(capturedBody).toEqual({
        anthropic_version: "vertex-2023-10-16",
        messages: [{ role: "user", content: "Hello" }],
        max_tokens: 100,
      });
    });

    test("applies model override from mapping", async () => {
      let capturedUrl = "";

      globalThis.fetch = (async (input: string | Request | URL, init?: RequestInit) => {
        if (typeof input === "string" && input.includes("aiplatform")) {
          capturedUrl = input;
          return new Response(JSON.stringify({ type: "message" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return originalFetch(input, init);
      }) as typeof fetch;

      await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-haiku-4-5",
          messages: [{ role: "user", content: "Hi" }],
          max_tokens: 50,
        }),
      });

      expect(capturedUrl).toContain("claude-haiku-4-5@20251001");
    });

    test("uses streamRawPredict when stream is true", async () => {
      let capturedUrl = "";

      globalThis.fetch = (async (input: string | Request | URL, init?: RequestInit) => {
        if (typeof input === "string" && input.includes("aiplatform")) {
          capturedUrl = input;
          return new Response("data: {}\n\n", {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          });
        }
        return originalFetch(input, init);
      }) as typeof fetch;

      await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-opus-4-6",
          messages: [{ role: "user", content: "Hi" }],
          max_tokens: 100,
          stream: true,
        }),
      });

      expect(capturedUrl).toContain(":streamRawPredict");
    });

    test("streams SSE response back to client", async () => {
      const sseData =
        'data: {"type":"content_block_start"}\n\ndata: {"type":"content_block_stop"}\n\n';

      globalThis.fetch = (async (input: string | Request | URL, init?: RequestInit) => {
        if (typeof input === "string" && input.includes("aiplatform")) {
          return new Response(sseData, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          });
        }
        return originalFetch(input, init);
      }) as typeof fetch;

      const response = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-opus-4-6",
          messages: [{ role: "user", content: "Hi" }],
          max_tokens: 100,
          stream: true,
        }),
      });

      expect(response.headers.get("content-type")).toBe("text/event-stream");
      const body = await response.text();
      expect(body).toBe(sseData);
    });

    test("forwards Vertex AI error status codes", async () => {
      globalThis.fetch = (async (input: string | Request | URL, init?: RequestInit) => {
        if (typeof input === "string" && input.includes("aiplatform")) {
          return new Response(
            JSON.stringify({ error: { message: "Rate limited" } }),
            {
              status: 429,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        return originalFetch(input, init);
      }) as typeof fetch;

      const response = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-opus-4-6",
          messages: [{ role: "user", content: "Hi" }],
          max_tokens: 100,
        }),
      });

      expect(response.status).toBe(429);
    });
  });

  describe("unknown routes", () => {
    test("returns 404 for unknown paths", async () => {
      const response = await fetch(`${baseUrl}/unknown`);

      expect(response.status).toBe(404);
    });
  });
});
