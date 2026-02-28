import { describe, expect, test } from "bun:test";
import { buildGeminiVertexUrl } from "./transform.ts";

describe("buildGeminiVertexUrl", () => {
  test("builds URL for regional endpoint with generateContent", () => {
    const url = buildGeminiVertexUrl({
      project: "my-project",
      location: "europe-west1",
      model: "gemini-2.5-flash-lite",
      method: "generateContent",
    });

    expect(url).toBe(
      "https://europe-west1-aiplatform.googleapis.com/v1beta1/projects/my-project/locations/europe-west1/publishers/google/models/gemini-2.5-flash-lite:generateContent",
    );
  });

  test("builds URL for regional endpoint with streamGenerateContent", () => {
    const url = buildGeminiVertexUrl({
      project: "my-project",
      location: "europe-west1",
      model: "gemini-2.5-flash-lite",
      method: "streamGenerateContent",
    });

    expect(url).toBe(
      "https://europe-west1-aiplatform.googleapis.com/v1beta1/projects/my-project/locations/europe-west1/publishers/google/models/gemini-2.5-flash-lite:streamGenerateContent",
    );
  });

  test("builds URL for global endpoint", () => {
    const url = buildGeminiVertexUrl({
      project: "my-project",
      location: "global",
      model: "gemini-2.5-pro",
      method: "generateContent",
    });

    expect(url).toBe(
      "https://aiplatform.googleapis.com/v1beta1/projects/my-project/locations/global/publishers/google/models/gemini-2.5-pro:generateContent",
    );
  });

  test("preserves model ID exactly as provided", () => {
    const url = buildGeminiVertexUrl({
      project: "proj",
      location: "us-central1",
      model: "gemini-2.5-flash-preview-04-17",
      method: "generateContent",
    });

    expect(url).toContain("gemini-2.5-flash-preview-04-17");
  });
});
