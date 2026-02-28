import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createGatewayServer, type GatewayConfig } from "./server.ts";

let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;

const originalFetch = globalThis.fetch;

const TEST_CONFIG: GatewayConfig = {
  project: "test-project",
  location: "europe-west1",
  overrides: {
    "claude-haiku-4-5": "claude-haiku-4-5@20251001",
  },
  geminiLocationOverrides: {
    "gemini-3-flash-preview": "global",
  },
  getToken: () => Promise.resolve("ya29.test-token"),
  gatewayKey: "test-gateway-key",
  port: 0, // random available port
};

const AUTH_HEADERS = {
  "Content-Type": "application/json",
  "x-api-key": "test-gateway-key",
};

describe("gateway server", () => {
  beforeAll(() => {
    server = createGatewayServer(TEST_CONFIG);
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

  describe("POST /anthropic/v1/messages", () => {
    test("returns 401 when x-api-key is missing", async () => {
      const response = await fetch(`${baseUrl}/anthropic/v1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 10 }),
      });

      expect(response.status).toBe(401);
    });

    test("returns 401 when x-api-key is wrong", async () => {
      const response = await fetch(`${baseUrl}/anthropic/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": "wrong-key",
        },
        body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 10 }),
      });

      expect(response.status).toBe(401);
    });

    test("returns 400 when body has no model field", async () => {
      const response = await fetch(`${baseUrl}/anthropic/v1/messages`, {
        method: "POST",
        headers: AUTH_HEADERS,
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

      globalThis.fetch = (async (
        input: string | Request | URL,
        init?: RequestInit,
      ) => {
        if (typeof input === "string" && input.includes("aiplatform")) {
          capturedUrl = input;
          capturedHeaders = Object.fromEntries(
            new Headers(init?.headers).entries(),
          );
          capturedBody = JSON.parse(init?.body as string);
          return new Response(
            JSON.stringify({ id: "msg_123", type: "message", content: [] }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return originalFetch(input, init);
      }) as typeof fetch;

      const response = await fetch(`${baseUrl}/anthropic/v1/messages`, {
        method: "POST",
        headers: AUTH_HEADERS,
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
      expect(capturedHeaders.authorization).toBe("Bearer ya29.test-token");
      expect(capturedBody).toEqual({
        anthropic_version: "vertex-2023-10-16",
        messages: [{ role: "user", content: "Hello" }],
        max_tokens: 100,
      });
    });

    test("applies model override from mapping", async () => {
      let capturedUrl = "";

      globalThis.fetch = (async (
        input: string | Request | URL,
        init?: RequestInit,
      ) => {
        if (typeof input === "string" && input.includes("aiplatform")) {
          capturedUrl = input;
          return new Response(JSON.stringify({ type: "message" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return originalFetch(input, init);
      }) as typeof fetch;

      await fetch(`${baseUrl}/anthropic/v1/messages`, {
        method: "POST",
        headers: AUTH_HEADERS,
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

      globalThis.fetch = (async (
        input: string | Request | URL,
        init?: RequestInit,
      ) => {
        if (typeof input === "string" && input.includes("aiplatform")) {
          capturedUrl = input;
          return new Response("data: {}\n\n", {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          });
        }
        return originalFetch(input, init);
      }) as typeof fetch;

      await fetch(`${baseUrl}/anthropic/v1/messages`, {
        method: "POST",
        headers: AUTH_HEADERS,
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

      globalThis.fetch = (async (
        input: string | Request | URL,
        init?: RequestInit,
      ) => {
        if (typeof input === "string" && input.includes("aiplatform")) {
          return new Response(sseData, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          });
        }
        return originalFetch(input, init);
      }) as typeof fetch;

      const response = await fetch(`${baseUrl}/anthropic/v1/messages`, {
        method: "POST",
        headers: AUTH_HEADERS,
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
      globalThis.fetch = (async (
        input: string | Request | URL,
        init?: RequestInit,
      ) => {
        if (typeof input === "string" && input.includes("aiplatform")) {
          return new Response(
            JSON.stringify({ error: { message: "Rate limited" } }),
            { status: 429, headers: { "Content-Type": "application/json" } },
          );
        }
        return originalFetch(input, init);
      }) as typeof fetch;

      const response = await fetch(`${baseUrl}/anthropic/v1/messages`, {
        method: "POST",
        headers: AUTH_HEADERS,
        body: JSON.stringify({
          model: "claude-opus-4-6",
          messages: [{ role: "user", content: "Hi" }],
          max_tokens: 100,
        }),
      });

      expect(response.status).toBe(429);
    });
  });

  describe("POST /gemini/v1beta/models/:model::method", () => {
    test("returns 401 when x-goog-api-key is missing", async () => {
      const response = await fetch(
        `${baseUrl}/gemini/v1beta/models/gemini-2.5-flash-lite:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: "Hi" }] }] }),
        },
      );

      expect(response.status).toBe(401);
    });

    test("returns 401 when ?key= query param is wrong", async () => {
      const response = await fetch(
        `${baseUrl}/gemini/v1beta/models/gemini-2.5-flash-lite:generateContent?key=wrong`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: "Hi" }] }] }),
        },
      );

      expect(response.status).toBe(401);
    });

    test("forwards request to Vertex AI with correct URL and auth via header", async () => {
      let capturedUrl = "";
      let capturedHeaders: Record<string, string> = {};

      globalThis.fetch = (async (
        input: string | Request | URL,
        init?: RequestInit,
      ) => {
        if (typeof input === "string" && input.includes("aiplatform")) {
          capturedUrl = input;
          capturedHeaders = Object.fromEntries(
            new Headers(init?.headers).entries(),
          );
          return new Response(
            JSON.stringify({
              candidates: [{ content: { parts: [{ text: "Hi" }] } }],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return originalFetch(input, init);
      }) as typeof fetch;

      const response = await fetch(
        `${baseUrl}/gemini/v1beta/models/gemini-2.5-flash-lite:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": "test-gateway-key",
          },
          body: JSON.stringify({ contents: [{ parts: [{ text: "Hi" }] }] }),
        },
      );

      expect(response.status).toBe(200);
      expect(capturedUrl).toBe(
        "https://europe-west1-aiplatform.googleapis.com/v1beta1/projects/test-project/locations/europe-west1/publishers/google/models/gemini-2.5-flash-lite:generateContent",
      );
      expect(capturedHeaders.authorization).toBe("Bearer ya29.test-token");
    });

    test("accepts gateway key via ?key= query param", async () => {
      let capturedUrl = "";

      globalThis.fetch = (async (
        input: string | Request | URL,
        init?: RequestInit,
      ) => {
        if (typeof input === "string" && input.includes("aiplatform")) {
          capturedUrl = input;
          return new Response(JSON.stringify({ candidates: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return originalFetch(input, init);
      }) as typeof fetch;

      const response = await fetch(
        `${baseUrl}/gemini/v1beta/models/gemini-2.5-flash-lite:generateContent?key=test-gateway-key`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: "Hi" }] }] }),
        },
      );

      expect(response.status).toBe(200);
      expect(capturedUrl).toContain("gemini-2.5-flash-lite:generateContent");
    });

    test("routes streamGenerateContent to Vertex AI", async () => {
      let capturedUrl = "";

      globalThis.fetch = (async (
        input: string | Request | URL,
        init?: RequestInit,
      ) => {
        if (typeof input === "string" && input.includes("aiplatform")) {
          capturedUrl = input;
          return new Response("data: {}\n\n", {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          });
        }
        return originalFetch(input, init);
      }) as typeof fetch;

      await fetch(
        `${baseUrl}/gemini/v1beta/models/gemini-2.5-flash-lite:streamGenerateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": "test-gateway-key",
          },
          body: JSON.stringify({ contents: [{ parts: [{ text: "Hi" }] }] }),
        },
      );

      expect(capturedUrl).toContain(":streamGenerateContent");
    });

    test("returns 404 for unknown Gemini methods", async () => {
      const response = await fetch(
        `${baseUrl}/gemini/v1beta/models/gemini-2.5-flash-lite:unknownMethod`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": "test-gateway-key",
          },
          body: JSON.stringify({}),
        },
      );

      expect(response.status).toBe(404);
    });
  });

  // OpenCode sends to ANTHROPIC_BASE_URL + "/messages" (no /v1 prefix),
  // so the gateway exposes /anthropic/messages as an alias.
  describe("POST /anthropic/messages (OpenCode alias)", () => {
    test("returns 401 when x-api-key is missing", async () => {
      const response = await fetch(`${baseUrl}/anthropic/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 10 }),
      });

      expect(response.status).toBe(401);
    });

    test("forwards request to Vertex AI same as /v1/messages", async () => {
      let capturedUrl = "";

      globalThis.fetch = (async (
        input: string | Request | URL,
        init?: RequestInit,
      ) => {
        if (typeof input === "string" && input.includes("aiplatform")) {
          capturedUrl = input;
          return new Response(JSON.stringify({ type: "message" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return originalFetch(input, init);
      }) as typeof fetch;

      const response = await fetch(`${baseUrl}/anthropic/messages`, {
        method: "POST",
        headers: AUTH_HEADERS,
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
    });

    test("returns 405 for non-POST methods", async () => {
      const response = await fetch(`${baseUrl}/anthropic/messages`, {
        method: "GET",
      });

      expect(response.status).toBe(405);
    });
  });

  describe("unknown routes", () => {
    test("returns 404 for unknown paths", async () => {
      const response = await fetch(`${baseUrl}/unknown`);

      expect(response.status).toBe(404);
    });

    test("returns 404 for old /v1/messages path", async () => {
      const response = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: AUTH_HEADERS,
        body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 10 }),
      });

      expect(response.status).toBe(404);
    });
  });
});
