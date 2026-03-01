import { resolveVertexModelId } from "./models.ts";
import { buildVertexUrl, toVertexRequest } from "./transform.ts";

export interface AnthropicHandlerConfig {
  project: string;
  location: string;
  overrides: Record<string, string>;
  getToken: () => Promise<string>;
  validateClient: (apiKey: string) => string | null;
}

export async function handleAnthropicMessages(
  req: Request,
  config: AnthropicHandlerConfig,
): Promise<Response> {
  const apiKey = req.headers.get("x-api-key");
  const clientName = apiKey ? config.validateClient(apiKey) : null;
  
  if (!clientName) {
    console.warn("[anthropic] 401 – x-api-key missing or wrong");
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

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
    console.error(
      "[anthropic] ADC token fetch failed:",
      (err as Error).message,
    );
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
    console.error(
      "[anthropic] Vertex request failed:",
      (err as Error).message,
      "→",
      vertexUrl,
    );
    return Response.json(
      { error: `Vertex AI request failed: ${(err as Error).message}` },
      { status: 502 },
    );
  }

  if (!vertexResponse.ok) {
    console.warn(
      `[anthropic] Vertex returned ${vertexResponse.status} → ${vertexUrl}`,
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
