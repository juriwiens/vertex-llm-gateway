import { describe, expect, test } from "bun:test";
import { resolveGeminiLocation } from "./locations.ts";

describe("resolveGeminiLocation", () => {
  test("returns override location when model has an explicit mapping", () => {
    const overrides = { "gemini-3-flash-preview": "global" };

    expect(
      resolveGeminiLocation(
        "gemini-3-flash-preview",
        overrides,
        "europe-west1",
      ),
    ).toBe("global");
  });

  test("returns default location when model has no override", () => {
    const overrides = { "gemini-3-flash-preview": "global" };

    expect(
      resolveGeminiLocation("gemini-2.5-flash-lite", overrides, "europe-west1"),
    ).toBe("europe-west1");
  });

  test("returns default location when overrides is empty", () => {
    expect(
      resolveGeminiLocation("gemini-2.5-flash-lite", {}, "us-central1"),
    ).toBe("us-central1");
  });
});
