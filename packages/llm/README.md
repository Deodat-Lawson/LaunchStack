# @launchstack/llm

Everything that calls a model: structured output against a zod schema, message normalization across providers, token-usage accounting, the three answer guardrails, LLM-backed NER, embedding generation under named indexes, and the vendor wiring (chat-model factory, presets, OpenAI-compatible transport, provider registry). It deliberately does not contain retrieval or persistence logic — search and store are their own packages.

## Install

```bash
pnpm add @launchstack/llm
```

## Use

```ts
import { resolveChatModel, generateStructuredOutput } from "@launchstack/llm";
import { createEmbeddingModel } from "@launchstack/llm/embeddings";
```

## API

| Subpath | What it is |
| --- | --- |
| `.` | chat models, structured output, message normalization, usage, presets |
| `./types` | model/provider type vocabulary |
| `./embeddings` | embedding generation, index registry, reindex state |
| `./guardrails` | confidenceGate · contentFilter · groundingCheck |
| `./providers` | the pluggable provider families |
| `./providers/registry` | capability → provider resolution |
| `./providers/ner` | LLM-backed named-entity recognition |
| `./openai-client` | the shared auxiliary OpenAI client |
| `./structured-output` | (model, zod schema, prompt) → typed object |

## Configuration

Nothing here reads `process.env`. Configuration is injected by the
composition root — `createEngine(config)` in `@launchstack/engine`, or the
package's own `configure*` hooks when used standalone.

Every chat request goes through the one OpenAI-compatible transport — constructing a `ChatOpenAI` anywhere else is lint-banned.

## Stability

0.x. The model preset names and the embedding index registry keys (`legacy-openai-1536`, `gemini-embedding-768`) are load-bearing for stored data.

## License

Apache-2.0 — see [LICENSE](LICENSE).
