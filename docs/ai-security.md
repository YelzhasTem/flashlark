# AI security

Flashlark treats every AI call as an authenticated, metered server operation. Browser UI state and CORS are not security boundaries.

## Endpoints

The production AI surface is limited to:

| Endpoint                     | Class | Units | Minute | Hour | Day | User concurrency | Gemini output tokens |
| ---------------------------- | ----- | ----: | -----: | ---: | --: | ---------------: | -------------------: |
| `getTranslations`            | light |     1 |     12 |   60 | 200 |                2 |                  384 |
| `generateAssociation`        | light |     2 |      8 |   40 | 120 |                2 |                  768 |
| `generateStudyText`          | light |     3 |      5 |   25 |  60 |                1 |                1,024 |
| `generateDeckWithAI`         | heavy |     5 |      3 |   12 |  30 |                1 |                4,096 |
| `importManualCardsFromText`  | heavy |     5 |      3 |   12 |  30 |                1 |                4,096 |
| `importManualCardsFromImage` | heavy |     8 |      2 |    8 |  15 |                1 |                4,096 |
| `generateDeckFromUrl`        | heavy |     8 |      2 |    8 |  15 |                1 |                4,096 |

`generateClozeSentence` was removed because it had no application caller. A new AI function must be added to this list, the server policy, tests, and CI in the same change.

## Authentication

Every AI `createServerFn` must use `requireSupabaseAuth`. The middleware accepts only an `Authorization: Bearer <user JWT>` header and verifies it with Supabase Auth. Missing, malformed, expired, invalid, and anon tokens return `401`. User identity is always taken from verified claims and never from request data.

The browser attaches the current access token through `attachSupabaseAuth`. On `401`, the AI client helper attempts one Supabase session refresh and retries with the same idempotency key. Authentication and metering remain entirely server-side.

## Quotas and budget

`acquire_ai_request` uses PostgreSQL transaction advisory locks to make idempotency, quota, global budget, and concurrency decisions atomically. `complete_ai_request` releases a slot in `finally`; active slots also expire after 90-300 seconds if a serverless invocation is interrupted.

The initial aggregate limits are 80 units per user/hour and 300 units per user/day. Global limits are 50,000 units/day and 25,000 heavy units/day. IP limits are deliberately softer than user limits: 60 requests/minute, 600/hour, 3,000/day, and 10 concurrent requests.

Runtime configuration is stored in `ai_runtime_config`; endpoint weights and limits are stored in `ai_endpoint_policies`. Both are server-only. Browser roles have no table privileges or RPC execution rights. The application server calls quota RPCs with the service role only after validating the user JWT.

To disable AI without a deployment:

```sql
UPDATE public.ai_runtime_config
SET enabled = FALSE, updated_at = clock_timestamp()
WHERE singleton;
```

Re-enable it only after the incident is understood. Individual endpoints can be disabled through `ai_endpoint_policies.enabled`.

## IP privacy

On Vercel, the server reads `x-vercel-forwarded-for`, falling back to Vercel's overwritten `x-forwarded-for`. It ignores client-provided forwarding headers outside Vercel. The address is HMAC-SHA-256 hashed with the server-only `AI_IP_HASH_SALT`; raw IP addresses are never stored or logged. Rotate the salt only when accepting that old and new IP buckets will no longer correlate.

## URL import and SSRF

The only user-controlled server-side URL fetch is the `generateDeckFromUrl` flow:

`dashboard URL field -> authenticated server function -> AI quota/idempotency guard -> safe-url-fetch.server.ts -> bounded text extraction -> Gemini -> validated deck payload`.

URL import accepts only `https:` URLs up to 2,000 characters. Credentials, Unicode or encoded control characters, malformed ports, empty or ambiguous hosts, local names, and metadata names are rejected; fragments are removed before request and redirect-loop comparison. International hostnames are canonicalized with the platform URL parser; hostnames are lowercased and a single DNS trailing dot is removed before policy checks and network use.

Literal addresses and every A/AAAA answer must be globally routable. Private, loopback, link-local, carrier NAT, multicast, unspecified, reserved, documentation, transition, IPv4-compatible, IPv4-mapped IPv6, and metadata ranges are blocked. A mixed DNS answer set is rejected in full.

The validated IP is pinned into the Undici connector used for that exact request while TLS SNI and the HTTP host remain the normalized public hostname. Therefore the request does not perform a second hostname lookup after validation in the current Node/Vercel implementation. Replacing this connector with plain `fetch` would reopen a DNS-rebinding gap and requires a security review.

Redirects use `redirect: "manual"`, allow at most three hops, detect normalized URL loops, support relative `Location`, and repeat the complete protocol, credential, hostname, DNS, and IP validation for every target. A public page cannot redirect into a local address. Incoming authorization headers, cookies, forwarding headers, and server secrets are never forwarded.

Only uncompressed HTML, XHTML, and plain text are accepted. DNS, connect, headers, redirects, and streaming body reads share one 10-second deadline. Responses are checked against `Content-Length`, streamed with a 512 KiB decoded byte cap even when the header is absent or false, and aborted as soon as the cap is crossed. Unsupported, compressed, binary, PDF, archive, and image content is rejected.

The importer does not execute JavaScript, launch a browser, load frames, follow links, or fetch styles, images, scripts, or other subresources. It removes script, style, and markup text locally, collapses the result, and sends at most 12,000 text characters to Gemini. The complete source URL, including query parameters, is not included in the provider prompt. Model output still passes the normal strict schema, field-length, card-count, and minimum-card validation before it reaches the client.

## Input and provider limits

The server function body limit is 3.75 MB, below Vercel's platform limit. Text, arrays, URLs, card counts, and prompt characters have endpoint-specific Zod limits. Images are at most 2.5 MB decoded and must be PNG, JPEG, or WEBP with matching magic bytes and strict base64.

Gemini model selection is server-only through `GEMINI_MODEL`. Temperature, output tokens, retry count, system prompt, and response MIME are fixed in code. Provider calls have a 25-second timeout, at most one retry, and a 1 MB response-body cap. Client-supplied unknown model settings are stripped and ignored.

## Idempotency and errors

Every request carries a UUID idempotency key. The database binds it to the verified user, endpoint, and request hash. A concurrent duplicate or replay never invokes Gemini again. Reusing a key with different input is rejected.

Expected statuses are `400` malformed input, `401` authentication, `403` authorization, `409` duplicate/in-progress, `413` excessive payload, `422` unsafe or unsupported input, `429` quota, `502` provider failure, `503` kill switch/budget/security dependency, and `504` timeout. Responses never include provider bodies, stack traces, prompts, environment variables, keys, or internal URLs.

## Audit and monitoring

`ai_usage_events` stores only user ID, endpoint, timestamp, status, latency, request units, input/output byte counts, hashed IP, idempotency metadata, and a short error category. Rate-limit rejections are aggregated per minute in `ai_rate_limit_rollups`. Prompts, card text, images, AI responses, email, JWTs, API keys, and raw IPs must never be added.

Monitor daily units, heavy units, repeated `429` rollups, active slots near expiry, provider error categories, and per-user spikes. Keep detailed usage for no longer than 30 days unless a shorter operational requirement is sufficient; aggregate older data or delete it through a reviewed server-only maintenance job.

## Adding an endpoint

1. Add `requireSupabaseAuth`, strict input and output schemas, a required idempotency key, and `runAiEndpoint`.
2. Add a conservative request-unit weight, rate limits, concurrency TTL, prompt limit, output-token limit, timeout, and response-size limit.
3. Do not accept `user_id`, model settings, system prompts, retries, or provider limits from the browser.
4. Validate ownership before loading any deck, card, collection, or profile; service-role reads require an explicit ownership check.
5. Add auth, quota, parallelism, replay, payload, provider-mock, and output-validation tests.
6. Update this document and `.github/workflows/ai-security.yml` paths before deployment.
