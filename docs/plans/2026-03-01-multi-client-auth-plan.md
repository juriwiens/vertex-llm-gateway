# Multi-Client Authentication Implementation Plan

> **For OpenCode:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement multi-client authentication in the Vertex LLM Gateway using a hot-reloadable `clients.json` file.

**Architecture:** A `ClientManager` class reads and monitors `clients.json` via `fs.watch`, providing an O(1) in-memory lookup map of API keys to client names. Handlers invoke `validateClient` instead of performing simple string comparisons. Legacy `VERTEX_GATEWAY_KEY` serves as a fallback.

**Tech Stack:** Bun, TypeScript, fs.watch

---

### Task 1: Create `ClientManager` Class

**Files:**
- Create: `src/clients.ts`
- Create: `src/clients.test.ts`

**Step 1: Write the failing test**

```typescript
// src/clients.test.ts
import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { ClientManager } from "./clients.ts";
import { unlinkSync, writeFileSync, mkdirSync } from "node:fs";

describe("ClientManager", () => {
  const testConfigPath = "/tmp/clients-test.json";

  afterAll(() => {
    try { unlinkSync(testConfigPath); } catch {}
  });

  test("loads valid clients.json", async () => {
    writeFileSync(testConfigPath, JSON.stringify({ "key-123": "app-1" }));
    const manager = new ClientManager(testConfigPath);
    // Wait a tick for async load
    await new Promise(r => setTimeout(r, 10));
    
    expect(manager.validateClient("key-123")).toBe("app-1");
    expect(manager.validateClient("wrong-key")).toBeNull();
  });

  test("falls back to default key if file missing", async () => {
    const manager = new ClientManager("/tmp/does-not-exist.json", "fallback-key");
    await new Promise(r => setTimeout(r, 10));
    expect(manager.validateClient("fallback-key")).toBe("default-client");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/clients.test.ts`
Expected: FAIL with "Cannot find module './clients.ts'"

**Step 3: Write minimal implementation**

```typescript
// src/clients.ts
import { watch } from "node:fs";

export class ClientManager {
  private clients = new Map<string, string>();
  private readonly configPath: string;
  private readonly defaultKey?: string;

  constructor(configPath: string, defaultKey?: string) {
    this.configPath = configPath;
    this.defaultKey = defaultKey;
    this.loadConfig();
    this.startWatching();
  }

  private async loadConfig() {
    try {
      const file = Bun.file(this.configPath);
      if (await file.exists()) {
        const data = await file.json();
        const newMap = new Map<string, string>();
        for (const [key, value] of Object.entries(data)) {
            if (typeof key === 'string' && typeof value === 'string') {
                newMap.set(key, value);
            }
        }
        this.clients = newMap;
      } else {
        this.applyFallback();
      }
    } catch (e) {
      console.error(`[ClientManager] Failed to load clients config:`, e);
      // Don't clear existing clients map if parsing fails
      if (this.clients.size === 0) {
        this.applyFallback();
      }
    }
  }

  private applyFallback() {
    const newMap = new Map<string, string>();
    if (this.defaultKey) {
      newMap.set(this.defaultKey, "default-client");
    }
    this.clients = newMap;
  }

  private startWatching() {
    try {
      // Use fs.watch (from Node core) wrapped in try-catch in case path is totally invalid for watching
      watch(this.configPath, { persistent: false }, (event, filename) => {
        if (event === "change") {
          this.loadConfig();
        }
      });
    } catch (e) {
      // Ignored for now (e.g. dir doesn't exist)
    }
  }

  validateClient(apiKey: string): string | null {
    return this.clients.get(apiKey) || null;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/clients.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/clients.ts src/clients.test.ts
git commit -m "feat(auth): create ClientManager for hot-reloading clients.json"
```

---

### Task 2: Update Server Configuration & Gateway Init

**Files:**
- Modify: `src/server.ts`
- Modify: `src/server.test.ts`

**Step 1: Modify GatewayConfig interface and handler definitions**

```typescript
// src/server.ts (Modify GatewayConfig)
export interface GatewayConfig {
  project: string;
  location: string;
  overrides: Record<string, string>;
  geminiLocationOverrides: Record<string, string>;
  getToken: () => Promise<string>;
  validateClient: (apiKey: string) => string | null; // <--- REPLACE gatewayKey
  port: number;
}
```

**Step 2: Initialize `ClientManager` in server startup**

```typescript
// src/server.ts (Modify gateway startup function, near line 148)
  import { ClientManager } from "./clients.ts";
  import { join } from "node:path";
  
  // ... inside if (import.meta.main) ...
  const gatewayKey = process.env.VERTEX_GATEWAY_KEY;

  const clientsJsonPath = join(process.cwd(), "clients.json");
  const clientManager = new ClientManager(clientsJsonPath, gatewayKey);

  const server = createGatewayServer({
    project,
    location,
    overrides,
    geminiLocationOverrides,
    getToken: () => tokenProvider.getToken(),
    validateClient: (apiKey: string) => clientManager.validateClient(apiKey),
    port,
  });
```

**Step 3: Update `server.test.ts` to mock `validateClient`**

```typescript
// src/server.test.ts (Find `gatewayKey: "test-gateway-key"` and replace it)
  // Search for: gatewayKey: "test-gateway-key"
  // Replace with: validateClient: (key) => key === "test-gateway-key" ? "test-client" : null
```

**Step 4: Run server tests to verify it fails**

Run: `bun test src/server.test.ts`
Expected: Type errors in handlers because `GatewayConfig` now has `validateClient`, but the handlers still expect `gatewayKey`.

**Step 5: Commit**

```bash
git add src/server.ts src/server.test.ts
git commit -m "refactor(server): inject validateClient into GatewayConfig"
```

---

### Task 3: Update Anthropic Handler

**Files:**
- Modify: `src/anthropic/handler.ts`

**Step 1: Update interface and logic**

```typescript
// src/anthropic/handler.ts
export interface AnthropicHandlerConfig {
  project: string;
  location: string;
  overrides: Record<string, string>;
  getToken: () => Promise<string>;
  validateClient: (apiKey: string) => string | null; // <--- Changed
}

export async function handleAnthropicMessages(
  req: Request,
  config: AnthropicHandlerConfig,
): Promise<Response> {
  const apiKey = req.headers.get("x-api-key");
  const clientName = apiKey ? config.validateClient(apiKey) : null;
  
  if (!clientName) {
    console.warn("[anthropic] 401 – x-api-key missing or wrong");
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ... rest of code remains the same ...
```

**Step 2: Run Anthropic tests**

Run: `bun test src/server.test.ts`
Expected: Anthropic tests pass. Gemini tests still fail.

**Step 3: Commit**

```bash
git add src/anthropic/handler.ts
git commit -m "feat(anthropic): use dynamic client validation"
```

---

### Task 4: Update Gemini Handler

**Files:**
- Modify: `src/gemini/handler.ts`

**Step 1: Update interface and logic**

```typescript
// src/gemini/handler.ts
export interface GeminiHandlerConfig {
  project: string;
  location: string;
  locationOverrides: Record<string, string>;
  getToken: () => Promise<string>;
  validateClient: (apiKey: string) => string | null; // <--- Changed
}

export async function handleGeminiGenerateContent(
  req: Request,
  model: string,
  method: string,
  config: GeminiHandlerConfig,
): Promise<Response> {
  // API key may arrive as header (x-goog-api-key) or query param (?key=)
  const url = new URL(req.url);
  const apiKey =
    req.headers.get("x-goog-api-key") ?? url.searchParams.get("key");
  const clientName = apiKey ? config.validateClient(apiKey) : null;
    
  if (!clientName) {
    console.warn("[gemini] 401 – x-goog-api-key / ?key= missing or wrong");
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ... rest of code remains the same ...
```

**Step 2: Run all tests to verify**

Run: `bun test src`
Expected: All tests PASS.

**Step 3: Commit**

```bash
git add src/gemini/handler.ts
git commit -m "feat(gemini): use dynamic client validation"
```
