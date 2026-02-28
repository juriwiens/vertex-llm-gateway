import { describe, test, expect, mock, beforeEach } from "bun:test";
import { TokenProvider } from "./auth";

describe("TokenProvider", () => {
  test("fetches a token on first call", async () => {
    const fetchToken = mock(() => Promise.resolve("ya29.first-token"));
    const provider = new TokenProvider(fetchToken);

    const token = await provider.getToken();

    expect(token).toBe("ya29.first-token");
    expect(fetchToken).toHaveBeenCalledTimes(1);
  });

  test("returns cached token on subsequent calls within expiry window", async () => {
    const fetchToken = mock(() => Promise.resolve("ya29.cached-token"));
    const provider = new TokenProvider(fetchToken, {
      expiresInMs: 3600_000,
      refreshMarginMs: 60_000,
    });

    await provider.getToken();
    const token = await provider.getToken();

    expect(token).toBe("ya29.cached-token");
    expect(fetchToken).toHaveBeenCalledTimes(1);
  });

  test("refreshes token when within refresh margin of expiry", async () => {
    let callCount = 0;
    const fetchToken = mock(() => {
      callCount++;
      return Promise.resolve(`ya29.token-${callCount}`);
    });

    const provider = new TokenProvider(fetchToken, {
      expiresInMs: 100,
      refreshMarginMs: 50,
    });

    await provider.getToken();
    // Wait until within refresh margin
    await Bun.sleep(60);
    const token = await provider.getToken();

    expect(token).toBe("ya29.token-2");
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });

  test("propagates errors from the token fetcher", async () => {
    const fetchToken = mock(() =>
      Promise.reject(new Error("ADC not configured")),
    );
    const provider = new TokenProvider(fetchToken);

    await expect(provider.getToken()).rejects.toThrow("ADC not configured");
  });
});
