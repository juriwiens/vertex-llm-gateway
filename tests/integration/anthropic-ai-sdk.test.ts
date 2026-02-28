import { beforeAll, describe, expect, test } from "bun:test";
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, streamText } from "ai";

// Tests the @ai-sdk/anthropic (Vercel AI SDK) path — exactly what OpenCode uses.
// With baseURL set to …/anthropic (no /v1), the SDK appends "/messages" directly,
// hitting the /anthropic/messages alias route in the gateway.
//
// Integration tests run by default when VERTEX_GATEWAY_KEY is set.
// Force-skip with: INTEGRATION=0 bun test
const GATEWAY_URL = process.env.GATEWAY_URL ?? "http://localhost:18443";
const VERTEX_GATEWAY_KEY = process.env.VERTEX_GATEWAY_KEY ?? "";
const INTEGRATION =
  process.env.INTEGRATION !== "0" && VERTEX_GATEWAY_KEY !== "";

(INTEGRATION ? describe : describe.skip)(
  "@ai-sdk/anthropic → /anthropic/messages → Vertex AI (OpenCode path)",
  () => {
    let anthropic: ReturnType<typeof createAnthropic>;

    beforeAll(() => {
      anthropic = createAnthropic({
        apiKey: VERTEX_GATEWAY_KEY,
        // No /v1 suffix — @ai-sdk/anthropic appends /messages, hitting
        // the /anthropic/messages alias that mirrors OpenCode's behaviour.
        baseURL: `${GATEWAY_URL}/anthropic`,
      });
    });

    test("generates a non-streaming response", async () => {
      const { text } = await generateText({
        model: anthropic("claude-sonnet-4-6"),
        prompt: "Reply with the single word: hello",
        maxTokens: 64,
      });

      expect(text.length).toBeGreaterThan(0);
    });

    test("generates a streaming response", async () => {
      const { textStream } = streamText({
        model: anthropic("claude-sonnet-4-6"),
        prompt: "Count from 1 to 3.",
        maxTokens: 64,
      });

      let fullText = "";
      for await (const chunk of textStream) {
        fullText += chunk;
      }

      expect(fullText.length).toBeGreaterThan(0);
    });

    test("returns error for wrong api key", async () => {
      const badAnthropic = createAnthropic({
        apiKey: "wrong-key",
        baseURL: `${GATEWAY_URL}/anthropic`,
      });

      let threw = false;
      try {
        await generateText({
          model: badAnthropic("claude-sonnet-4-6"),
          prompt: "Hi",
          maxTokens: 10,
        });
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });
  },
);
