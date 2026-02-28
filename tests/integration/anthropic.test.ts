import { describe, expect, test } from "bun:test";
import Anthropic from "@anthropic-ai/sdk";

// Integration tests require a running gateway and valid Vertex AI credentials.
// Run with: INTEGRATION=1 VERTEX_GATEWAY_KEY=<key> bun test tests/integration
const INTEGRATION = process.env.INTEGRATION === "1";
const GATEWAY_URL = process.env.GATEWAY_URL ?? "http://localhost:18443";
const VERTEX_GATEWAY_KEY = process.env.VERTEX_GATEWAY_KEY ?? "";

(INTEGRATION ? describe : describe.skip)(
  "Anthropic SDK → gateway → Vertex AI",
  () => {
    const client = new Anthropic({
      apiKey: VERTEX_GATEWAY_KEY,
      baseURL: `${GATEWAY_URL}/anthropic`,
    });

    test("generates a non-streaming response", async () => {
      const msg = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 64,
        messages: [
          { role: "user", content: "Reply with the single word: hello" },
        ],
      });

      expect(msg.type).toBe("message");
      expect(msg.content.length).toBeGreaterThan(0);
      const first = msg.content[0];
      expect(first?.type).toBe("text");
      expect((first as Anthropic.TextBlock).text.length).toBeGreaterThan(0);
    });

    test("generates a streaming response", async () => {
      let chunks = 0;
      let fullText = "";

      const stream = client.messages.stream({
        model: "claude-sonnet-4-6",
        max_tokens: 64,
        messages: [{ role: "user", content: "Count from 1 to 3." }],
      });

      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          chunks++;
          fullText += event.delta.text;
        }
      }

      expect(chunks).toBeGreaterThan(0);
      expect(fullText.length).toBeGreaterThan(0);
    });

    test("returns 401 for wrong api key", async () => {
      const badClient = new Anthropic({
        apiKey: "wrong-key",
        baseURL: `${GATEWAY_URL}/anthropic`,
      });

      let threw = false;
      try {
        await badClient.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 10,
          messages: [{ role: "user", content: "Hi" }],
        });
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });
  },
);
