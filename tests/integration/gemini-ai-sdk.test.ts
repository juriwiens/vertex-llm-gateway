import { beforeAll, describe, expect, test } from "bun:test";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText, streamText } from "ai";

// Tests the @ai-sdk/google (Vercel AI SDK) path — what OpenCode uses for Gemini.
// With baseURL set to …/gemini/v1beta, the SDK constructs:
//   {baseURL}/models/{model}:generateContent
//   {baseURL}/models/{model}:streamGenerateContent
// which matches the gateway's /gemini/v1beta/models/:modelMethod route.
//
// Integration tests run by default when VERTEX_GATEWAY_KEY is set.
// Force-skip with: INTEGRATION=0 bun test
const GATEWAY_URL = process.env.GATEWAY_URL ?? "http://localhost:18443";
const VERTEX_GATEWAY_KEY = process.env.VERTEX_GATEWAY_KEY ?? "";
const INTEGRATION =
  process.env.INTEGRATION !== "0" && VERTEX_GATEWAY_KEY !== "";

(INTEGRATION ? describe : describe.skip)(
  "@ai-sdk/google → /gemini/v1beta/models → Vertex AI (OpenCode path)",
  () => {
    let google: ReturnType<typeof createGoogleGenerativeAI>;

    beforeAll(() => {
      google = createGoogleGenerativeAI({
        apiKey: VERTEX_GATEWAY_KEY,
        baseURL: `${GATEWAY_URL}/gemini/v1beta`,
      });
    });

    test("generates a non-streaming response", async () => {
      const { text } = await generateText({
        model: google("gemini-2.5-flash-lite"),
        prompt: "Reply with the single word: hello",
        maxTokens: 64,
      });

      expect(text.length).toBeGreaterThan(0);
    });

    test("generates a streaming response", async () => {
      const { textStream } = streamText({
        model: google("gemini-2.5-flash-lite"),
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
      const badGoogle = createGoogleGenerativeAI({
        apiKey: "wrong-key",
        baseURL: `${GATEWAY_URL}/gemini/v1beta`,
      });

      let threw = false;
      try {
        await generateText({
          model: badGoogle("gemini-2.5-flash-lite"),
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
