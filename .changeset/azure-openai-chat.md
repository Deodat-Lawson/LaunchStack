---
"@launchstack/llm": minor
---

Azure OpenAI is a supported chat setup out of the box.

- New preset `openai/gpt-6-luna`, verified against Azure OpenAI's v1
  chat-completions endpoint: effort `none`–`xhigh` (Azure rejects `minimal`
  and `max`), `max_completion_tokens`, no `temperature`. Tool-calling is not
  declared because Luna supports function tools over chat completions only at
  effort `none`; json-schema returned valid output at every effort.
- `apps/web/config/chat-models.azure.yaml` runs every route on a `gpt-6-luna`
  deployment. Select it with `CHAT_MODELS_CONFIG=config/chat-models.azure.yaml`.
- Structured output in `json-schema` mode sends `strict: true`. Without it an
  Azure `gpt-5.4-mini` deployment returned the schema itself instead of data in
  6 of 9 calls. Optional fields are sent as required-and-nullable and returned
  `null`s are restored to `undefined` before the Zod parse, so existing schemas
  keep their contract. Schemas strict mode cannot express (open records) are
  refused with a 400 and keep the existing prompt-based fallback.

Fixes:

- Docker Compose mounts `apps/web/config/` into the app and the worker, and the
  worker resolves `CHAT_MODELS_CONFIG` against `apps/web` like the app does.
  Previously the worker was pinned to `chat-models.yaml`, so choosing another
  file ran the app and the worker on different models.
- `.env.example` sets `BETTER_AUTH_URL=http://localhost:3000`; without it a
  local browser sign-up was refused with "Invalid origin". It no longer ships
  an uncommented `CHAT_API_KEY="AIza..."` placeholder, which overrode
  `GOOGLE_AI_API_KEY`, and it states that embeddings never fall back to Gemini.
- README and CONTRIBUTING: the seed command is
  `pnpm --filter @launchstack/web db:seed` and needs `DEV_SEED_PASSWORD`; the
  old `@launchstack/core` filter matched nothing and exited 0.
