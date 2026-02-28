export function resolveVertexModelId(
  anthropicModelId: string,
  overrides: Record<string, string>,
): string {
  return overrides[anthropicModelId] ?? anthropicModelId;
}
