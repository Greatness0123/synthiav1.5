# Phase 1: Serverless AI Proxy Layer — Complete

## Overview
Phase 1 implements a stateless, secure, client-side proxy layer deployed via **Vercel Edge Functions**. This structure ensures that Large Language Model (LLM) provider API keys are never shipped to client-side browser environments, preventing potential extraction via network inspection or JavaScript bundle analysis.

---

## 1. Wired Providers & API Endpoints

The proxy layer exposes two Edge-runtime Vercel endpoints:

### `/api/infer/gemini.ts`
- **Description**: Handles proxying to the Google Gemini API.
- **Upstream Endpoint**: `https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse`
- **Request Format**: Receives `{ model?: string, payload: Record<string, any> }` from the client.
- **Server Environment Variable**: `GEMINI_API_KEY`

### `/api/infer/openai-compat.ts`
- **Description**: Handled with a provider allow-list mapping identifier to base URLs, preventing open relay exploits.
- **Allow-listed Providers**:
  - `groq`: `https://api.groq.com/openai/v1/chat/completions` (Server Environment Variable: `GROQ_API_KEY`)
  - `openrouter`: `https://openrouter.ai/api/v1/chat/completions` (Server Environment Variable: `OPENROUTER_API_KEY`)
  - `nim`: `https://integrate.api.nvidia.com/v1/chat/completions` (Server Environment Variable: `NIM_API_KEY`)
  - `openai`: `https://api.openai.com/v1/chat/completions` (Server Environment Variable: `OPENAI_API_KEY`)
- **Request Format**: Receives `{ provider: string, payload: Record<string, any> }` from the client.

---

## 2. Abuse Prevention (Shared-Secret Authentication)

Both endpoints validate incoming requests using a shared secret check to mitigate automated scanning, casual crawlers, and API hammering.
- **Header**: `Authorization: Bearer <secret>`
- **Server Environment Variable**: `SYNTHIA_SHARED_SECRET`
- **Behavior**:
  - If `SYNTHIA_SHARED_SECRET` is not set on the Vercel server, returns `500 Internal Server Error` with a safety alert.
  - If the header is missing, incorrect, or malformed, returns `401 Unauthorized` without leaking any upstream configuration/diagnostics.

---

## 3. Streaming and Timeouts

- **Edge Runtime**: Both routes utilize Vercel Edge Runtime (`export const config = { runtime: 'edge' }`).
- **No Buffering**: Upstream responses are piped raw through a `ReadableStream` straight back to the client as Server-Sent Events (SSE) or chunk streams.
- **Fast First Token**: Tokens are streamed immediately upon arrival, avoiding Vercel's standard Serverless Function timeouts on long completions.

---

## 4. Test Verification Summary

A comprehensive test suite was written in `tests/apiProxy.test.ts` and successfully executed:

```bash
npx jest tests/apiProxy.test.ts --testMatch='**/tests/apiProxy.test.ts'
```

### Test Results:
```text
 PASS tests/apiProxy.test.ts
  Serverless AI Proxy Layer Tests
    Authorization Checks
      ✓ should return 401 if Authorization header is missing (10 ms)
      ✓ should return 401 if Authorization header has wrong token (2 ms)
      ✓ should return 500 if SYNTHIA_SHARED_SECRET is not configured on server (2 ms)
    Gemini Proxy Handler
      ✓ should return 400 if payload is missing (2 ms)
      ✓ should return 500 if GEMINI_API_KEY is missing on server (3 ms)
      ✓ should correctly proxy successful Gemini request and stream response (5 ms)
      ✓ should handle and pass through Gemini API errors (2 ms)
    OpenAI-compatible Proxy Handler
      ✓ should return 400 if provider is missing (2 ms)
      ✓ should return 400 for unsupported or disallowed provider (2 ms)
      ✓ should return 500 if provider API key is missing on server (2 ms)
      ✓ should correctly proxy successful Groq request and stream response (2 ms)
      ✓ should inject Referer and Title headers for OpenRouter requests (2 ms)

Test Suites: 1 passed, 1 total
Tests:       12 passed, 12 total
Snapshots:   0 total
Time:        0.556 s
```

### Confirmed Non-Exposure Checks:
- **Zero API Keys in Codebase/Bundle**: Searched build outputs and client-side files (`src/`). All keys remain strictly in serverless runtime variables.
- **Stream Retention**: Confirmed that `ReadableStream` handles chunks incrementally and returns immediately on the first token.
- **Clean Errors**: Unauthorized headers cleanly return a custom 401 without revealing internal variables.
