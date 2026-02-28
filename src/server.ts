import { GoogleAuth } from "google-auth-library";
import { handleAnthropicMessages } from "./anthropic/handler.ts";
import { TokenProvider } from "./auth.ts";
import { handleGeminiGenerateContent } from "./gemini/handler.ts";

export interface GatewayConfig {
  project: string;
  location: string;
  overrides: Record<string, string>;
  geminiLocationOverrides: Record<string, string>;
  getToken: () => Promise<string>;
  gatewayKey: string;
  port: number;
}

// Gemini methods that the gateway forwards. Other methods return 404.
const GEMINI_METHODS = new Set(["generateContent", "streamGenerateContent"]);

export function createGatewayServer(config: GatewayConfig) {
  return Bun.serve({
    port: config.port,
    hostname: "0.0.0.0",

    routes: {
      // Health check — static Response for zero-allocation dispatch
      "/health": Response.json({ status: "ok" }),

      // Two routes for the Anthropic Messages API, because the two common
      // SDKs construct URLs differently from the same ANTHROPIC_BASE_URL:
      //
      //   @anthropic-ai/sdk (official):  baseURL + "/v1/messages"
      //     → expects ANTHROPIC_BASE_URL = "…/anthropic"
      //     → sends POST /anthropic/v1/messages
      //
      //   @ai-sdk/anthropic (Vercel AI SDK, used by OpenCode):
      //     → expects ANTHROPIC_BASE_URL = "…/anthropic/v1" (already includes /v1)
      //     → sends POST /anthropic/messages
      //
      // Both routes delegate to the same handler.
      "/anthropic/v1/messages": (req) => {
        if (req.method !== "POST")
          return Response.json(
            { error: "Method not allowed" },
            { status: 405 },
          );
        return handleAnthropicMessages(req, config);
      },
      "/anthropic/messages": (req) => {
        if (req.method !== "POST")
          return Response.json(
            { error: "Method not allowed" },
            { status: 405 },
          );
        return handleAnthropicMessages(req, config);
      },

      // Gemini: POST /gemini/v1beta/models/{model}:{method}
      // The colon between model and method is part of the path segment,
      // so `:modelMethod` captures "gemini-2.5-flash-lite:generateContent" whole.
      "/gemini/v1beta/models/:modelMethod": (req) => {
        if (req.method !== "POST")
          return Response.json(
            { error: "Method not allowed" },
            { status: 405 },
          );
        const { modelMethod } = req.params;
        const colon = modelMethod.lastIndexOf(":");
        if (colon === -1)
          return Response.json({ error: "Not found" }, { status: 404 });
        const model = modelMethod.slice(0, colon);
        const method = modelMethod.slice(colon + 1);
        if (!GEMINI_METHODS.has(method))
          return Response.json({ error: "Not found" }, { status: 404 });
        return handleGeminiGenerateContent(req, model, method, {
          ...config,
          locationOverrides: config.geminiLocationOverrides,
        });
      },
    },

    // Fallback for all unmatched routes
    fetch() {
      return Response.json({ error: "Not found" }, { status: 404 });
    },
  });
}

// --- Main entrypoint (only when run directly) ---

const isMainModule = process.argv[1]?.endsWith("server.ts");
if (isMainModule) {
  const project =
    process.env.VERTEX_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT;
  const location = process.env.VERTEX_LOCATION ?? "europe-west1";
  const port = Number(
    process.env.GATEWAY_PORT ?? process.env.PROXY_PORT ?? "18443",
  );
  const gatewayKey = process.env.VERTEX_GATEWAY_KEY;

  if (!project) {
    console.error(
      "Error: Set VERTEX_PROJECT or GOOGLE_CLOUD_PROJECT environment variable",
    );
    process.exit(1);
  }

  if (!gatewayKey) {
    console.error("Error: Set VERTEX_GATEWAY_KEY environment variable");
    process.exit(1);
  }

  let overrides: Record<string, string> = {};
  try {
    const overridesFile = Bun.file(
      new URL("../model-overrides.json", import.meta.url),
    );
    overrides = await overridesFile.json();
  } catch {
    console.warn("No model-overrides.json found, using pass-through only");
  }

  let geminiLocationOverrides: Record<string, string> = {};
  try {
    const locationsFile = Bun.file(
      new URL("../gemini-locations.json", import.meta.url),
    );
    geminiLocationOverrides = await locationsFile.json();
  } catch {
    // Optional file — no warning needed
  }

  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const tokenProvider = new TokenProvider(async () => {
    const client = await auth.getClient();
    const { token } = await client.getAccessToken();
    if (!token) throw new Error("Failed to obtain access token from ADC");
    return token;
  });

  const server = createGatewayServer({
    project,
    location,
    overrides,
    geminiLocationOverrides,
    getToken: () => tokenProvider.getToken(),
    gatewayKey,
    port,
  });

  console.log(`vertex-llm-gateway listening on http://0.0.0.0:${server.port}`);
  console.log(`  project:  ${project}`);
  console.log(`  location: ${location}`);
}
