const ANTHROPIC_VERSION = "vertex-2023-10-16";

export function toVertexRequest(
  anthropicBody: Record<string, unknown>,
): Record<string, unknown> {
  const { model: _, ...rest } = anthropicBody;
  return {
    anthropic_version: ANTHROPIC_VERSION,
    ...rest,
  };
}

export function buildVertexUrl(opts: {
  project: string;
  location: string;
  vertexModelId: string;
  stream: boolean;
}): string {
  const host =
    opts.location === "global"
      ? "aiplatform.googleapis.com"
      : `${opts.location}-aiplatform.googleapis.com`;

  const method = opts.stream ? "streamRawPredict" : "rawPredict";

  return `https://${host}/v1/projects/${opts.project}/locations/${opts.location}/publishers/anthropic/models/${opts.vertexModelId}:${method}`;
}
