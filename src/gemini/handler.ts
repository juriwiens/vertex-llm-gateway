import { buildGeminiVertexUrl } from "./transform.ts";

export interface GeminiHandlerConfig {
  project: string;
  location: string;
  getToken: () => Promise<string>;
  gatewayKey: string;
}

export async function handleGeminiGenerateContent(
  req: Request,
  model: string,
  method: string,
  config: GeminiHandlerConfig,
): Promise<Response> {
  // API key may arrive as header (x-goog-api-key) or query param (?key=)
  const url = new URL(req.url);
  const apiKey =
    req.headers.get("x-goog-api-key") ?? url.searchParams.get("key");
  if (!apiKey || apiKey !== config.gatewayKey) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // The @google/genai SDK always appends ?alt=sse to all requests.
  // Vertex AI behaviour per method:
  //   generateContent + ?alt=sse  → not supported; must call streamGenerateContent instead
  //   streamGenerateContent + ?alt=sse → supported; returns SSE-formatted chunks
  const altSse = url.searchParams.get("alt") === "sse";
  const vertexMethod =
    method === "generateContent" && altSse ? "streamGenerateContent" : method;

  let vertexUrl = buildGeminiVertexUrl({
    project: config.project,
    location: config.location,
    model,
    method: vertexMethod,
  });

  // Forward ?alt=sse to Vertex for streamGenerateContent so it returns SSE chunks
  // that the SDK's SSE parser can consume.
  if (altSse && vertexMethod === "streamGenerateContent") {
    vertexUrl += "?alt=sse";
  }

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
      body: req.body,
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
