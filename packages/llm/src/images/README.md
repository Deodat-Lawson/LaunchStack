# images — image generation across incompatible endpoints

**What it is.** One function, `generateImages()`, that produces image bytes from
a prompt regardless of which vendor the deployment points at. Three vendors
expose image generation through three incompatible HTTP shapes, and which one
you get is decided by a base URL in someone's `.env`. Moving from OpenRouter to
Gemini must not be a code change.

**How it works.** The request is expressed once in our vocabulary; the Vercel AI
SDK (`ai`, Apache-2.0) plus one provider per dialect does the vendor-specific
translation. `shape.ts` picks the provider from the base URL, so the choice
follows configuration rather than a call site.

| Shape               | Driver                        | Endpoint                       | Chosen for                                         |
| ------------------- | ----------------------------- | ------------------------------ | -------------------------------------------------- |
| `openrouter`        | `@openrouter/ai-sdk-provider` | `POST /images`                 | `openrouter.ai`                                     |
| `openai-compatible` | `@ai-sdk/openai`              | `POST /images/generations`     | `api.openai.com`, Google's `/openai` path, unknown hosts |
| `google-native`     | `@ai-sdk/google`              | `POST …:generateContent`       | `generativelanguage.googleapis.com` without `/openai` |

Two things in that table are worth knowing before you trust the docs over the
code. OpenRouter *documents* image generation over `/chat/completions` with
`modalities`, but its own provider (v3) targets a dedicated `/images` endpoint —
established by reading the installed package. And Google serves two of these
shapes off one host, split by path, so the hostname alone cannot decide it.

Anything unrecognised falls back to `openai-compatible`, the de facto standard.
An operator whose gateway breaks that assumption sets `shape` explicitly rather
than us guessing harder — a wrong guess produces a confusing 404, an explicit
override documents itself.

**Why three drivers and not thirty.** Drivers grow with *dialects*, not models.
A model id is a config string, so supporting a new model costs an edit; the
number of dialects is set by how vendors designed their APIs and changes about
once a year. Capability (can it edit, does it honour aspect ratio) does vary per
model, and today we infer it per shape — if that ever bites, `chat-models.yaml`
is the precedent for declaring it as data.

**Warnings, not silent drops.** An endpoint that cannot honour part of a request
says so in `result.warnings` and still returns the image. Asking
`openai-compatible` to edit an input image, or asking any backend for four
images when it returns one per call, produces a warning rather than a failure or
a silent lie. The pattern is lifted from the Vercel AI SDK's `generateImage`,
whose `warnings` array is the only honest answer to "provider B has no concept
of seed".

**Failures.** Every path throws `ImageGenerationError` — never a raw SDK error —
carrying `code`, `status` and `retryable`, so a caller branches on a field
instead of knowing which library made the request. 4xx is non-retryable except 408 and 429; 5xx
and transport errors are retryable; a caller's own abort is rethrown untouched
so a cancellation never looks like a provider fault.

**No retries.** The SDK retries twice by default; we set `maxRetries: 0`. For
image generation a transparent retry is a silent second charge, and the caller
is the only one who knows whether a second picture is worth a second payment.

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
