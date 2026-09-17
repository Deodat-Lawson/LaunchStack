# images — image generation across incompatible endpoints

**What it is.** One function, `generateImages()`, that produces image bytes from
a prompt regardless of which vendor the deployment points at. Three vendors
expose image generation through three incompatible HTTP shapes, and which one
you get is decided by a base URL in someone's `.env`. Moving from OpenRouter to
Gemini must not be a code change.

**How it works.** The request is expressed once in our vocabulary; a backend per
wire shape translates it. `shape.ts` picks the backend from the base URL, so the
choice follows configuration rather than a call site.

| Shape                | Endpoint                        | Chosen for                                            | Can edit? |
| -------------------- | ------------------------------- | ----------------------------------------------------- | --------- |
| `chat-completions`   | `POST /chat/completions`        | `openrouter.ai`, `gateway.ai.cloudflare.com`           | Yes       |
| `images-generations` | `POST /images/generations`      | `api.openai.com`, Google's `/openai` path, unknown hosts | No      |
| `gemini-native`      | `POST /models/{id}:generateContent` | `generativelanguage.googleapis.com` without `/openai` | Yes   |

Google is the awkward one: it serves *both* shapes off the same host, split by
path, so the hostname alone cannot decide it. Anything unrecognised falls back
to `images-generations`, the de facto standard. An operator whose gateway breaks
that assumption sets `shape` explicitly rather than us guessing harder — a wrong
guess produces a confusing 404, an explicit override documents itself.

**Warnings, not silent drops.** An endpoint that cannot honour part of a request
says so in `result.warnings` and still returns the image. Asking
`images-generations` to edit an input image, or asking any backend for four
images when it returns one per call, produces a warning rather than a failure or
a silent lie. The pattern is lifted from the Vercel AI SDK's `generateImage`,
whose `warnings` array is the only honest answer to "provider B has no concept
of seed".

**Failures.** Every path throws `ImageGenerationError` — never a bare fetch
error — carrying `code`, `status` and `retryable`, so a caller branches on a
field instead of parsing a message. 4xx is non-retryable except 408 and 429; 5xx
and transport errors are retryable; a caller's own abort is rethrown untouched
so a cancellation never looks like a provider fault.

**What is deliberately not here.** Persistence, metering, retries and access
control. Those are policy and belong at the call site — in this repo that is
[`@launchstack/tools/image-generation`](../../../tools/src/image-generation),
which is also the layer that turns these bytes into a stored asset. This module
speaks HTTP and nothing else.

```ts
import { generateImages } from "@launchstack/llm/images";

const { images, warnings, shape } = await generateImages(
    { prompt: "a duck on a bicycle", modelId: "google/gemini-2.5-flash-image", aspectRatio: "16:9" },
    { baseUrl: process.env.CHAT_BASE_URL!, apiKey: process.env.CHAT_API_KEY! },
);
```
