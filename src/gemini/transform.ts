export function buildGeminiVertexUrl(opts: {
  project: string;
  location: string;
  model: string;
  method: string;
}): string {
  const host =
    opts.location === "global"
      ? "aiplatform.googleapis.com"
      : `${opts.location}-aiplatform.googleapis.com`;

  return `https://${host}/v1beta1/projects/${opts.project}/locations/${opts.location}/publishers/google/models/${opts.model}:${opts.method}`;
}
