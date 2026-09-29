# image-generation — generate an image and persist it

**What it is.** The policy layer over [`@launchstack/llm/images`](../../../llm/src/images).
The transport speaks three wire shapes and picks one from the endpoint URL; this
tool decides what happens around the call — where bytes go, who is billed, and
what a failure means.

**How it works.** `generateImage(input, deps)` validates a zod input, resolves an
endpoint, calls the transport, writes each returned image through the injected
store, and returns references stamped with `ToolProvenance`.

Endpoint resolution reads three levels as **pairs** (a base URL without its key
falls through rather than half-configuring a level, matching the provider
registry's rule):

1. `IMAGE_API_BASE_URL` + `IMAGE_API_KEY` — an explicit image endpoint.
2. `CHAT_BASE_URL` + `CHAT_API_KEY` — **the useful default.** On OpenRouter the
   chat endpoint *is* the image endpoint, so a deployment that configured chat
   has already configured images and need do nothing.
3. `AI_BASE_URL` + `AI_API_KEY` — the global fallback.

`IMAGE_MODEL` overrides the default (`google/gemini-2.5-flash-image`, Nano
Banana). Nano Banana rather than Imagen because this tool exists to be called by
an agent that will be asked to change what it just made, and only the natively
multimodal line can edit. `IMAGE_API_SHAPE` (`openrouter` | `openai-compatible` |
`google-native`) forces a driver for a gateway whose hostname does not imply
one.

**Three decisions this layer owns.**

- **Bytes are persisted here, never returned.** The caller gets a URL. An agent
  tool result is a `string`, and base64 in a transcript would exhaust the
  context window on the first call.
- **The store is injected, not imported.** Where an asset may be written is
  product-schema knowledge this package cannot hold — the same argument that
  makes `rag-search-tool` take an `AccessValidator`. `StoragePort` from
  `@launchstack/runtime` satisfies `ImageAssetStore` structurally, so apps pass
  the port they already built.
- **Spend is reported after the write, never before.** `onSpend` fires once per
  asset that actually reached storage. A storage failure throws first, so a paid
  generation that was never saved cannot bill anyone. The ordering is the
  guarantee; there is a test pinning it.

**When to use it.** Any caller that needs an image to exist as a workspace
asset. A caller that only needs bytes in memory should use the transport
directly and skip this layer's storage contract.

**Not here yet.** The agent wrapper and its per-run call cap — see the design
doc's §3.5. Until an agent can call this, the cap has nowhere to live, and
without the cap an agent loop is the fastest way to spend a company's balance.

```ts
import { generateImage } from "@launchstack/tools/image-generation";

const { data, provenance } = await generateImage(
    { prompt: "a duck on a bicycle", aspectRatio: "16:9" },
    { storage: storagePort, userId, onSpend: asset => debit(asset) },
);
// data.assets[0].url  →  the stored image
// data.warnings       →  anything the endpoint could not honour
```
