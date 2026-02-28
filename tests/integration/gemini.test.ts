import { beforeAll, describe, expect, test } from "bun:test";
import { GoogleGenAI } from "@google/genai";

// Integration tests require a running gateway and valid Vertex AI credentials.
// Run with: INTEGRATION=1 VERTEX_GATEWAY_KEY=<key> bun test tests/integration
const INTEGRATION = process.env.INTEGRATION === "1";
const GATEWAY_URL = process.env.GATEWAY_URL ?? "http://localhost:18443";
const VERTEX_GATEWAY_KEY = process.env.VERTEX_GATEWAY_KEY ?? "";

(INTEGRATION ? describe : describe.skip)(
  "Google GenAI SDK → gateway → Vertex AI",
  () => {
    // Initialised in beforeAll so the constructor only runs when tests are
    // actually executed — not during collection/skip, where VERTEX_GATEWAY_KEY
    // would be empty and GoogleGenAI would throw.
    let ai: GoogleGenAI;
    beforeAll(() => {
      ai = new GoogleGenAI({
        apiKey: VERTEX_GATEWAY_KEY,
        httpOptions: { baseUrl: `${GATEWAY_URL}/gemini` },
      });
    });

    test("generates a non-streaming response", async () => {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-lite",
        contents: "Reply with the single word: hello",
      });

      expect(response.text).toBeTruthy();
      expect(response.text?.length).toBeGreaterThan(0);
    });

    test("generates a streaming response", async () => {
      let chunks = 0;
      let fullText = "";

      const stream = await ai.models.generateContentStream({
        model: "gemini-2.5-flash-lite",
        contents: "Count from 1 to 3.",
      });

      for await (const chunk of stream) {
        if (chunk.text) {
          chunks++;
          fullText += chunk.text;
        }
      }

      expect(chunks).toBeGreaterThan(0);
      expect(fullText.length).toBeGreaterThan(0);
    });

    test("routes preview model to global region", async () => {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: "Reply with the single word: hello",
      });

      expect(response.text).toBeTruthy();
      expect(response.text?.length).toBeGreaterThan(0);
    });

    test("returns an error for wrong api key", async () => {
      const badAi = new GoogleGenAI({
        apiKey: "wrong-key",
        httpOptions: { baseUrl: `${GATEWAY_URL}/gemini` },
      });

      await expect(
        badAi.models.generateContent({
          model: "gemini-2.5-flash-lite",
          contents: "Hi",
        }),
      ).rejects.toThrow();
    });
  },
);
