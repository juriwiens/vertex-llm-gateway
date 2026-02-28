import { describe, test, expect } from "bun:test";
import { toVertexRequest, buildVertexUrl } from "./transform";

describe("toVertexRequest", () => {
  test("removes model from body and adds anthropic_version", () => {
    const anthropicBody = {
      model: "claude-opus-4-6",
      messages: [{ role: "user", content: "Hello" }],
      max_tokens: 100,
    };

    const result = toVertexRequest(anthropicBody);

    expect(result).toEqual({
      anthropic_version: "vertex-2023-10-16",
      messages: [{ role: "user", content: "Hello" }],
      max_tokens: 100,
    });
    expect(result).not.toHaveProperty("model");
  });

  test("preserves all other fields from the original body", () => {
    const anthropicBody = {
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 4096,
      temperature: 0.7,
      system: "You are helpful.",
      stream: true,
    };

    const result = toVertexRequest(anthropicBody);

    expect(result).toEqual({
      anthropic_version: "vertex-2023-10-16",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 4096,
      temperature: 0.7,
      system: "You are helpful.",
      stream: true,
    });
  });

  test("does not mutate the original body", () => {
    const anthropicBody = {
      model: "claude-opus-4-6",
      messages: [{ role: "user", content: "Hello" }],
      max_tokens: 100,
    };

    toVertexRequest(anthropicBody);

    expect(anthropicBody).toHaveProperty("model");
  });
});

describe("buildVertexUrl", () => {
  test("builds URL for regional endpoint", () => {
    const url = buildVertexUrl({
      project: "my-project",
      location: "europe-west1",
      vertexModelId: "claude-opus-4-6",
      stream: true,
    });

    expect(url).toBe(
      "https://europe-west1-aiplatform.googleapis.com/v1/projects/my-project/locations/europe-west1/publishers/anthropic/models/claude-opus-4-6:streamRawPredict",
    );
  });

  test("builds URL for global endpoint", () => {
    const url = buildVertexUrl({
      project: "my-project",
      location: "global",
      vertexModelId: "claude-sonnet-4-6",
      stream: true,
    });

    expect(url).toBe(
      "https://aiplatform.googleapis.com/v1/projects/my-project/locations/global/publishers/anthropic/models/claude-sonnet-4-6:streamRawPredict",
    );
  });

  test("uses rawPredict for non-streaming requests", () => {
    const url = buildVertexUrl({
      project: "my-project",
      location: "europe-west1",
      vertexModelId: "claude-opus-4-6",
      stream: false,
    });

    expect(url).toBe(
      "https://europe-west1-aiplatform.googleapis.com/v1/projects/my-project/locations/europe-west1/publishers/anthropic/models/claude-opus-4-6:rawPredict",
    );
  });
});
