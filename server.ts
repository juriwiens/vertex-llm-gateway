import { resolveVertexModelId } from "./models";
import { toVertexRequest, buildVertexUrl } from "./transform";
import { TokenProvider } from "./auth";
import { GoogleAuth } from "google-auth-library";

export interface ProxyConfig {
  project: string;
  location: string;
  overrides: Record<string, string>;
  getToken: () => Promise<string>;
  port: number;
}

export function createProxyServer(config: ProxyConfig) {
  return Bun.serve({
    port: config.port,
    hostname: "0.0.0.0",

    async fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === "/health" && req.method === "GET") {
        return Response.json({ status: "ok" });
      }

      if (url.pathname === "/v1/messages" && req.method === "POST") {
        return handleMessages(req, config);
      }

      return Response.json({ error: "Not found" }, { status: 404 });
    },
  });
}

async function handleMessages(
  req: Request,
  config: ProxyConfig,
): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const model = body.model;
  if (typeof model !== "string" || model.length === 0) {
    return Response.json(
      { error: "Missing required field: model" },
      { status: 400 },
    );
  }

  const stream = body.stream === true;
  const vertexModelId = resolveVertexModelId(model, config.overrides);
  const vertexBody = toVertexRequest(body);
  const vertexUrl = buildVertexUrl({
    project: config.project,
    location: config.location,
    vertexModelId,
    stream,
  });

  let token: string;
  try {
    token = await config.getToken();
  } catch (err) {
    return Response.json(
      { error: `Authentication failed: ${(err as Error).message}` },
      { status: 502 },
    );
  }

  let vertexResponse: Response;
  try {
    vertexResponse = await fetch(vertexUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(vertexBody),
    });
  } catch (err) {
    return Response.json(
      { error: `Vertex AI request failed: ${(err as Error).message}` },
      { status: 502 },
    );
  }

  return new Response(vertexResponse.body, {
    status: vertexResponse.status,
    headers: {
      "Content-Type":
        vertexResponse.headers.get("Content-Type") ?? "application/json",
    },
  });
}

// --- Main entrypoint (only when run directly) ---

const isMainModule = process.argv[1]?.endsWith("server.ts");
if (isMainModule) {
  const project =
    process.env.VERTEX_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT;
  const location = process.env.VERTEX_LOCATION ?? "europe-west1";
  const port = Number(process.env.PROXY_PORT ?? "18443");

  if (!project) {
    console.error(
      "Error: Set VERTEX_PROJECT or GOOGLE_CLOUD_PROJECT environment variable",
    );
    process.exit(1);
  }

  let overrides: Record<string, string> = {};
  try {
    const overridesFile = Bun.file(
      new URL("./model-overrides.json", import.meta.url),
    );
    overrides = await overridesFile.json();
  } catch {
    console.warn("No model-overrides.json found, using pass-through only");
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

  const server = createProxyServer({
    project,
    location,
    overrides,
    getToken: () => tokenProvider.getToken(),
    port,
  });

  console.log(
    `vertex-llm-proxy listening on http://0.0.0.0:${server.port}`,
  );
  console.log(`  project:  ${project}`);
  console.log(`  location: ${location}`);
}
