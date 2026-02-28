import { describe, test, expect } from "bun:test";
import { resolveVertexModelId } from "./models";

describe("resolveVertexModelId", () => {
  test("returns override when model ID has an explicit mapping", () => {
    const overrides: Record<string, string> = {
      "claude-haiku-4-5-20251001": "claude-haiku-4-5@20251001",
    };

    const result = resolveVertexModelId("claude-haiku-4-5-20251001", overrides);

    expect(result).toBe("claude-haiku-4-5@20251001");
  });

  test("returns override for alias mapping", () => {
    const overrides: Record<string, string> = {
      "claude-haiku-4-5": "claude-haiku-4-5@20251001",
    };

    const result = resolveVertexModelId("claude-haiku-4-5", overrides);

    expect(result).toBe("claude-haiku-4-5@20251001");
  });

  test("passes through model ID unchanged when no override exists", () => {
    const overrides: Record<string, string> = {};

    const result = resolveVertexModelId("claude-opus-4-6", overrides);

    expect(result).toBe("claude-opus-4-6");
  });

  test("passes through unknown model IDs unchanged", () => {
    const overrides: Record<string, string> = {
      "claude-haiku-4-5": "claude-haiku-4-5@20251001",
    };

    const result = resolveVertexModelId("claude-sonnet-4-6", overrides);

    expect(result).toBe("claude-sonnet-4-6");
  });

  test("handles empty overrides object", () => {
    const result = resolveVertexModelId("claude-opus-4-6", {});

    expect(result).toBe("claude-opus-4-6");
  });
});
