export type FetchTokenFn = () => Promise<string>;

interface TokenProviderOptions {
  expiresInMs: number;
  refreshMarginMs: number;
}

const DEFAULT_OPTIONS: TokenProviderOptions = {
  expiresInMs: 3600_000, // 1 hour
  refreshMarginMs: 60_000, // refresh 60s before expiry
};

export class TokenProvider {
  private cachedToken: string | null = null;
  private tokenExpiry = 0;
  private readonly fetchToken: FetchTokenFn;
  private readonly options: TokenProviderOptions;

  constructor(fetchToken: FetchTokenFn, options?: Partial<TokenProviderOptions>) {
    this.fetchToken = fetchToken;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async getToken(): Promise<string> {
    const now = Date.now();
    if (
      this.cachedToken !== null &&
      now < this.tokenExpiry - this.options.refreshMarginMs
    ) {
      return this.cachedToken;
    }

    const token = await this.fetchToken();
    this.cachedToken = token;
    this.tokenExpiry = now + this.options.expiresInMs;
    return token;
  }
}
