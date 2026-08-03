# Chat models

LaunchStack talks to **one chat endpoint**, and that endpoint can serve
**many models**. Which model handles which kind of work is your decision as
the operator, written down in a configuration file. Nothing is guessed from a
model id.

## What "any endpoint" means

An endpoint qualifies if it implements the **OpenAI chat-completions
protocol** — `POST {CHAT_BASE_URL}/chat/completions`, OpenAI-shaped request
and response bodies, bearer authentication (or none). That covers OpenAI,
OpenRouter, MiniMax, SiliconFlow, Together, Groq, vLLM, llama.cpp, LM Studio,
Ollama's `/v1` surface, and most hosted gateways.

It does **not** mean an arbitrary HTTP API. A service with its own request
shape needs a transport, which is
[tracked separately](#multiple-endpoints-and-native-transports).

## Configuration in two places

| Where | What | Why |
| --- | --- | --- |
| Environment | `CHAT_BASE_URL`, `CHAT_API_KEY` | Secrets and per-deployment addresses |
| `apps/web/config/chat-models.yaml` | Model ids, behavior, route assignments | Non-secret; belongs in review and version control |

Point `CHAT_MODELS_CONFIG` at another path to use a different file. Relative
paths resolve from the working directory.

```bash
CHAT_BASE_URL="https://openrouter.ai/api/v1"
CHAT_API_KEY="replace-with-your-chat-api-key"
# CHAT_MODELS_CONFIG="config/chat-models.production.yaml"
```

`CHAT_API_KEY` is optional. Leave it unset for a keyless local endpoint — a
placeholder credential is sent so the OpenAI SDK cannot fall back to an
unrelated `OPENAI_API_KEY` in the environment.

## Routes

A route is a **job**, not a model. Callers ask for the kind of work they need;
you decide which model does it.

| Route | Meaning | If unassigned |
| --- | --- | --- |
| `default` | General chat and generation | **Required** |
| `fast` | Cheap/low-latency work: extraction, query planning, summaries | Inherits `default` |
| `reasoning` | Requests that asked the model to think | Inherits `default` **only if** that model declares a reasoning mode |
| `vision` | Requests carrying images | Inherits `default` **only if** that model declares image input |

`fast` is a cost and latency preference, not a capability — pointing it at the
same model as `default` is a perfectly good configuration.

Specialized routes **fail closed**. If `vision` is unassigned and the default
model is text-only, the route reports itself unavailable: the image attach
control disables itself, and a request that sends one anyway gets a typed HTTP
400. The resolver never silently swaps models or drops a capability you asked
for.

An **explicit** assignment that lacks its capability — `vision:` pointed at a
text-only model — fails at startup instead, because that is a mistake in the
file rather than a limit on a request.

Routes resolve before retrieval, web search, or embeddings, so an unavailable
route fails before the deployment pays for context it would throw away.

### Vision plus reasoning

A request with both an image and reasoning enabled goes to the `vision` route,
and that model must reason too. Images can only go to a vision model, so the
alternative would be silently dropping either the image or the reasoning.
Instead you get a 400 naming the missing capability. To support the
combination, assign a model that does both:

```yaml
routes:
  default: primary
  vision: omni      # omni declares image input *and* a reasoning mode
  reasoning: omni
```

## Declaring a model

Every model either references a preset or declares its behavior in full.
There is no third option, and no inference from the id — a model named
`my-gpt-4o-clone` gets nothing from the `openai/gpt-4o` preset.

### With a preset

```yaml
version: 1

models:
  primary:
    id: openai/gpt-4o-mini      # id your endpoint serves
    preset: openai/gpt-4o-mini  # catalog entry to inherit behavior from

routes:
  default: primary
```

Presets live in `packages/core/src/llm/presets.ts`. Each records the
first-party source it was read from and the date it was last checked, so a
stale claim is visible rather than quietly authoritative. Preset behavior
describes the model **over the plain OpenAI-compatible protocol**; a gateway
that rewrites request fields is a different contract.

### Overriding a preset

Anything you write under `behavior` is authoritative **in both directions** —
including turning off something the preset claims:

```yaml
models:
  primary:
    id: openai/gpt-4o
    preset: openai/gpt-4o
    behavior:
      # This gateway does not proxy image parts.
      input: [text]
      # ...and rejects the structured-output request fields.
      nativeStructuredOutput: []
```

Merge rules: `input`, `image`, `reasoning`, `nativeStructuredOutput`, and
`limits` replace the preset's value wholesale when present. `parameters`
merges per field, so you can flip one without restating the rest.

### Without a preset

An unknown model is fully supported — declare everything:

```yaml
models:
  primary:
    id: MiniMax-M2
    behavior:
      input: [text]
      reasoning:
        mode: none
      nativeStructuredOutput: []
      parameters:
        temperature: supported
        systemMessages: supported
        streaming: supported
        maxOutputTokens: supported
```

An unknown model is never silently classified as text-only: leaving `behavior`
off entirely is a startup error telling you to declare it.

## Behavior reference

### `input`

`[text]` or `[text, image]`. Image support is what makes a model eligible for
the `vision` route.

```yaml
input: [text, image]
image:
  mimeTypes: [image/png, image/jpeg, image/webp]
  maxImages: 4
```

Both `image` fields are optional. Absent means **undeclared**, not unlimited —
the UI simply does not enforce a cap it was not told about.

### `reasoning`

Five modes. Each maps a caller's request to an exact request-body patch,
because only you know what your endpoint accepts.

**`none`** — no reasoning control. The `reasoning` route cannot inherit this
model, and asking for reasoning returns a 400.

```yaml
reasoning: { mode: none }
```

**`always`** — the model always reasons; there is nothing to toggle. The UI
Think toggle is disabled with that explanation.

```yaml
reasoning:
  mode: always
  request: { thinking: true }   # optional fields the endpoint still needs
```

**`toggle`** — on/off, each state an exact patch.

```yaml
reasoning:
  mode: toggle
  on:  { enable_thinking: true }
  off: { enable_thinking: false }   # omit to send nothing when off
```

**`effort`** — named levels. Callers pick one; the server validates it against
this list and rejects anything else.

```yaml
reasoning:
  mode: effort
  levels:
    low:    { reasoning_effort: low }
    medium: { reasoning_effort: medium }
    high:   { reasoning_effort: high }
  default: medium
  off: {}
```

**`budget`** — a token budget written to a declared field, validated against
declared bounds.

```yaml
reasoning:
  mode: budget
  field: thinking_budget_tokens
  default: 8000
  min: 1024
  max: 32000
```

Request patches may not write reserved fields — `model`, `messages`, `stream`,
`n`, or anything credential- or URL-shaped. A reasoning setting must stay a
reasoning setting, not a way to rewrite the request.

### `nativeStructuredOutput`

Which native mechanisms the model implements, in descending order of
enforcement: `json-schema`, `tool-calling`, `json-object`.

An empty list is normal and fully supported. Those models still return
validated objects: the schema goes into a strict JSON prompt, the result is
validated with Zod, and one repair attempt is made before failing clearly.
Structured output is invocation behavior, not a route — every route can
produce it.

### `parameters`

Fields marked `unsupported` are **omitted from the request entirely**, not
sent with a neutral value; endpoints commonly reject a field's mere presence.

```yaml
parameters:
  temperature: unsupported        # reasoning models often reject it
  systemMessages: supported
  streaming: supported
  maxOutputTokens: supported
  maxOutputTokensField: max_completion_tokens   # optional; defaults to max_tokens
```

When `systemMessages: unsupported`, system text is folded into the first user
turn rather than dropped — no `role: "system"` reaches the wire, and no
instruction is lost.

### `limits`

```yaml
limits:
  contextTokens: 128000
  maxOutputTokens: 16384
```

Both optional. An undeclared limit stays **unknown**; it never receives an
invented default, because a wrong context window silently truncates real work.
These are server-side only and never exposed to the browser.

## Examples

### Third-party endpoint (MiniMax)

```bash
CHAT_BASE_URL="https://api.minimax.io/v1"
CHAT_API_KEY="..."
```

```yaml
version: 1

models:
  primary:
    id: MiniMax-M2
    behavior:
      input: [text]
      reasoning:
        mode: none
      nativeStructuredOutput: []
      parameters:
        temperature: supported
        systemMessages: supported
        streaming: supported
        maxOutputTokens: supported

routes:
  default: primary
```

Verify the behavior against your endpoint's documentation before relying on
it — that is exactly what the declaration is for. Start conservative
(`nativeStructuredOutput: []` always works via the fallback) and enable
capabilities as you confirm them.

### Keyless local endpoint

```bash
CHAT_BASE_URL="http://localhost:11434/v1"   # Ollama's OpenAI-compatible surface
# CHAT_API_KEY intentionally unset
```

```yaml
version: 1

models:
  local:
    id: llama3.1:8b
    preset: generic/openai-compatible-text

routes:
  default: local
```

### Separate models per route

```yaml
version: 1

models:
  workhorse:
    id: openai/gpt-4o
    preset: openai/gpt-4o
  thinker:
    id: openai/gpt-5.1
    preset: openai/gpt-5.1
  cheap:
    id: openai/gpt-4o-mini
    preset: openai/gpt-4o-mini

routes:
  default: workhorse
  fast: cheap
  reasoning: thinker
  vision: workhorse
```

## What the browser sees

`GET /api/config/ai-models` returns per-route availability, the effective
model id, whether the route inherits `default`, vision support with its
declared limits, the reasoning mode with any selectable levels or budget
range, and native structured-output support.

It does **not** return the endpoint URL, the credential, reasoning request
patches, or context/output limits. The UI drives its controls from this
response: unavailable routes disable their control with the reason, and any
reasoning level a user picks is validated again server-side.

Clients cannot select a provider or a raw model id. A request that tries gets
a 400 during the compatibility window.

## Contributing a preset

1. Add an entry to `packages/core/src/llm/presets.ts` with a **first-party**
   source URL and today's date in `verifiedOn`.
2. Describe behavior over the plain OpenAI-compatible protocol. If a claim
   only holds through one gateway, say so in `notes`.
3. Prefer understating: an operator can always enable more, but a preset that
   over-claims produces confusing runtime errors.
4. Add a case to the preset tests covering whatever is distinctive about it.

## Migrating from the pre-PR variables

For one release, a single unambiguous legacy configuration is translated
automatically and logs a deprecation notice:

| Old | Translated endpoint |
| --- | --- |
| `AI_BASE_URL` / `AI_API_KEY` | that URL and key |

That is the only one left, because it is the only one that infers nothing —
it is a straight rename of `CHAT_BASE_URL` / `CHAT_API_KEY`.

**No variable names a provider any more.** `OPENROUTER_API_KEY`,
`OPENAI_API_KEY` and `OLLAMA_BASE_URL` no longer configure chat:

- A bare credential says who you are, not where the request goes. There are no
  built-in vendor URLs anywhere in the codebase, so inferring a destination
  from a key would pick a vendor on your behalf and send your prompts there.
- Ollama, OpenRouter and OpenAI all serve the OpenAI chat-completions
  protocol. A variable per provider bought nothing over pointing
  `CHAT_BASE_URL` at the same URL — Ollama's is `http://localhost:11434/v1`.

Set `CHAT_BASE_URL` explicitly. `OLLAMA_BASE_URL` still configures the Ollama
**embeddings** provider; it just no longer has a second job in chat.

The removed `CHAT_PROVIDER`, `CHAT_MODEL`, `CHAT_CAPABILITIES`, and the
`CHAT_{FAST,REASONING,VISION,STRUCTURED}_*` matrix have no replacement in the
environment. Model ids and behavior belong in the configuration file.

Non-chat capabilities — OCR, embeddings, transcription, reranking — keep their
own settings and are unaffected. They never borrow the chat credential.

## Multiple endpoints and native transports

This release serves one endpoint with one credential. Named endpoints,
per-route endpoint references, isolated credentials, optional
Anthropic/Google/Ollama native transports, and service-specific OpenRouter
behavior are tracked in
[#303 — Support multiple chat endpoints and native provider transports](https://github.com/Deodat-Lawson/LaunchStack/issues/303).
