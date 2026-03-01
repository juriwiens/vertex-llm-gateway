# Multi-Client Authentication Design

## Overview

This document outlines the design for adding multi-client support to the Vertex LLM Gateway. The goal is to allow multiple applications or clients to use the gateway, each identifying themselves with a unique API key. This enables better access control and tracking of which client is making requests.

## Architecture & Configuration

The gateway will use a file-based configuration approach to manage client API keys.

1.  **Configuration File (`clients.json`):**
    A JSON file will store the mapping of API keys to client names. This file acts as the single source of truth for authorized clients.
    
    *Example `clients.json`:*
    ```json
    {
      "key-app1-abc123": "my-webapp",
      "key-app2-def456": "my-cli-tool"
    }
    ```

2.  **`ClientManager` Class (`src/clients.ts`):**
    A new class responsible for loading and managing the client configuration in memory.
    *   **Data Structure:** Uses a `Map<string, string>` (API Key -> Client Name) for O(1) constant-time lookups during request authentication.
    *   **Initialization:** Asynchronously loads the `clients.json` file on startup.
    *   **Backward Compatibility:** If a legacy `VERTEX_GATEWAY_KEY` environment variable is present, it will be injected into the in-memory map (e.g., mapped to the name `"default-client"`) to ensure existing setups do not break.

## Hot-Reloading

To avoid gateway downtime when adding or removing clients, the configuration will support hot-reloading.

*   **File Watching:** The `ClientManager` will utilize Bun's native `fs.watch` to monitor the `clients.json` file for `change` events.
*   **Graceful Updates:** Upon detecting a change, the manager will asynchronously read and parse the updated file. The internal `Map` is atomically replaced only if parsing succeeds.
*   **Error Handling:** If the updated JSON is invalid (e.g., syntax error during manual editing), the parser error is logged to the console, but the gateway continues to use the last known valid configuration map. This prevents configuration typos from crashing the server or locking out all clients.

## Integration & Request Handling

The authentication logic in the request handlers will be updated to use the `ClientManager`.

1.  **Server Initialization (`src/server.ts`):**
    The `createGatewayServer` configuration interfaces (`GatewayConfig`, `AnthropicHandlerConfig`, `GeminiHandlerConfig`) will be updated. Instead of a static `gatewayKey: string`, they will receive a validation function (e.g., `validateClient: (apiKey: string) => string | null`).

2.  **Authentication Flow (`src/anthropic/handler.ts`, `src/gemini/handler.ts`):**
    *   The handler extracts the API key from the request header (`x-api-key` or `x-goog-api-key`) or query parameter (`?key=`).
    *   It calls `validateClient(apiKey)`.
    *   If the result is `null` (key not found), the handler returns a `401 Unauthorized` response.
    *   If the result is a string (the client name), the request is authorized and processing continues.

3.  **Logging:**
    To prevent excessive noise in high-throughput environments, the gateway **will not** log successful requests per client. Only startup events (e.g., configuration loaded) and errors (e.g., invalid JSON format, 401 Unauthorized attempts) will be logged.
