# vertex-llm-gateway

Local API gateway that accepts standard API-key-based requests for Anthropic Claude and Google Gemini models, and forwards them to Vertex AI authenticated via the host's Application Default Credentials (ADC).

## Why

Many applications only support API-key-based LLM APIs (Anthropic, Gemini). This gateway bridges the gap to Vertex AI without requiring changes to those applications — just point their base URL at the gateway.

- **API-key auth on the way in** — apps use a locally configured gateway key, just like a real API key
- **ADC auth on the way out** — the gateway authenticates to Vertex AI using host credentials; no tokens or service account keys leave the machine
- **API translation** — transforms consumer API request formats to their Vertex AI equivalents
- **Provider routing** — a path prefix (`/anthropic`, `/gemini`) determines which backend is used

## How it works

```
App / SDK                              Host                         Google Cloud
─────────────                          ────                         ────────────
POST /anthropic/v1/messages       ──►  vertex-llm-gateway  ──►  Vertex AI rawPredict
x-api-key: <gateway-key>               - validates gateway key       (Anthropic Claude)
model: claude-sonnet-4-6               - transforms request
                                       - injects Bearer token

POST /gemini/v1beta/models/       ──►  vertex-llm-gateway  ──►  Vertex AI generateContent
  gemini-2.5-flash-lite:generateContent     - validates gateway key       (Google Gemini)
x-goog-api-key: <gateway-key>          - rewrites URL
                                       - injects Bearer token
```

## Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Returns `{"status": "ok"}` |
| `POST` | `/anthropic/v1/messages` | Anthropic Messages API → Vertex AI `rawPredict` / `streamRawPredict` |
| `POST` | `/gemini/v1beta/models/{model}:generateContent` | Gemini API → Vertex AI `generateContent` |
| `POST` | `/gemini/v1beta/models/{model}:streamGenerateContent` | Gemini API → Vertex AI `streamGenerateContent` |

## Setup

### Prerequisites

- [Bun](https://bun.sh) runtime
- Google Cloud credentials — any of the following:
  - **ADC (recommended for local dev):** `gcloud auth application-default login`
  - **Service Account:** set `GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json`
  - **Hosted environment** (GCE, Cloud Run, …): credentials are picked up automatically from the metadata server
- A GCP project with the Vertex AI API enabled and model access for Claude and/or Gemini

### Install and run

```bash
bun install
VERTEX_PROJECT=my-gcp-project VERTEX_GATEWAY_KEY=my-secret-key bun run src/server.ts
```

The gateway listens on port **18443** by default (override with `GATEWAY_PORT`).

### Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `VERTEX_PROJECT` | yes* | — | GCP project ID |
| `GOOGLE_CLOUD_PROJECT` | yes* | — | Alternative to `VERTEX_PROJECT` |
| `VERTEX_GATEWAY_KEY` | yes | — | Secret key clients must send |
| `VERTEX_LOCATION` | no | `europe-west1` | Vertex AI region |
| `GATEWAY_PORT` | no | `18443` | Port to listen on |
| `GOOGLE_APPLICATION_CREDENTIALS` | no | — | Path to a service account JSON key file |

\* One of `VERTEX_PROJECT` or `GOOGLE_CLOUD_PROJECT` must be set.

The gateway uses `google-auth-library` which follows the standard [ADC lookup chain](https://github.com/googleapis/google-auth-library-nodejs#choosing-the-correct-credential-type-automatically): `GOOGLE_APPLICATION_CREDENTIALS` → gcloud user credentials → GCP metadata server. No code changes are needed to switch between credential types.

### Run as macOS LaunchAgent

Create `~/Library/LaunchAgents/com.vertex-llm-gateway.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.vertex-llm-gateway</string>
  <key>ProgramArguments</key>
  <array>
    <string>/path/to/.bun/bin/bun</string>
    <string>run</string>
    <string>/path/to/vertex-llm-gateway/src/server.ts</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>VERTEX_PROJECT</key>
    <string>my-gcp-project</string>
    <key>VERTEX_GATEWAY_KEY</key>
    <string>my-secret-key</string>
  </dict>
  <key>StandardOutPath</key>
  <string>/Users/me/Library/Logs/vertex-llm-gateway.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/me/Library/Logs/vertex-llm-gateway.log</string>
  <key>KeepAlive</key>
  <true/>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
```

```bash
# Start
launchctl load ~/Library/LaunchAgents/com.vertex-llm-gateway.plist

# Stop
launchctl unload ~/Library/LaunchAgents/com.vertex-llm-gateway.plist

# View logs
tail -f ~/Library/Logs/vertex-llm-gateway.log
```

## Usage

### Anthropic SDK

```typescript
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: "my-secret-key",       // must match VERTEX_GATEWAY_KEY
  baseURL: "http://localhost:18443/anthropic",
});

const msg = await client.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello!" }],
});
```

### Google GenAI SDK (`@google/genai`)

```typescript
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: "my-secret-key",       // must match VERTEX_GATEWAY_KEY
  httpOptions: { baseUrl: "http://localhost:18443/gemini" },
});

const response = await ai.models.generateContent({
  model: "gemini-2.5-flash-lite",
  contents: "Hello!",
});
```

### Docker Sandboxes (Anthropic agents)

```dockerfile
ENV ANTHROPIC_API_KEY=my-secret-key
ENV ANTHROPIC_BASE_URL=http://host.docker.internal:18443/anthropic
```

The agent inside the container uses the standard Anthropic SDK — it does not know it's talking to Vertex AI.

## Request transformation

**Anthropic → Vertex AI** (`src/anthropic/transform.ts`):
1. `model` field moves from the JSON body into the Vertex AI URL path
2. `anthropic_version: "vertex-2023-10-16"` is added to the body
3. `x-api-key` is replaced with `Authorization: Bearer <ADC token>`
4. The response (including SSE streams) is passed through unchanged

**Gemini → Vertex AI** (`src/gemini/transform.ts`):
1. The consumer Gemini URL is rewritten to the Vertex AI `publishers/google` path
2. `x-goog-api-key` header (or `?key=` query param) is replaced with `Authorization: Bearer <ADC token>`
3. The request body and response are passed through unchanged

## Model ID mapping (Anthropic only)

Most Anthropic model IDs are identical on Vertex AI. Exceptions are listed in `model-overrides.json` (Anthropic uses `-YYYYMMDD`, Vertex AI uses `@YYYYMMDD`):

```json
{
  "claude-haiku-4-5-20251001": "claude-haiku-4-5@20251001",
  "claude-haiku-4-5": "claude-haiku-4-5@20251001"
}
```

## Tests

```bash
# Unit tests (no credentials needed)
bun test

# Integration tests (requires running gateway + Vertex AI credentials)
INTEGRATION=1 VERTEX_GATEWAY_KEY=my-secret-key bun run test:integration
```
