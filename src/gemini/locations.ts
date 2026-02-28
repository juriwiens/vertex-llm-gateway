export function resolveGeminiLocation(
  model: string,
  overrides: Record<string, string>,
  defaultLocation: string,
): string {
  return overrides[model] ?? defaultLocation;
}
