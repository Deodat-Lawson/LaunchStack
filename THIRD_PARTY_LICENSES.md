<!--
  GENERATED FILE — do not edit by hand.
  Regenerate with: node scripts/licenses/generate-attributions.mjs
  The generator, not this output, is the thing to review.
-->

# Third-Party Licenses

LaunchStack is licensed under [Apache-2.0](LICENSE). It bundles third-party
software whose licenses require that their copyright and permission notices
travel with any copy. This file carries those notices.

## What is distributed, and how

| Component | Distribution | Contents |
| --- | --- | --- |
| App image, worker image | Built and pushed to GHCR by `.github/workflows/docker.yml` | The pnpm workspace's production dependency tree |
| `services/document-converter` | Built from source by `docker-compose.yml` | Its own `package-lock.json` |
| `services/adeu-ai-docs-editing` | Built from source by `docker-compose.yml` | Its `requirements.txt` closure |
| `services/transcription` | Built from source by `docker-compose.yml` | Its `requirements.txt` closure |

Only the app and worker images are published as binaries. The service images
are built locally from this repository, so their dependencies are fetched by
the operator at build time rather than redistributed here — the notices are
included anyway, because the resulting image contains them and an operator who
passes that image on is distributing them.

## adeu

The DOCX redlining engine behind `services/adeu-ai-docs-editing`.
Repository: <https://github.com/dealfluence/adeu> · Homepage: <https://adeu.ai>

```
MIT License

Copyright (c) 2026 Dealfluence Oy

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## App and worker images

Everything in the pnpm workspace's production dependency tree, which is what CI builds into the two published images.

**1225 runtime packages.**

| License | Packages |
| --- | ---: |
| MIT | 807 |
| Apache-2.0 | 241 |
| ISC | 71 |
| BSD-3-Clause | 36 |
| Unknown | 17 |
| BSD-2-Clause | 16 |
| BlueOak-1.0.0 | 8 |
| BSD | 8 |
| MIT-0 | 3 |
| MIT/X11 | 2 |
| Unlicense | 2 |
| (AFL-2.1 OR BSD-3-Clause) | 1 |
| (Apache-2.0 AND BSD-3-Clause) | 1 |
| (MIT AND Zlib) | 1 |
| (MIT OR CC0-1.0) | 1 |
| (MIT OR GPL-3.0-or-later) | 1 |
| (MIT OR GPL-3.0) | 1 |
| (MPL-2.0 OR Apache-2.0) | 1 |
| 0BSD | 1 |
| CC-BY-4.0 | 1 |
| CC0-1.0 | 1 |
| LGPL-3.0-or-later | 1 |
| MIT AND ISC | 1 |
| MPL-2.0 | 1 |
| Python-2.0 | 1 |

### Requires attention

- **(MIT OR GPL-3.0)** — pizzip@3.2.0
- **(MIT OR GPL-3.0-or-later)** — jszip@3.10.1
- **(MPL-2.0 OR Apache-2.0)** — dompurify@3.3.2
- **LGPL-3.0-or-later** — @img/sharp-libvips-darwin-arm64@1.0.4, 1.2.0
- **MPL-2.0** — @vercel/analytics@1.6.1

<details>
<summary>Full inventory</summary>

| Package | Version | License |
| --- | --- | --- |
| `@ai-sdk/provider` | 1.1.3 | Apache-2.0 |
| `@ai-sdk/provider-utils` | 2.2.8 | Apache-2.0 |
| `@alloc/quick-lru` | 5.2.0 | MIT |
| `@antfu/install-pkg` | 1.1.0 | MIT |
| `@anthropic-ai/sdk` | 0.27.3, 0.65.0 | MIT |
| `@asamuzakjp/css-color` | 5.1.11 | MIT |
| `@asamuzakjp/dom-selector` | 7.1.1 | MIT |
| `@asamuzakjp/generational-cache` | 1.0.1 | MIT |
| `@asamuzakjp/nwsapi` | 2.3.9 | MIT |
| `@aws-crypto/crc32` | 5.2.0 | Apache-2.0 |
| `@aws-crypto/crc32c` | 5.2.0 | Apache-2.0 |
| `@aws-crypto/sha1-browser` | 5.2.0 | Apache-2.0 |
| `@aws-crypto/sha256-browser` | 5.2.0 | Apache-2.0 |
| `@aws-crypto/sha256-js` | 5.2.0 | Apache-2.0 |
| `@aws-crypto/supports-web-crypto` | 5.2.0 | Apache-2.0 |
| `@aws-crypto/util` | 5.2.0 | Apache-2.0 |
| `@aws-sdk/client-s3` | 3.1025.0 | Apache-2.0 |
| `@aws-sdk/core` | 3.973.26 | Apache-2.0 |
| `@aws-sdk/crc64-nvme` | 3.972.5 | Apache-2.0 |
| `@aws-sdk/credential-provider-env` | 3.972.24 | Apache-2.0 |
| `@aws-sdk/credential-provider-http` | 3.972.26 | Apache-2.0 |
| `@aws-sdk/credential-provider-ini` | 3.972.28 | Apache-2.0 |
| `@aws-sdk/credential-provider-login` | 3.972.28 | Apache-2.0 |
| `@aws-sdk/credential-provider-node` | 3.972.29 | Apache-2.0 |
| `@aws-sdk/credential-provider-process` | 3.972.24 | Apache-2.0 |
| `@aws-sdk/credential-provider-sso` | 3.972.28 | Apache-2.0 |
| `@aws-sdk/credential-provider-web-identity` | 3.972.28 | Apache-2.0 |
| `@aws-sdk/middleware-bucket-endpoint` | 3.972.8 | Apache-2.0 |
| `@aws-sdk/middleware-expect-continue` | 3.972.8 | Apache-2.0 |
| `@aws-sdk/middleware-flexible-checksums` | 3.974.6 | Apache-2.0 |
| `@aws-sdk/middleware-host-header` | 3.972.8 | Apache-2.0 |
| `@aws-sdk/middleware-location-constraint` | 3.972.8 | Apache-2.0 |
| `@aws-sdk/middleware-logger` | 3.972.8 | Apache-2.0 |
| `@aws-sdk/middleware-recursion-detection` | 3.972.9 | Apache-2.0 |
| `@aws-sdk/middleware-sdk-s3` | 3.972.27 | Apache-2.0 |
| `@aws-sdk/middleware-ssec` | 3.972.8 | Apache-2.0 |
| `@aws-sdk/middleware-user-agent` | 3.972.28 | Apache-2.0 |
| `@aws-sdk/nested-clients` | 3.996.18 | Apache-2.0 |
| `@aws-sdk/region-config-resolver` | 3.972.10 | Apache-2.0 |
| `@aws-sdk/s3-request-presigner` | 3.1025.0 | Apache-2.0 |
| `@aws-sdk/signature-v4-multi-region` | 3.996.15 | Apache-2.0 |
| `@aws-sdk/token-providers` | 3.1021.0 | Apache-2.0 |
| `@aws-sdk/types` | 3.973.6 | Apache-2.0 |
| `@aws-sdk/util-arn-parser` | 3.972.3 | Apache-2.0 |
| `@aws-sdk/util-endpoints` | 3.996.5 | Apache-2.0 |
| `@aws-sdk/util-format-url` | 3.972.8 | Apache-2.0 |
| `@aws-sdk/util-locate-window` | 3.965.5 | Apache-2.0 |
| `@aws-sdk/util-user-agent-browser` | 3.972.8 | Apache-2.0 |
| `@aws-sdk/util-user-agent-node` | 3.973.14 | Apache-2.0 |
| `@aws-sdk/xml-builder` | 3.972.16 | Apache-2.0 |
| `@aws/lambda-invoke-store` | 0.2.4 | Apache-2.0 |
| `@babel/code-frame` | 7.29.0 | MIT |
| `@babel/compat-data` | 7.28.5 | MIT |
| `@babel/core` | 7.28.5 | MIT |
| `@babel/generator` | 7.28.5 | MIT |
| `@babel/helper-compilation-targets` | 7.27.2 | MIT |
| `@babel/helper-globals` | 7.28.0 | MIT |
| `@babel/helper-module-imports` | 7.27.1 | MIT |
| `@babel/helper-module-transforms` | 7.28.3 | MIT |
| `@babel/helper-string-parser` | 7.27.1 | MIT |
| `@babel/helper-validator-identifier` | 7.28.5 | MIT |
| `@babel/helper-validator-option` | 7.27.1 | MIT |
| `@babel/helpers` | 7.28.4 | MIT |
| `@babel/parser` | 7.28.5 | MIT |
| `@babel/runtime` | 7.28.6, 7.29.7 | MIT |
| `@babel/template` | 7.27.2 | MIT |
| `@babel/traverse` | 7.28.5 | MIT |
| `@babel/types` | 7.28.5 | MIT |
| `@better-auth/core` | 1.7.2 | MIT |
| `@better-auth/drizzle-adapter` | 1.7.2 | MIT |
| `@better-auth/kysely-adapter` | 1.7.2 | MIT |
| `@better-auth/memory-adapter` | 1.7.2 | MIT |
| `@better-auth/mongo-adapter` | 1.7.2 | MIT |
| `@better-auth/prisma-adapter` | 1.7.2 | MIT |
| `@better-auth/telemetry` | 1.7.2 | MIT |
| `@better-auth/utils` | 0.4.2, 0.5.0 | MIT |
| `@better-fetch/fetch` | 1.3.1 | MIT |
| `@braintree/sanitize-url` | 7.1.2 | MIT |
| `@bramus/specificity` | 2.4.2 | MIT |
| `@browserbasehq/sdk` | 2.16.0 | Apache-2.0 |
| `@browserbasehq/stagehand` | 1.9.0 | MIT |
| `@bufbuild/protobuf` | 2.12.1 | (Apache-2.0 AND BSD-3-Clause) |
| `@cfworker/json-schema` | 4.1.1 | MIT |
| `@chevrotain/cst-dts-gen` | 11.1.2 | Apache-2.0 |
| `@chevrotain/gast` | 11.1.2 | Apache-2.0 |
| `@chevrotain/regexp-to-ast` | 11.1.2 | Apache-2.0 |
| `@chevrotain/types` | 11.1.2 | Apache-2.0 |
| `@chevrotain/utils` | 11.1.2 | Apache-2.0 |
| `@csstools/color-helpers` | 6.0.2 | MIT-0 |
| `@csstools/css-calc` | 3.2.0 | MIT |
| `@csstools/css-color-parser` | 4.1.0 | MIT |
| `@csstools/css-parser-algorithms` | 4.0.0 | MIT |
| `@csstools/css-syntax-patches-for-csstree` | 1.1.3 | MIT-0 |
| `@csstools/css-tokenizer` | 4.0.0 | MIT |
| `@drizzle-team/brocli` | 0.10.2 | Apache-2.0 |
| `@effect/platform` | 0.90.3 | MIT |
| `@emailjs/browser` | 4.4.1 | BSD-3-Clause |
| `@esbuild-kit/core-utils` | 3.3.2 | MIT |
| `@esbuild-kit/esm-loader` | 2.6.5 | MIT |
| `@esbuild/darwin-arm64` | 0.18.20, 0.25.9, 0.27.7 | MIT |
| `@exodus/bytes` | 1.15.0 | MIT |
| `@floating-ui/core` | 1.7.3 | MIT |
| `@floating-ui/dom` | 1.7.4 | MIT |
| `@floating-ui/react-dom` | 2.1.6 | MIT |
| `@floating-ui/utils` | 0.2.10 | MIT |
| `@google/generative-ai` | 0.24.1 | Apache-2.0 |
| `@graphql-typed-document-node/core` | 3.2.0 | MIT |
| `@grpc/grpc-js` | 1.13.4, 1.14.4 | Apache-2.0 |
| `@grpc/proto-loader` | 0.7.15, 0.8.1 | Apache-2.0 |
| `@huggingface/inference` | 4.13.15 | MIT |
| `@huggingface/jinja` | 0.5.6 | MIT |
| `@huggingface/tasks` | 0.19.90 | MIT |
| `@huggingface/transformers` | 3.8.1 | Apache-2.0 |
| `@ibm-cloud/watsonx-ai` | 1.3.1 | Apache-2.0 |
| `@iconify/types` | 2.0.0 | MIT |
| `@iconify/utils` | 3.1.0 | MIT |
| `@img/sharp-darwin-arm64` | 0.33.5, 0.34.3 | Apache-2.0 |
| `@img/sharp-libvips-darwin-arm64` | 1.0.4, 1.2.0 | LGPL-3.0-or-later |
| `@inngest/ai` | 0.1.7 | Apache-2.0 |
| `@isaacs/cliui` | 8.0.2 | ISC |
| `@isaacs/fs-minipass` | 4.0.1 | ISC |
| `@jpwilliams/waitgroup` | 2.1.1 | MIT |
| `@jridgewell/gen-mapping` | 0.3.13 | MIT |
| `@jridgewell/remapping` | 2.3.5 | MIT |
| `@jridgewell/resolve-uri` | 3.1.2 | MIT |
| `@jridgewell/sourcemap-codec` | 1.5.5 | MIT |
| `@jridgewell/trace-mapping` | 0.3.30 | MIT |
| `@js-sdsl/ordered-map` | 4.4.2 | MIT |
| `@langchain/anthropic` | 0.3.34 | MIT |
| `@langchain/community` | 0.3.54, 0.3.59 | MIT |
| `@langchain/core` | 0.3.74 | MIT |
| `@langchain/google-genai` | 0.2.18 | MIT |
| `@langchain/langgraph` | 0.4.9 | MIT |
| `@langchain/langgraph-checkpoint` | 0.1.1 | MIT |
| `@langchain/langgraph-sdk` | 0.1.1 | MIT |
| `@langchain/ollama` | 0.1.6 | MIT |
| `@langchain/openai` | 0.6.11 | MIT |
| `@langchain/textsplitters` | 0.1.0 | MIT |
| `@langchain/weaviate` | 0.2.2 | MIT |
| `@mermaid-js/parser` | 1.0.1 | MIT |
| `@mixmark-io/domino` | 2.2.0 | BSD-2-Clause |
| `@mozilla/readability` | 0.6.0 | Apache-2.0 |
| `@msgpackr-extract/msgpackr-extract-darwin-arm64` | 3.0.3 | MIT |
| `@napi-rs/canvas` | 0.1.88 | MIT |
| `@napi-rs/canvas-darwin-arm64` | 0.1.88 | MIT |
| `@neondatabase/serverless` | 1.0.1 | MIT |
| `@next/env` | 15.5.7 | MIT |
| `@next/swc-darwin-arm64` | 15.5.7 | MIT |
| `@noble/ciphers` | 2.4.0 | MIT |
| `@noble/hashes` | 2.4.0 | MIT |
| `@nodelib/fs.scandir` | 2.1.5 | MIT |
| `@nodelib/fs.stat` | 2.0.5 | MIT |
| `@nodelib/fs.walk` | 1.2.8 | MIT |
| `@opentelemetry/api` | 1.9.0, 1.9.1 | Apache-2.0 |
| `@opentelemetry/api-logs` | 0.203.0, 0.220.0 | Apache-2.0 |
| `@opentelemetry/auto-instrumentations-node` | 0.78.0 | Apache-2.0 |
| `@opentelemetry/configuration` | 0.220.0 | Apache-2.0 |
| `@opentelemetry/context-async-hooks` | 2.9.0 | Apache-2.0 |
| `@opentelemetry/core` | 2.9.0 | Apache-2.0 |
| `@opentelemetry/exporter-logs-otlp-grpc` | 0.220.0 | Apache-2.0 |
| `@opentelemetry/exporter-logs-otlp-http` | 0.220.0 | Apache-2.0 |
| `@opentelemetry/exporter-logs-otlp-proto` | 0.220.0 | Apache-2.0 |
| `@opentelemetry/exporter-metrics-otlp-grpc` | 0.220.0 | Apache-2.0 |
| `@opentelemetry/exporter-metrics-otlp-http` | 0.220.0 | Apache-2.0 |
| `@opentelemetry/exporter-metrics-otlp-proto` | 0.220.0 | Apache-2.0 |
| `@opentelemetry/exporter-prometheus` | 0.220.0 | Apache-2.0 |
| `@opentelemetry/exporter-trace-otlp-grpc` | 0.220.0 | Apache-2.0 |
| `@opentelemetry/exporter-trace-otlp-http` | 0.220.0 | Apache-2.0 |
| `@opentelemetry/exporter-trace-otlp-proto` | 0.220.0 | Apache-2.0 |
| `@opentelemetry/exporter-zipkin` | 2.9.0 | Apache-2.0 |
| `@opentelemetry/instrumentation` | 0.203.0, 0.220.0 | Apache-2.0 |
| `@opentelemetry/instrumentation-amqplib` | 0.67.0 | Apache-2.0 |
| `@opentelemetry/instrumentation-aws-lambda` | 0.72.0 | Apache-2.0 |
| `@opentelemetry/instrumentation-aws-sdk` | 0.75.0 | Apache-2.0 |
| `@opentelemetry/instrumentation-bunyan` | 0.65.0 | Apache-2.0 |
| `@opentelemetry/instrumentation-cassandra-driver` | 0.65.0 | Apache-2.0 |
| `@opentelemetry/instrumentation-connect` | 0.63.0 | Apache-2.0 |
| `@opentelemetry/instrumentation-cucumber` | 0.36.0 | Apache-2.0 |
| `@opentelemetry/instrumentation-dataloader` | 0.37.0 | Apache-2.0 |
| `@opentelemetry/instrumentation-dns` | 0.63.0 | Apache-2.0 |
| `@opentelemetry/instrumentation-express` | 0.68.0 | Apache-2.0 |
| `@opentelemetry/instrumentation-fs` | 0.39.0 | Apache-2.0 |
| `@opentelemetry/instrumentation-generic-pool` | 0.63.0 | Apache-2.0 |
| `@opentelemetry/instrumentation-graphql` | 0.68.0 | Apache-2.0 |
| `@opentelemetry/instrumentation-grpc` | 0.220.0 | Apache-2.0 |
| `@opentelemetry/instrumentation-hapi` | 0.66.0 | Apache-2.0 |
| `@opentelemetry/instrumentation-host-metrics` | 0.3.0 | Apache-2.0 |
| `@opentelemetry/instrumentation-http` | 0.220.0 | Apache-2.0 |
| `@opentelemetry/instrumentation-ioredis` | 0.68.0 | Apache-2.0 |
| `@opentelemetry/instrumentation-kafkajs` | 0.29.0 | Apache-2.0 |
| `@opentelemetry/instrumentation-knex` | 0.64.0 | Apache-2.0 |
| `@opentelemetry/instrumentation-koa` | 0.68.0 | Apache-2.0 |
| `@opentelemetry/instrumentation-lru-memoizer` | 0.64.0 | Apache-2.0 |
| `@opentelemetry/instrumentation-memcached` | 0.63.0 | Apache-2.0 |
| `@opentelemetry/instrumentation-mongodb` | 0.73.0 | Apache-2.0 |
| `@opentelemetry/instrumentation-mongoose` | 0.66.0 | Apache-2.0 |
| `@opentelemetry/instrumentation-mysql` | 0.66.0 | Apache-2.0 |
| `@opentelemetry/instrumentation-mysql2` | 0.66.0 | Apache-2.0 |
| `@opentelemetry/instrumentation-nestjs-core` | 0.66.0 | Apache-2.0 |
| `@opentelemetry/instrumentation-net` | 0.64.0 | Apache-2.0 |
| `@opentelemetry/instrumentation-openai` | 0.18.0 | Apache-2.0 |
| `@opentelemetry/instrumentation-oracledb` | 0.45.0 | Apache-2.0 |
| `@opentelemetry/instrumentation-pg` | 0.72.0 | Apache-2.0 |
| `@opentelemetry/instrumentation-pino` | 0.66.0 | Apache-2.0 |
| `@opentelemetry/instrumentation-redis` | 0.68.0 | Apache-2.0 |
| `@opentelemetry/instrumentation-restify` | 0.65.0 | Apache-2.0 |
| `@opentelemetry/instrumentation-router` | 0.64.0 | Apache-2.0 |
| `@opentelemetry/instrumentation-runtime-node` | 0.33.0 | Apache-2.0 |
| `@opentelemetry/instrumentation-socket.io` | 0.67.0 | Apache-2.0 |
| `@opentelemetry/instrumentation-tedious` | 0.39.0 | Apache-2.0 |
| `@opentelemetry/instrumentation-undici` | 0.30.0 | Apache-2.0 |
| `@opentelemetry/instrumentation-winston` | 0.64.0 | Apache-2.0 |
| `@opentelemetry/otlp-exporter-base` | 0.220.0 | Apache-2.0 |
| `@opentelemetry/otlp-grpc-exporter-base` | 0.220.0 | Apache-2.0 |
| `@opentelemetry/otlp-transformer` | 0.220.0 | Apache-2.0 |
| `@opentelemetry/propagator-aws-xray` | 2.2.0 | Apache-2.0 |
| `@opentelemetry/propagator-b3` | 2.9.0 | Apache-2.0 |
| `@opentelemetry/propagator-jaeger` | 2.9.0 | Apache-2.0 |
| `@opentelemetry/redis-common` | 0.38.3 | Apache-2.0 |
| `@opentelemetry/resource-detector-alibaba-cloud` | 0.35.0 | Apache-2.0 |
| `@opentelemetry/resource-detector-aws` | 2.20.0 | Apache-2.0 |
| `@opentelemetry/resource-detector-azure` | 0.28.0 | Apache-2.0 |
| `@opentelemetry/resource-detector-container` | 0.8.11 | Apache-2.0 |
| `@opentelemetry/resource-detector-gcp` | 0.55.0 | Apache-2.0 |
| `@opentelemetry/resources` | 2.9.0 | Apache-2.0 |
| `@opentelemetry/sdk-logs` | 0.220.0 | Apache-2.0 |
| `@opentelemetry/sdk-metrics` | 2.9.0 | Apache-2.0 |
| `@opentelemetry/sdk-node` | 0.220.0 | Apache-2.0 |
| `@opentelemetry/sdk-trace` | 2.9.0 | Apache-2.0 |
| `@opentelemetry/sdk-trace-base` | 2.9.0 | Apache-2.0 |
| `@opentelemetry/sdk-trace-node` | 2.9.0 | Apache-2.0 |
| `@opentelemetry/semantic-conventions` | 1.37.0, 1.43.0 | Apache-2.0 |
| `@opentelemetry/sql-common` | 0.42.0 | Apache-2.0 |
| `@pdf-lib/standard-fonts` | 1.0.0 | MIT |
| `@pdf-lib/upng` | 1.0.1 | MIT |
| `@pinojs/redact` | 0.4.0 | MIT |
| `@pkgjs/parseargs` | 0.11.0 | MIT |
| `@playwright/test` | 1.55.0 | Apache-2.0 |
| `@protobufjs/aspromise` | 1.1.2 | BSD-3-Clause |
| `@protobufjs/base64` | 1.1.2 | BSD-3-Clause |
| `@protobufjs/codegen` | 2.0.4, 2.0.5 | BSD-3-Clause |
| `@protobufjs/eventemitter` | 1.1.0, 1.1.1 | BSD-3-Clause |
| `@protobufjs/fetch` | 1.1.0, 1.1.1 | BSD-3-Clause |
| `@protobufjs/float` | 1.0.2 | BSD-3-Clause |
| `@protobufjs/inquire` | 1.1.0 | BSD-3-Clause |
| `@protobufjs/path` | 1.1.2 | BSD-3-Clause |
| `@protobufjs/pool` | 1.1.0 | BSD-3-Clause |
| `@protobufjs/utf8` | 1.1.0, 1.1.2 | BSD-3-Clause |
| `@radix-ui/number` | 1.1.1 | MIT |
| `@radix-ui/primitive` | 1.1.3, 1.1.7 | MIT |
| `@radix-ui/react-arrow` | 1.1.7, 1.1.15 | MIT |
| `@radix-ui/react-collapsible` | 1.1.12 | MIT |
| `@radix-ui/react-collection` | 1.1.7, 1.1.15 | MIT |
| `@radix-ui/react-compose-refs` | 1.1.2, 1.1.5 | MIT |
| `@radix-ui/react-context` | 1.1.2, 1.1.3, 1.2.2 | MIT |
| `@radix-ui/react-context-menu` | 2.3.7 | MIT |
| `@radix-ui/react-dialog` | 1.1.15 | MIT |
| `@radix-ui/react-direction` | 1.1.1, 1.1.4 | MIT |
| `@radix-ui/react-dismissable-layer` | 1.1.11, 1.1.19 | MIT |
| `@radix-ui/react-dropdown-menu` | 2.1.24 | MIT |
| `@radix-ui/react-focus-guards` | 1.1.3, 1.1.6 | MIT |
| `@radix-ui/react-focus-scope` | 1.1.7, 1.1.16 | MIT |
| `@radix-ui/react-id` | 1.1.1, 1.1.4 | MIT |
| `@radix-ui/react-label` | 2.1.8 | MIT |
| `@radix-ui/react-menu` | 2.1.24 | MIT |
| `@radix-ui/react-popper` | 1.2.8, 1.3.7 | MIT |
| `@radix-ui/react-portal` | 1.1.9, 1.1.17 | MIT |
| `@radix-ui/react-presence` | 1.1.5, 1.1.10 | MIT |
| `@radix-ui/react-primitive` | 2.1.3, 2.1.4, 2.1.10 | MIT |
| `@radix-ui/react-progress` | 1.1.8 | MIT |
| `@radix-ui/react-roving-focus` | 1.1.11, 1.1.19 | MIT |
| `@radix-ui/react-scroll-area` | 1.2.10 | MIT |
| `@radix-ui/react-select` | 2.2.6 | MIT |
| `@radix-ui/react-slot` | 1.2.3, 1.2.4, 1.3.3 | MIT |
| `@radix-ui/react-switch` | 1.2.6 | MIT |
| `@radix-ui/react-tabs` | 1.1.13 | MIT |
| `@radix-ui/react-tooltip` | 1.2.8 | MIT |
| `@radix-ui/react-use-callback-ref` | 1.1.1, 1.1.4 | MIT |
| `@radix-ui/react-use-controllable-state` | 1.2.2, 1.2.6 | MIT |
| `@radix-ui/react-use-effect-event` | 0.0.2, 0.0.5 | MIT |
| `@radix-ui/react-use-escape-keydown` | 1.1.1 | MIT |
| `@radix-ui/react-use-is-hydrated` | 0.1.3 | MIT |
| `@radix-ui/react-use-layout-effect` | 1.1.1, 1.1.4 | MIT |
| `@radix-ui/react-use-previous` | 1.1.1 | MIT |
| `@radix-ui/react-use-rect` | 1.1.1, 1.1.4 | MIT |
| `@radix-ui/react-use-size` | 1.1.1, 1.1.4 | MIT |
| `@radix-ui/react-visually-hidden` | 1.2.3 | MIT |
| `@radix-ui/rect` | 1.1.1, 1.1.3 | MIT |
| `@rollup/rollup-darwin-arm64` | 4.62.4 | MIT |
| `@smithy/chunked-blob-reader` | 5.2.2 | Apache-2.0 |
| `@smithy/chunked-blob-reader-native` | 4.2.3 | Apache-2.0 |
| `@smithy/config-resolver` | 4.4.14 | Apache-2.0 |
| `@smithy/core` | 3.23.14 | Apache-2.0 |
| `@smithy/credential-provider-imds` | 4.2.13 | Apache-2.0 |
| `@smithy/eventstream-codec` | 4.2.13 | Apache-2.0 |
| `@smithy/eventstream-serde-browser` | 4.2.13 | Apache-2.0 |
| `@smithy/eventstream-serde-config-resolver` | 4.3.13 | Apache-2.0 |
| `@smithy/eventstream-serde-node` | 4.2.13 | Apache-2.0 |
| `@smithy/eventstream-serde-universal` | 4.2.13 | Apache-2.0 |
| `@smithy/fetch-http-handler` | 5.3.16 | Apache-2.0 |
| `@smithy/hash-blob-browser` | 4.2.14 | Apache-2.0 |
| `@smithy/hash-node` | 4.2.13 | Apache-2.0 |
| `@smithy/hash-stream-node` | 4.2.13 | Apache-2.0 |
| `@smithy/invalid-dependency` | 4.2.13 | Apache-2.0 |
| `@smithy/is-array-buffer` | 2.2.0, 4.2.2 | Apache-2.0 |
| `@smithy/md5-js` | 4.2.13 | Apache-2.0 |
| `@smithy/middleware-content-length` | 4.2.13 | Apache-2.0 |
| `@smithy/middleware-endpoint` | 4.4.29 | Apache-2.0 |
| `@smithy/middleware-retry` | 4.5.0 | Apache-2.0 |
| `@smithy/middleware-serde` | 4.2.17 | Apache-2.0 |
| `@smithy/middleware-stack` | 4.2.13 | Apache-2.0 |
| `@smithy/node-config-provider` | 4.3.13 | Apache-2.0 |
| `@smithy/node-http-handler` | 4.5.2 | Apache-2.0 |
| `@smithy/property-provider` | 4.2.13 | Apache-2.0 |
| `@smithy/protocol-http` | 5.3.13 | Apache-2.0 |
| `@smithy/querystring-builder` | 4.2.13 | Apache-2.0 |
| `@smithy/querystring-parser` | 4.2.13 | Apache-2.0 |
| `@smithy/service-error-classification` | 4.2.13 | Apache-2.0 |
| `@smithy/shared-ini-file-loader` | 4.4.8 | Apache-2.0 |
| `@smithy/signature-v4` | 5.3.13 | Apache-2.0 |
| `@smithy/smithy-client` | 4.12.9 | Apache-2.0 |
| `@smithy/types` | 4.14.0 | Apache-2.0 |
| `@smithy/url-parser` | 4.2.13 | Apache-2.0 |
| `@smithy/util-base64` | 4.3.2 | Apache-2.0 |
| `@smithy/util-body-length-browser` | 4.2.2 | Apache-2.0 |
| `@smithy/util-body-length-node` | 4.2.3 | Apache-2.0 |
| `@smithy/util-buffer-from` | 2.2.0, 4.2.2 | Apache-2.0 |
| `@smithy/util-config-provider` | 4.2.2 | Apache-2.0 |
| `@smithy/util-defaults-mode-browser` | 4.3.45 | Apache-2.0 |
| `@smithy/util-defaults-mode-node` | 4.2.49 | Apache-2.0 |
| `@smithy/util-endpoints` | 3.3.4 | Apache-2.0 |
| `@smithy/util-hex-encoding` | 4.2.2 | Apache-2.0 |
| `@smithy/util-middleware` | 4.2.13 | Apache-2.0 |
| `@smithy/util-retry` | 4.3.0 | Apache-2.0 |
| `@smithy/util-stream` | 4.5.22 | Apache-2.0 |
| `@smithy/util-uri-escape` | 4.2.2 | Apache-2.0 |
| `@smithy/util-utf8` | 2.3.0, 4.2.2 | Apache-2.0 |
| `@smithy/util-waiter` | 4.2.15 | Apache-2.0 |
| `@smithy/uuid` | 1.1.2 | Apache-2.0 |
| `@standard-schema/spec` | 1.0.0-beta.4, 1.1.0 | MIT |
| `@swc/helpers` | 0.5.15 | Apache-2.0 |
| `@tiptap/core` | 3.22.4 | MIT |
| `@tiptap/extension-blockquote` | 3.22.4 | MIT |
| `@tiptap/extension-bold` | 3.22.4 | MIT |
| `@tiptap/extension-bubble-menu` | 3.22.4 | MIT |
| `@tiptap/extension-bullet-list` | 3.22.4 | MIT |
| `@tiptap/extension-code` | 3.22.4 | MIT |
| `@tiptap/extension-code-block` | 3.22.4 | MIT |
| `@tiptap/extension-document` | 3.22.4 | MIT |
| `@tiptap/extension-dropcursor` | 3.22.4 | MIT |
| `@tiptap/extension-floating-menu` | 3.22.4 | MIT |
| `@tiptap/extension-gapcursor` | 3.22.4 | MIT |
| `@tiptap/extension-hard-break` | 3.22.4 | MIT |
| `@tiptap/extension-heading` | 3.22.4 | MIT |
| `@tiptap/extension-horizontal-rule` | 3.22.4 | MIT |
| `@tiptap/extension-italic` | 3.22.4 | MIT |
| `@tiptap/extension-link` | 3.22.4 | MIT |
| `@tiptap/extension-list` | 3.22.4 | MIT |
| `@tiptap/extension-list-item` | 3.22.4 | MIT |
| `@tiptap/extension-list-keymap` | 3.22.4 | MIT |
| `@tiptap/extension-ordered-list` | 3.22.4 | MIT |
| `@tiptap/extension-paragraph` | 3.22.4 | MIT |
| `@tiptap/extension-placeholder` | 3.22.4 | MIT |
| `@tiptap/extension-strike` | 3.22.4 | MIT |
| `@tiptap/extension-text` | 3.22.4 | MIT |
| `@tiptap/extension-text-align` | 3.22.4 | MIT |
| `@tiptap/extension-underline` | 3.22.4 | MIT |
| `@tiptap/extensions` | 3.22.4 | MIT |
| `@tiptap/pm` | 3.22.4 | MIT |
| `@tiptap/react` | 3.22.4 | MIT |
| `@tiptap/starter-kit` | 3.22.4 | MIT |
| `@tokenizer/token` | 0.3.0 | MIT |
| `@traceloop/ai-semantic-conventions` | 0.20.0 | Apache-2.0 |
| `@traceloop/instrumentation-anthropic` | 0.20.0 | Apache-2.0 |
| `@types/aws-lambda` | 8.10.162 | MIT |
| `@types/bunyan` | 1.8.11 | MIT |
| `@types/chai` | 5.2.3 | MIT |
| `@types/connect` | 3.4.38 | MIT |
| `@types/d3` | 7.4.3 | MIT |
| `@types/d3-array` | 3.2.1 | MIT |
| `@types/d3-axis` | 3.0.6 | MIT |
| `@types/d3-brush` | 3.0.6 | MIT |
| `@types/d3-chord` | 3.0.6 | MIT |
| `@types/d3-color` | 3.1.3 | MIT |
| `@types/d3-contour` | 3.0.6 | MIT |
| `@types/d3-delaunay` | 6.0.4 | MIT |
| `@types/d3-dispatch` | 3.0.7 | MIT |
| `@types/d3-drag` | 3.0.7 | MIT |
| `@types/d3-dsv` | 3.0.7 | MIT |
| `@types/d3-ease` | 3.0.2 | MIT |
| `@types/d3-fetch` | 3.0.7 | MIT |
| `@types/d3-force` | 3.0.10 | MIT |
| `@types/d3-format` | 3.0.4 | MIT |
| `@types/d3-geo` | 3.1.0 | MIT |
| `@types/d3-hierarchy` | 3.1.7 | MIT |
| `@types/d3-interpolate` | 3.0.4 | MIT |
| `@types/d3-path` | 3.1.1 | MIT |
| `@types/d3-polygon` | 3.0.2 | MIT |
| `@types/d3-quadtree` | 3.0.6 | MIT |
| `@types/d3-random` | 3.0.3 | MIT |
| `@types/d3-scale` | 4.0.9 | MIT |
| `@types/d3-scale-chromatic` | 3.1.0 | MIT |
| `@types/d3-selection` | 3.0.11 | MIT |
| `@types/d3-shape` | 3.1.7 | MIT |
| `@types/d3-time` | 3.0.4 | MIT |
| `@types/d3-time-format` | 4.0.3 | MIT |
| `@types/d3-timer` | 3.0.2 | MIT |
| `@types/d3-transition` | 3.0.9 | MIT |
| `@types/d3-zoom` | 3.0.8 | MIT |
| `@types/debug` | 4.1.13 | MIT |
| `@types/deep-eql` | 4.0.2 | MIT |
| `@types/estree` | 1.0.8, 1.0.9 | MIT |
| `@types/estree-jsx` | 1.0.5 | MIT |
| `@types/geojson` | 7946.0.16 | MIT |
| `@types/hast` | 3.0.4 | MIT |
| `@types/json-schema` | 7.0.15 | MIT |
| `@types/katex` | 0.16.7 | MIT |
| `@types/mdast` | 4.0.4 | MIT |
| `@types/memcached` | 2.2.10 | MIT |
| `@types/ms` | 2.1.0 | MIT |
| `@types/mysql` | 2.15.27 | MIT |
| `@types/node` | 10.14.22, 18.19.130, 22.20.1, 24.3.1 | MIT |
| `@types/node-fetch` | 2.6.13 | MIT |
| `@types/oracledb` | 6.5.2 | MIT |
| `@types/pg` | 8.15.6 | MIT |
| `@types/pg-pool` | 2.0.7 | MIT |
| `@types/react` | 19.1.12 | MIT |
| `@types/react-dom` | 19.1.9 | MIT |
| `@types/retry` | 0.12.0 | MIT |
| `@types/tedious` | 4.0.14 | MIT |
| `@types/tough-cookie` | 4.0.5 | MIT |
| `@types/trusted-types` | 2.0.7 | MIT |
| `@types/unist` | 2.0.11, 3.0.3 | MIT |
| `@types/use-sync-external-store` | 0.0.6 | MIT |
| `@types/uuid` | 10.0.0 | MIT |
| `@ungap/structured-clone` | 1.3.0 | ISC |
| `@uploadthing/mime-types` | 0.3.6 | MIT |
| `@uploadthing/react` | 7.3.3 | MIT |
| `@uploadthing/shared` | 7.1.10 | MIT |
| `@upsetjs/venn.js` | 2.0.0 | MIT |
| `@vercel/analytics` | 1.6.1 | MPL-2.0 |
| `@vercel/blob` | 2.3.0 | Apache-2.0 |
| `@vitest/expect` | 3.2.7 | MIT |
| `@vitest/mocker` | 3.2.7 | MIT |
| `@vitest/pretty-format` | 3.2.7 | MIT |
| `@vitest/runner` | 3.2.7 | MIT |
| `@vitest/snapshot` | 3.2.7 | MIT |
| `@vitest/spy` | 3.2.7 | MIT |
| `@vitest/utils` | 3.2.7 | MIT |
| `@xmldom/xmldom` | 0.8.11, 0.9.8 | MIT |
| `abort-controller` | 3.0.0 | MIT |
| `abort-controller-x` | 0.4.3 | MIT |
| `acorn` | 8.16.0, 8.17.0 | MIT |
| `acorn-import-attributes` | 1.9.5 | MIT |
| `adler-32` | 1.3.1 | Apache-2.0 |
| `agent-base` | 7.1.4 | MIT |
| `agentkeepalive` | 4.6.0 | MIT |
| `ansi-regex` | 4.1.1, 5.0.1 | MIT |
| `ansi-styles` | 4.3.0, 5.2.0 | MIT |
| `any-promise` | 1.3.0 | MIT |
| `anymatch` | 3.1.3 | ISC |
| `arg` | 5.0.2 | MIT |
| `argparse` | 0.1.16, 1.0.10 | MIT |
| `argparse` | 2.0.1 | Python-2.0 |
| `aria-hidden` | 1.2.6 | MIT |
| `assertion-error` | 2.0.1 | MIT |
| `async` | 0.2.10 | MIT |
| `async-retry` | 1.3.3 | MIT |
| `asynckit` | 0.4.0 | MIT |
| `atomic-sleep` | 1.0.0 | MIT |
| `aws-sign` | 0.2.0 | Unknown |
| `axios` | 1.7.4 | MIT |
| `bail` | 2.0.2 | MIT |
| `balanced-match` | 1.0.2 | MIT |
| `base64-js` | 1.5.1 | MIT |
| `baseline-browser-mapping` | 2.9.19 | Apache-2.0 |
| `bcryptjs` | 3.0.3 | BSD-3-Clause |
| `better-auth` | 1.7.2 | MIT |
| `better-call` | 1.4.0 | MIT |
| `bidi-js` | 1.0.3 | MIT |
| `bignumber.js` | 9.0.0, 9.3.1 | MIT |
| `binary-extensions` | 2.3.0 | MIT |
| `bintrees` | 1.0.2 | MIT |
| `bluebird` | 3.4.7 | MIT |
| `bmp-js` | 0.1.0 | MIT |
| `boolbase` | 1.0.0 | ISC |
| `boolean` | 3.2.0 | MIT |
| `boom` | 0.3.8 | BSD |
| `bowser` | 2.14.1 | MIT |
| `brace-expansion` | 2.0.2, 2.1.2 | MIT |
| `braces` | 3.0.3 | MIT |
| `browserslist` | 4.27.0 | MIT |
| `buffer` | 6.0.3 | MIT |
| `buffer-equal-constant-time` | 1.0.1 | BSD-3-Clause |
| `buffer-from` | 1.1.2 | MIT |
| `cac` | 6.7.14 | MIT |
| `call-bind-apply-helpers` | 1.0.2 | MIT |
| `camelcase` | 6.3.0 | MIT |
| `camelcase-css` | 2.0.1 | MIT |
| `caniuse-lite` | 1.0.30001766 | CC-BY-4.0 |
| `canonicalize` | 1.0.8 | Apache-2.0 |
| `ccount` | 2.0.1 | MIT |
| `cfb` | 1.2.2 | Apache-2.0 |
| `chai` | 5.3.3 | MIT |
| `chalk` | 4.1.2 | MIT |
| `character-entities` | 2.0.2 | MIT |
| `character-entities-html4` | 2.1.0 | MIT |
| `character-entities-legacy` | 3.0.0 | MIT |
| `character-reference-invalid` | 2.0.1 | MIT |
| `charenc` | 0.0.2 | BSD-3-Clause |
| `check-error` | 2.1.3 | MIT |
| `cheerio` | 1.2.0 | MIT |
| `cheerio-select` | 2.1.0 | BSD-2-Clause |
| `chevrotain` | 11.1.2 | Apache-2.0 |
| `chevrotain-allstar` | 0.3.1 | MIT |
| `chokidar` | 3.6.0 | MIT |
| `chownr` | 3.0.0 | BlueOak-1.0.0 |
| `cjs-module-lexer` | 1.4.3, 2.2.0 | MIT |
| `class-variance-authority` | 0.7.1 | Apache-2.0 |
| `cli-table` | 0.3.11 | MIT |
| `client-only` | 0.0.1 | MIT |
| `cliui` | 8.0.1 | ISC |
| `clsx` | 2.1.1 | MIT |
| `codepage` | 1.15.0 | Apache-2.0 |
| `color` | 4.2.3 | MIT |
| `color-convert` | 2.0.1 | MIT |
| `color-name` | 1.1.4 | MIT |
| `color-string` | 1.9.1 | MIT |
| `colors` | 0.6.2 | Unknown |
| `colors` | 1.0.3 | MIT |
| `combined-stream` | 0.0.7 | Unknown |
| `combined-stream` | 1.0.8 | MIT |
| `comma-separated-tokens` | 2.0.3 | MIT |
| `commander` | 4.1.1, 7.2.0, 8.3.0 | MIT |
| `confbox` | 0.1.8 | MIT |
| `console-table-printer` | 2.14.6 | MIT |
| `convert-source-map` | 2.0.0 | MIT |
| `cookie-jar` | 0.2.0 | Unknown |
| `core-util-is` | 1.0.3 | MIT |
| `cose-base` | 1.0.3, 2.2.0 | MIT |
| `crc-32` | 1.2.2 | Apache-2.0 |
| `cross-fetch` | 3.2.0, 4.1.0 | MIT |
| `cross-spawn` | 7.0.6 | MIT |
| `crypt` | 0.0.2 | BSD-3-Clause |
| `cryptiles` | 0.1.3 | BSD |
| `crypto-js` | 4.2.0 | MIT |
| `css-select` | 5.2.2 | BSD-2-Clause |
| `css-tree` | 3.2.1 | MIT |
| `css-what` | 6.2.2 | BSD-2-Clause |
| `cssesc` | 3.0.0 | MIT |
| `csstype` | 3.1.3 | MIT |
| `cycle` | 1.0.3 | Unknown |
| `cytoscape` | 3.33.1 | MIT |
| `cytoscape-cose-bilkent` | 4.1.0 | MIT |
| `cytoscape-fcose` | 2.2.0 | MIT |
| `d3` | 7.9.0 | ISC |
| `d3-array` | 2.12.1 | BSD-3-Clause |
| `d3-array` | 3.2.4 | ISC |
| `d3-axis` | 3.0.0 | ISC |
| `d3-brush` | 3.0.0 | ISC |
| `d3-chord` | 3.0.1 | ISC |
| `d3-color` | 3.1.0 | ISC |
| `d3-contour` | 4.0.2 | ISC |
| `d3-delaunay` | 6.0.4 | ISC |
| `d3-dispatch` | 3.0.1 | ISC |
| `d3-drag` | 3.0.0 | ISC |
| `d3-dsv` | 3.0.1 | ISC |
| `d3-ease` | 3.0.1 | BSD-3-Clause |
| `d3-fetch` | 3.0.1 | ISC |
| `d3-force` | 3.0.0 | ISC |
| `d3-format` | 3.1.0 | ISC |
| `d3-geo` | 3.1.1 | ISC |
| `d3-hierarchy` | 3.1.2 | ISC |
| `d3-interpolate` | 3.0.1 | ISC |
| `d3-path` | 1.0.9 | BSD-3-Clause |
| `d3-path` | 3.1.0 | ISC |
| `d3-polygon` | 3.0.1 | ISC |
| `d3-quadtree` | 3.0.1 | ISC |
| `d3-random` | 3.0.1 | ISC |
| `d3-sankey` | 0.12.3 | BSD-3-Clause |
| `d3-scale` | 4.0.2 | ISC |
| `d3-scale-chromatic` | 3.1.0 | ISC |
| `d3-selection` | 3.0.0 | ISC |
| `d3-shape` | 1.3.7 | BSD-3-Clause |
| `d3-shape` | 3.2.0 | ISC |
| `d3-time` | 3.1.0 | ISC |
| `d3-time-format` | 4.1.0 | ISC |
| `d3-timer` | 3.0.1 | ISC |
| `d3-transition` | 3.0.1 | ISC |
| `d3-zoom` | 3.0.0 | ISC |
| `dagre-d3-es` | 7.0.14 | MIT |
| `data-uri-to-buffer` | 4.0.1 | MIT |
| `data-urls` | 7.0.0 | MIT |
| `dayjs` | 1.11.19 | MIT |
| `debug` | 3.2.7, 4.4.3 | MIT |
| `decamelize` | 1.2.0 | MIT |
| `decimal.js` | 10.6.0 | MIT |
| `decimal.js-light` | 2.5.1 | MIT |
| `decode-named-character-reference` | 1.2.0 | MIT |
| `deep-eql` | 5.0.2 | MIT |
| `deepmerge` | 4.3.1 | MIT |
| `define-data-property` | 1.1.4 | MIT |
| `define-properties` | 1.2.1 | MIT |
| `defu` | 6.1.7 | MIT |
| `delaunator` | 5.0.1 | ISC |
| `delayed-stream` | 0.0.5 | Unknown |
| `delayed-stream` | 1.0.0 | MIT |
| `dequal` | 2.0.3 | MIT |
| `detect-libc` | 2.1.2 | Apache-2.0 |
| `detect-node` | 2.1.0 | MIT |
| `detect-node-es` | 1.1.0 | MIT |
| `devlop` | 1.1.0 | MIT |
| `didyoumean` | 1.2.2 | Apache-2.0 |
| `diff` | 8.0.3 | BSD-3-Clause |
| `diff-match-patch` | 1.0.5 | Apache-2.0 |
| `dingbat-to-unicode` | 1.0.1 | BSD-2-Clause |
| `dlv` | 1.1.3 | MIT |
| `docx-preview` | 0.4.0 | Apache-2.0 |
| `docxtemplater` | 3.68.3 | MIT |
| `dom-helpers` | 5.2.1 | MIT |
| `dom-serializer` | 2.0.0 | MIT |
| `domelementtype` | 2.3.0 | BSD-2-Clause |
| `domhandler` | 5.0.3 | BSD-2-Clause |
| `dompurify` | 3.3.2 | (MPL-2.0 OR Apache-2.0) |
| `domutils` | 3.2.2 | BSD-2-Clause |
| `dotenv` | 16.6.1, 17.3.1 | BSD-2-Clause |
| `drizzle-kit` | 0.31.10 | MIT |
| `drizzle-orm` | 0.45.1 | Apache-2.0 |
| `duck` | 0.1.12 | BSD |
| `duck-duck-scrape` | 2.2.7 | MIT |
| `dunder-proto` | 1.0.1 | MIT |
| `eastasianwidth` | 0.2.0 | MIT |
| `ecdsa-sig-formatter` | 1.0.11 | Apache-2.0 |
| `effect` | 3.17.7 | MIT |
| `electron-to-chromium` | 1.5.243 | ISC |
| `emoji-regex` | 8.0.0, 9.2.2 | MIT |
| `encoding-sniffer` | 0.2.1 | MIT |
| `entities` | 4.5.0, 6.0.1, 7.0.1, 8.0.0 | BSD-2-Clause |
| `es-define-property` | 1.0.1 | MIT |
| `es-errors` | 1.3.0 | MIT |
| `es-module-lexer` | 1.7.0, 2.3.1 | MIT |
| `es-object-atoms` | 1.1.1 | MIT |
| `es-set-tostringtag` | 2.1.0 | MIT |
| `es6-error` | 4.1.1 | MIT |
| `esbuild` | 0.18.20, 0.25.9, 0.27.7 | MIT |
| `escalade` | 3.2.0 | MIT |
| `escape-string-regexp` | 4.0.0, 5.0.0 | MIT |
| `esprima` | 1.0.4 | BSD |
| `estree-util-is-identifier-name` | 3.0.0 | MIT |
| `estree-walker` | 3.0.3 | MIT |
| `event-target-shim` | 5.0.1 | MIT |
| `eventemitter3` | 4.0.7 | MIT |
| `events` | 3.3.0 | MIT |
| `expect-type` | 1.4.0 | Apache-2.0 |
| `expr-eval` | 2.0.2 | MIT |
| `extend` | 3.0.2 | MIT |
| `eyes` | 0.1.8 | Unknown |
| `fast-check` | 3.23.2 | MIT |
| `fast-equals` | 5.4.0 | MIT |
| `fast-glob` | 3.3.3 | MIT |
| `fast-xml-builder` | 1.1.4 | MIT |
| `fast-xml-parser` | 4.5.7, 5.5.8 | MIT |
| `fastq` | 1.19.1 | ISC |
| `fdir` | 6.5.0 | MIT |
| `fetch-blob` | 3.2.0 | MIT |
| `file-selector` | 0.6.0 | MIT |
| `file-type` | 16.5.4 | MIT |
| `fill-range` | 7.1.1 | MIT |
| `find-my-way-ts` | 0.1.6 | MIT |
| `flat` | 5.0.2 | BSD-3-Clause |
| `flatbuffers` | 25.9.23 | Apache-2.0 |
| `follow-redirects` | 1.16.0 | MIT |
| `foreground-child` | 3.3.1 | ISC |
| `forever-agent` | 0.2.0 | Unknown |
| `form-data` | 0.0.10 | Unknown |
| `form-data` | 4.0.0, 4.0.4 | MIT |
| `form-data-encoder` | 1.7.2 | MIT |
| `formdata-node` | 4.4.1, 6.0.3 | MIT |
| `formdata-polyfill` | 4.0.10 | MIT |
| `forwarded-parse` | 2.1.2 | MIT |
| `frac` | 1.1.2 | Apache-2.0 |
| `framer-motion` | 12.29.2 | MIT |
| `fsevents` | 2.3.2, 2.3.3 | MIT |
| `function-bind` | 1.1.2 | MIT |
| `gaxios` | 7.1.3 | Apache-2.0 |
| `gcp-metadata` | 8.1.3 | Apache-2.0 |
| `gensync` | 1.0.0-beta.2 | MIT |
| `get-caller-file` | 2.0.5 | ISC |
| `get-intrinsic` | 1.3.0 | MIT |
| `get-nonce` | 1.0.1 | MIT |
| `get-proto` | 1.0.1 | MIT |
| `get-tsconfig` | 4.10.1 | MIT |
| `glob` | 10.4.5, 10.5.0 | ISC |
| `glob-parent` | 5.1.2, 6.0.2 | ISC |
| `global-agent` | 3.0.0 | BSD-3-Clause |
| `globalthis` | 1.0.4 | MIT |
| `google-logging-utils` | 1.1.3 | Apache-2.0 |
| `gopd` | 1.2.0 | MIT |
| `graphql` | 16.11.0 | MIT |
| `graphql-request` | 6.1.0 | MIT |
| `guid-typescript` | 1.0.9 | ISC |
| `hachure-fill` | 0.5.2 | MIT |
| `handlebars` | 4.7.8 | MIT |
| `has-flag` | 4.0.0 | MIT |
| `has-property-descriptors` | 1.0.2 | MIT |
| `has-symbols` | 1.1.0 | MIT |
| `has-tostringtag` | 1.0.2 | MIT |
| `hash.js` | 1.1.7 | MIT |
| `hasown` | 2.0.2, 2.0.4 | MIT |
| `hast-util-from-dom` | 5.0.1 | ISC |
| `hast-util-from-html` | 2.0.3 | MIT |
| `hast-util-from-html-isomorphic` | 2.0.0 | MIT |
| `hast-util-from-parse5` | 8.0.3 | MIT |
| `hast-util-is-element` | 3.0.0 | MIT |
| `hast-util-parse-selector` | 4.0.0 | MIT |
| `hast-util-raw` | 9.1.0 | MIT |
| `hast-util-to-jsx-runtime` | 2.3.6 | MIT |
| `hast-util-to-parse5` | 8.0.1 | MIT |
| `hast-util-to-text` | 4.0.2 | MIT |
| `hast-util-whitespace` | 3.0.0 | MIT |
| `hastscript` | 9.0.1 | MIT |
| `hawk` | 0.10.2 | BSD |
| `highlight.js` | 11.11.1 | BSD-3-Clause |
| `hoek` | 0.7.6 | BSD |
| `html-encoding-sniffer` | 6.0.0 | MIT |
| `html-entities` | 2.6.0 | MIT |
| `html-url-attributes` | 3.0.1 | MIT |
| `html-void-elements` | 3.0.0 | MIT |
| `htmlparser2` | 10.1.0 | MIT |
| `https-proxy-agent` | 7.0.6 | MIT |
| `humanize-ms` | 1.2.1 | MIT |
| `ibm-cloud-sdk-core` | 5.1.0 | Apache-2.0 |
| `iconv-lite` | 0.6.3 | MIT |
| `idb-keyval` | 6.2.2 | Apache-2.0 |
| `ieee754` | 1.2.1 | BSD-3-Clause |
| `ignore` | 5.3.2 | MIT |
| `immediate` | 3.0.6 | MIT |
| `import-in-the-middle` | 1.15.0, 3.3.1 | Apache-2.0 |
| `inherits` | 2.0.4 | ISC |
| `inline-style-parser` | 0.2.7 | MIT |
| `inngest` | 3.54.2 | Apache-2.0 |
| `internmap` | 1.0.1, 2.0.3 | ISC |
| `is-alphabetical` | 2.0.1 | MIT |
| `is-alphanumerical` | 2.0.1 | MIT |
| `is-arrayish` | 0.3.2 | MIT |
| `is-binary-path` | 2.1.0 | MIT |
| `is-buffer` | 2.0.5 | MIT |
| `is-core-module` | 2.16.1, 2.16.2 | MIT |
| `is-decimal` | 2.0.1 | MIT |
| `is-extglob` | 2.1.1 | MIT |
| `is-fullwidth-code-point` | 3.0.0 | MIT |
| `is-glob` | 4.0.3 | MIT |
| `is-hexadecimal` | 2.0.1 | MIT |
| `is-node-process` | 1.2.0 | MIT |
| `is-number` | 7.0.0 | MIT |
| `is-plain-obj` | 4.1.0 | MIT |
| `is-potential-custom-element-name` | 1.0.1 | MIT |
| `is-url` | 1.2.4 | MIT |
| `isarray` | 1.0.0 | MIT |
| `isexe` | 2.0.0 | ISC |
| `isstream` | 0.1.2 | MIT |
| `jackspeak` | 3.4.3 | BlueOak-1.0.0 |
| `jiti` | 1.21.7, 2.5.1 | MIT |
| `jose` | 6.2.10 | MIT |
| `js-tiktoken` | 1.0.21 | MIT |
| `js-tokens` | 4.0.0, 9.0.1 | MIT |
| `js-yaml` | 2.1.3, 4.1.0, 4.1.1 | MIT |
| `jsdom` | 29.0.2 | MIT |
| `jsesc` | 3.1.0 | MIT |
| `json-bigint` | 1.0.0 | MIT |
| `json-schema` | 0.4.0 | (AFL-2.1 OR BSD-3-Clause) |
| `json-schema-to-ts` | 3.1.1 | MIT |
| `json-stringify-safe` | 3.0.0 | BSD |
| `json-stringify-safe` | 5.0.1 | ISC |
| `json5` | 2.2.3 | MIT |
| `jsonpointer` | 5.0.1 | MIT |
| `jsonwebtoken` | 9.0.3 | MIT |
| `jszip` | 3.10.1 | (MIT OR GPL-3.0-or-later) |
| `jwa` | 2.0.1 | MIT |
| `jws` | 4.0.1 | MIT |
| `katex` | 0.16.25 | MIT |
| `khroma` | 2.1.0 | Unknown |
| `kysely` | 0.29.5 | MIT |
| `langchain` | 0.3.33 | MIT |
| `langium` | 4.2.1 | MIT |
| `langsmith` | 0.3.67 | MIT |
| `layout-base` | 1.0.2, 2.0.1 | MIT |
| `lie` | 3.3.0 | MIT |
| `lilconfig` | 3.1.3 | MIT |
| `lines-and-columns` | 1.2.4 | MIT |
| `linkifyjs` | 4.3.2 | MIT |
| `lodash` | 4.17.21 | MIT |
| `lodash-es` | 4.17.23 | MIT |
| `lodash.camelcase` | 4.3.0 | MIT |
| `lodash.includes` | 4.3.0 | MIT |
| `lodash.isboolean` | 3.0.3 | MIT |
| `lodash.isinteger` | 4.0.4 | MIT |
| `lodash.isnumber` | 3.0.3 | MIT |
| `lodash.isplainobject` | 4.0.6 | MIT |
| `lodash.isstring` | 4.0.1 | MIT |
| `lodash.once` | 4.1.1 | MIT |
| `log` | 1.4.0 | Unknown |
| `long` | 5.3.2 | Apache-2.0 |
| `longest-streak` | 3.1.0 | MIT |
| `loose-envify` | 1.4.0 | MIT |
| `lop` | 0.4.2 | BSD-2-Clause |
| `loupe` | 3.2.1 | MIT |
| `lru-cache` | 11.3.5 | BlueOak-1.0.0 |
| `lru-cache` | 5.1.1, 10.4.3 | ISC |
| `lucide-react` | 0.487.0 | ISC |
| `magic-string` | 0.30.21 | MIT |
| `make-cancellable-promise` | 2.0.0 | MIT |
| `make-event-props` | 2.0.0 | MIT |
| `mammoth` | 1.11.0 | BSD-2-Clause |
| `markdown-table` | 3.0.4 | MIT |
| `marked` | 16.4.2, 17.0.3 | MIT |
| `matcher` | 3.0.0 | MIT |
| `math-expression-evaluator` | 2.0.7 | MIT |
| `math-intrinsics` | 1.1.0 | MIT |
| `MD5` | 1.3.0 | BSD-3-Clause |
| `mdast-util-find-and-replace` | 3.0.2 | MIT |
| `mdast-util-from-markdown` | 2.0.2 | MIT |
| `mdast-util-gfm` | 3.1.0 | MIT |
| `mdast-util-gfm-autolink-literal` | 2.0.1 | MIT |
| `mdast-util-gfm-footnote` | 2.1.0 | MIT |
| `mdast-util-gfm-strikethrough` | 2.0.0 | MIT |
| `mdast-util-gfm-table` | 2.0.0 | MIT |
| `mdast-util-gfm-task-list-item` | 2.0.0 | MIT |
| `mdast-util-math` | 3.0.0 | MIT |
| `mdast-util-mdx-expression` | 2.0.1 | MIT |
| `mdast-util-mdx-jsx` | 3.2.0 | MIT |
| `mdast-util-mdxjs-esm` | 2.0.1 | MIT |
| `mdast-util-phrasing` | 4.1.0 | MIT |
| `mdast-util-to-hast` | 13.2.0 | MIT |
| `mdast-util-to-markdown` | 2.1.2 | MIT |
| `mdast-util-to-string` | 4.0.0 | MIT |
| `mdn-data` | 2.27.1 | CC0-1.0 |
| `merge-refs` | 2.0.0 | MIT |
| `merge2` | 1.4.1 | MIT |
| `mermaid` | 11.13.0 | MIT |
| `micromark` | 4.0.2 | MIT |
| `micromark-core-commonmark` | 2.0.3 | MIT |
| `micromark-extension-gfm` | 3.0.0 | MIT |
| `micromark-extension-gfm-autolink-literal` | 2.1.0 | MIT |
| `micromark-extension-gfm-footnote` | 2.1.0 | MIT |
| `micromark-extension-gfm-strikethrough` | 2.1.0 | MIT |
| `micromark-extension-gfm-table` | 2.1.1 | MIT |
| `micromark-extension-gfm-tagfilter` | 2.0.0 | MIT |
| `micromark-extension-gfm-task-list-item` | 2.1.0 | MIT |
| `micromark-extension-math` | 3.1.0 | MIT |
| `micromark-factory-destination` | 2.0.1 | MIT |
| `micromark-factory-label` | 2.0.1 | MIT |
| `micromark-factory-space` | 2.0.1 | MIT |
| `micromark-factory-title` | 2.0.1 | MIT |
| `micromark-factory-whitespace` | 2.0.1 | MIT |
| `micromark-util-character` | 2.1.1 | MIT |
| `micromark-util-chunked` | 2.0.1 | MIT |
| `micromark-util-classify-character` | 2.0.1 | MIT |
| `micromark-util-combine-extensions` | 2.0.1 | MIT |
| `micromark-util-decode-numeric-character-reference` | 2.0.2 | MIT |
| `micromark-util-decode-string` | 2.0.1 | MIT |
| `micromark-util-encode` | 2.0.1 | MIT |
| `micromark-util-html-tag-name` | 2.0.1 | MIT |
| `micromark-util-normalize-identifier` | 2.0.1 | MIT |
| `micromark-util-resolve-all` | 2.0.1 | MIT |
| `micromark-util-sanitize-uri` | 2.0.1 | MIT |
| `micromark-util-subtokenize` | 2.1.0 | MIT |
| `micromark-util-symbol` | 2.0.1 | MIT |
| `micromark-util-types` | 2.0.2 | MIT |
| `micromatch` | 4.0.8 | MIT |
| `mime` | 1.2.11 | Unknown |
| `mime-db` | 1.52.0 | MIT |
| `mime-types` | 2.1.35 | MIT |
| `minimalistic-assert` | 1.0.1 | ISC |
| `minimatch` | 9.0.5, 9.0.9 | ISC |
| `minimist` | 1.2.8 | MIT |
| `minipass` | 7.1.2 | ISC |
| `minipass` | 7.1.3 | BlueOak-1.0.0 |
| `minizlib` | 3.1.0 | MIT |
| `mlly` | 1.8.1 | MIT |
| `module-details-from-path` | 1.0.4 | MIT |
| `motion` | 12.29.2 | MIT |
| `motion-dom` | 12.29.2 | MIT |
| `motion-utils` | 12.29.2 | MIT |
| `ms` | 2.1.3 | MIT |
| `msgpackr` | 1.11.5 | MIT |
| `msgpackr-extract` | 3.0.3 | MIT |
| `multipasta` | 0.2.7 | MIT |
| `mustache` | 4.2.0 | MIT |
| `mysql` | 2.18.1 | MIT |
| `mz` | 2.7.0 | MIT |
| `nanoid` | 3.3.11 | MIT |
| `nanostores` | 1.5.2 | MIT |
| `needle` | 3.3.1 | MIT |
| `neo-async` | 2.6.2 | MIT |
| `neo4j-driver` | 6.0.1 | Apache-2.0 |
| `neo4j-driver-bolt-connection` | 6.0.1 | Apache-2.0 |
| `neo4j-driver-core` | 6.0.1 | Apache-2.0 |
| `next` | 15.5.7 | MIT |
| `next-themes` | 0.4.6 | MIT |
| `nice-grpc` | 2.1.12 | MIT |
| `nice-grpc-client-middleware-retry` | 3.1.11 | MIT |
| `nice-grpc-common` | 2.0.2 | MIT |
| `node-domexception` | 1.0.0 | MIT |
| `node-ensure` | 0.0.0 | MIT |
| `node-fetch` | 2.7.0, 3.3.2 | MIT |
| `node-gyp-build-optional-packages` | 5.2.2 | MIT |
| `node-releases` | 2.0.27 | MIT |
| `node-uuid` | 1.4.8 | MIT |
| `normalize-path` | 3.0.0 | MIT |
| `nth-check` | 2.1.1 | BSD-2-Clause |
| `oauth-sign` | 0.2.0 | Unknown |
| `object-assign` | 4.1.1 | MIT |
| `object-hash` | 3.0.0 | MIT |
| `object-keys` | 1.1.1 | MIT |
| `okapibm25` | 1.4.1 | MIT |
| `ollama` | 0.5.18 | MIT |
| `ollama-ai-provider` | 1.2.0 | Apache-2.0 |
| `on-exit-leak-free` | 2.1.2 | MIT |
| `onnxruntime-common` | 1.21.0, 1.22.0-dev.20250409-89f8206ba4, 1.23.2 | MIT |
| `onnxruntime-node` | 1.21.0 | MIT |
| `onnxruntime-web` | 1.22.0-dev.20250409-89f8206ba4, 1.23.2 | MIT |
| `openai` | 4.104.0, 5.12.2 | Apache-2.0 |
| `openapi-types` | 12.1.3 | MIT |
| `opencollective-postinstall` | 2.0.3 | MIT |
| `option` | 0.2.4 | BSD-2-Clause |
| `orderedmap` | 2.1.1 | MIT |
| `p-finally` | 1.0.0 | MIT |
| `p-limit` | 7.1.1 | MIT |
| `p-queue` | 6.6.2 | MIT |
| `p-retry` | 4.6.2 | MIT |
| `p-timeout` | 3.2.0 | MIT |
| `package-json-from-dist` | 1.0.1 | BlueOak-1.0.0 |
| `package-manager-detector` | 1.6.0 | MIT |
| `pako` | 1.0.11, 2.1.0 | (MIT AND Zlib) |
| `parse-entities` | 4.0.2 | MIT |
| `parse5` | 7.3.0, 8.0.1 | MIT |
| `parse5-htmlparser2-tree-adapter` | 7.1.0 | MIT |
| `parse5-parser-stream` | 7.1.2 | MIT |
| `partial-json` | 0.1.7 | MIT |
| `path-data-parser` | 0.1.0 | MIT |
| `path-expression-matcher` | 1.2.1 | MIT |
| `path-is-absolute` | 1.0.1 | MIT |
| `path-key` | 3.1.1 | MIT |
| `path-parse` | 1.0.7 | MIT |
| `path-scurry` | 1.11.1 | BlueOak-1.0.0 |
| `pathe` | 2.0.3 | MIT |
| `pathval` | 2.0.1 | MIT |
| `pdf-lib` | 1.17.1 | MIT |
| `pdf-parse` | 1.1.1 | MIT |
| `pdfjs-dist` | 5.4.296, 5.4.530 | Apache-2.0 |
| `pdfjs-serverless` | 1.1.0 | MIT |
| `peek-readable` | 4.1.0 | MIT |
| `pg-int8` | 1.0.1 | ISC |
| `pg-protocol` | 1.10.3 | MIT |
| `pg-types` | 2.2.0 | MIT |
| `picocolors` | 1.1.1 | ISC |
| `picomatch` | 2.3.1, 4.0.5 | MIT |
| `pify` | 2.3.0 | MIT |
| `pino` | 10.3.1 | MIT |
| `pino-abstract-transport` | 3.0.0 | MIT |
| `pino-std-serializers` | 7.1.0 | MIT |
| `pirates` | 4.0.7 | MIT |
| `pizzip` | 3.2.0 | (MIT OR GPL-3.0) |
| `pkg-types` | 1.3.1 | MIT |
| `pkginfo` | 0.3.1 | MIT |
| `platform` | 1.3.6 | MIT |
| `playwright` | 1.55.0 | Apache-2.0 |
| `playwright-core` | 1.55.0 | Apache-2.0 |
| `points-on-curve` | 0.2.0 | MIT |
| `points-on-path` | 0.2.1 | MIT |
| `postcss` | 8.4.31, 8.5.6 | MIT |
| `postcss-import` | 15.1.0 | MIT |
| `postcss-js` | 4.0.1 | MIT |
| `postcss-load-config` | 4.0.2 | MIT |
| `postcss-nested` | 6.2.0 | MIT |
| `postcss-selector-parser` | 6.1.2 | MIT |
| `postcss-value-parser` | 4.2.0 | MIT |
| `postgres` | 3.4.7 | Unlicense |
| `postgres-array` | 2.0.0 | MIT |
| `postgres-bytea` | 1.0.0 | MIT |
| `postgres-date` | 1.0.7 | MIT |
| `postgres-interval` | 1.2.0 | MIT |
| `process` | 0.11.10 | MIT |
| `process-nextick-args` | 2.0.1 | MIT |
| `process-warning` | 5.0.0 | MIT |
| `prom-client` | 15.1.3 | Apache-2.0 |
| `prop-types` | 15.8.1 | MIT |
| `property-information` | 7.1.0 | MIT |
| `prosemirror-changeset` | 2.4.0 | MIT |
| `prosemirror-commands` | 1.7.1 | MIT |
| `prosemirror-dropcursor` | 1.8.2 | MIT |
| `prosemirror-gapcursor` | 1.4.0 | MIT |
| `prosemirror-history` | 1.5.0 | MIT |
| `prosemirror-keymap` | 1.2.3 | MIT |
| `prosemirror-model` | 1.25.4 | MIT |
| `prosemirror-schema-list` | 1.5.1 | MIT |
| `prosemirror-state` | 1.4.4 | MIT |
| `prosemirror-tables` | 1.8.5 | MIT |
| `prosemirror-transform` | 1.11.0 | MIT |
| `prosemirror-view` | 1.41.6 | MIT |
| `protobufjs` | 7.5.4, 7.6.5 | BSD-3-Clause |
| `proxy-from-env` | 1.1.0 | MIT |
| `psl` | 1.15.0 | MIT |
| `psql` | 0.0.1 | ISC |
| `punycode` | 2.3.1 | MIT |
| `pure-rand` | 6.1.0 | MIT |
| `q` | 1.5.1 | MIT |
| `qs` | 0.5.6 | Unknown |
| `querystringify` | 2.2.0 | MIT |
| `queue-microtask` | 1.2.3 | MIT |
| `quick-format-unescaped` | 4.0.4 | MIT |
| `re-resizable` | 6.11.2 | MIT |
| `react` | 18.3.1 | MIT |
| `react-dom` | 18.3.1 | MIT |
| `react-hook-form` | 7.68.0 | MIT |
| `react-is` | 16.13.1, 18.3.1 | MIT |
| `react-markdown` | 9.1.0 | MIT |
| `react-pdf` | 10.3.0 | MIT |
| `react-remove-scroll` | 2.7.2 | MIT |
| `react-remove-scroll-bar` | 2.3.8 | MIT |
| `react-resizable-panels` | 2.1.9 | MIT |
| `react-smooth` | 4.0.4 | MIT |
| `react-style-singleton` | 2.2.3 | MIT |
| `react-transition-group` | 4.4.5 | BSD-3-Clause |
| `read-cache` | 1.0.0 | MIT |
| `readable-stream` | 2.3.7, 2.3.8, 4.7.0 | MIT |
| `readable-web-to-node-stream` | 3.0.4 | MIT |
| `readdirp` | 3.6.0 | MIT |
| `real-require` | 0.2.0 | MIT |
| `recharts` | 2.15.4 | MIT |
| `recharts-scale` | 0.4.5 | MIT |
| `regenerator-runtime` | 0.13.11 | MIT |
| `rehype-katex` | 7.0.1 | MIT |
| `rehype-raw` | 7.0.0 | MIT |
| `remark-gfm` | 4.0.1 | MIT |
| `remark-math` | 6.0.0 | MIT |
| `remark-parse` | 11.0.0 | MIT |
| `remark-rehype` | 11.1.2 | MIT |
| `remark-stringify` | 11.0.0 | MIT |
| `request` | 2.16.6 | Unknown |
| `require-directory` | 2.1.1 | MIT |
| `require-from-string` | 2.0.2 | MIT |
| `require-in-the-middle` | 7.5.2, 8.0.1 | MIT |
| `requires-port` | 1.0.0 | MIT |
| `resolve` | 1.22.10, 1.22.12 | MIT |
| `resolve-pkg-maps` | 1.0.0 | MIT |
| `retry` | 0.13.1 | MIT |
| `retry-axios` | 2.6.0 | Apache-2.0 |
| `reusify` | 1.1.0 | MIT |
| `rimraf` | 5.0.10 | ISC |
| `roarr` | 2.15.4 | BSD-3-Clause |
| `robust-predicates` | 3.0.2 | Unlicense |
| `rollup` | 4.62.4 | MIT |
| `rope-sequence` | 1.3.4 | MIT |
| `rou3` | 0.9.2 | MIT |
| `roughjs` | 4.6.6 | MIT |
| `run-parallel` | 1.2.0 | MIT |
| `rw` | 1.3.3 | BSD-3-Clause |
| `rxjs` | 7.8.2 | Apache-2.0 |
| `safe-buffer` | 5.1.2, 5.2.1 | MIT |
| `safe-stable-stringify` | 2.5.0 | MIT |
| `safer-buffer` | 2.1.2 | MIT |
| `sax` | 1.4.1 | ISC |
| `saxes` | 6.0.0 | ISC |
| `scheduler` | 0.23.2 | MIT |
| `secure-json-parse` | 2.7.0 | BSD-3-Clause |
| `semver` | 6.3.1, 7.7.3, 7.8.5 | ISC |
| `semver-compare` | 1.0.0 | MIT |
| `serialize-error` | 7.0.1 | MIT |
| `serialize-error-cjs` | 0.1.4 | MIT-0 |
| `set-cookie-parser` | 3.1.2 | MIT |
| `setimmediate` | 1.0.5 | MIT |
| `sharp` | 0.33.5, 0.34.3 | Apache-2.0 |
| `shebang-command` | 2.0.0 | MIT |
| `shebang-regex` | 3.0.0 | MIT |
| `siginfo` | 2.0.0 | ISC |
| `signal-exit` | 4.1.0 | ISC |
| `simple-swizzle` | 0.2.2 | MIT |
| `simple-wcswidth` | 1.1.2 | MIT |
| `sntp` | 0.1.4 | BSD |
| `sonic-boom` | 4.2.1 | MIT |
| `sonner` | 2.0.7 | MIT |
| `source-map` | 0.6.1 | BSD-3-Clause |
| `source-map-js` | 1.2.1 | BSD-3-Clause |
| `source-map-support` | 0.5.21 | MIT |
| `space-separated-tokens` | 2.0.2 | MIT |
| `split2` | 4.2.0 | ISC |
| `sprintf-js` | 1.0.3, 1.1.3 | BSD-3-Clause |
| `sqids` | 0.3.0 | MIT |
| `sqlstring` | 2.3.1 | MIT |
| `ssf` | 0.11.2 | Apache-2.0 |
| `stack-trace` | 0.0.10 | MIT |
| `stackback` | 0.0.2 | MIT |
| `std-env` | 3.9.0 | MIT |
| `string_decoder` | 1.1.1, 1.3.0 | MIT |
| `string-similarity-js` | 2.1.4 | MIT |
| `string-width` | 4.2.3, 5.1.2 | MIT |
| `stringify-entities` | 4.0.4 | MIT |
| `strip-ansi` | 5.2.0, 6.0.1 | MIT |
| `strip-literal` | 3.1.0 | MIT |
| `strnum` | 1.1.2, 2.2.2 | MIT |
| `strtok3` | 6.3.0 | MIT |
| `style-to-js` | 1.1.21 | MIT |
| `style-to-object` | 1.0.14 | MIT |
| `styled-jsx` | 5.1.6 | MIT |
| `stylis` | 4.3.6 | MIT |
| `sucrase` | 3.35.0 | MIT |
| `supports-color` | 7.2.0 | MIT |
| `supports-preserve-symlinks-flag` | 1.0.0 | MIT |
| `symbol-tree` | 3.2.4 | MIT |
| `systeminformation` | 5.32.0 | MIT |
| `tailwind-merge` | 3.4.0 | MIT |
| `tailwindcss` | 3.4.17 | MIT |
| `tar` | 7.5.6 | BlueOak-1.0.0 |
| `tdigest` | 0.1.2 | MIT |
| `temporal-polyfill` | 0.2.5 | MIT |
| `temporal-spec` | 0.2.4 | ISC |
| `tesseract.js` | 7.0.0 | Apache-2.0 |
| `tesseract.js-core` | 7.0.0 | Apache-2.0 |
| `thenify` | 3.3.1 | MIT |
| `thenify-all` | 1.6.0 | MIT |
| `thread-stream` | 4.0.0 | MIT |
| `throttleit` | 2.1.0 | MIT |
| `tiny-invariant` | 1.3.3 | MIT |
| `tinybench` | 2.9.0 | MIT |
| `tinyexec` | 0.3.2, 1.0.2 | MIT |
| `tinyglobby` | 0.2.17 | MIT |
| `tinypool` | 1.1.1 | MIT |
| `tinyrainbow` | 2.0.0 | MIT |
| `tinyspy` | 4.0.4 | MIT |
| `tldts` | 7.0.28 | MIT |
| `tldts-core` | 7.0.28 | MIT |
| `to-regex-range` | 5.0.1 | MIT |
| `token-types` | 4.2.1 | MIT |
| `tough-cookie` | 4.1.4, 6.0.1 | BSD-3-Clause |
| `tr46` | 0.0.3, 6.0.0 | MIT |
| `trim-lines` | 3.0.1 | MIT |
| `trough` | 2.2.0 | MIT |
| `ts-algebra` | 2.0.0 | MIT |
| `ts-dedent` | 2.2.0 | MIT |
| `ts-error` | 1.0.6 | MIT |
| `ts-interface-checker` | 0.1.13 | Apache-2.0 |
| `tslib` | 1.14.1, 2.8.1 | 0BSD |
| `tsx` | 4.20.5, 4.21.0 | MIT |
| `tunnel-agent` | 0.2.0 | Unknown |
| `turndown` | 7.2.2 | MIT |
| `type-fest` | 0.13.1 | (MIT OR CC0-1.0) |
| `typescript` | 5.9.3 | Apache-2.0 |
| `ufo` | 1.6.3 | MIT |
| `uglify-js` | 3.19.3 | BSD-2-Clause |
| `ulid` | 2.4.0 | MIT |
| `underscore` | 1.7.0, 1.13.7 | MIT |
| `underscore.string` | 2.4.0 | MIT |
| `undici` | 6.23.0, 7.25.0 | MIT |
| `undici-types` | 5.26.5, 6.21.0, 7.10.0 | MIT |
| `unified` | 11.0.5 | MIT |
| `unist-util-find-after` | 5.0.0 | MIT |
| `unist-util-is` | 6.0.1 | MIT |
| `unist-util-position` | 5.0.0 | MIT |
| `unist-util-remove-position` | 5.0.0 | MIT |
| `unist-util-stringify-position` | 4.0.0 | MIT |
| `unist-util-visit` | 5.0.0 | MIT |
| `unist-util-visit-parents` | 6.0.2 | MIT |
| `universalify` | 0.2.0 | MIT |
| `update-browserslist-db` | 1.1.4 | MIT |
| `uploadthing` | 7.7.4 | MIT |
| `url-parse` | 1.5.10 | MIT |
| `use-callback-ref` | 1.3.3 | MIT |
| `use-sidecar` | 1.1.3 | MIT |
| `use-sync-external-store` | 1.5.0 | MIT |
| `util-deprecate` | 1.0.2 | MIT |
| `uuid` | 9.0.1, 10.0.0, 11.1.0 | MIT |
| `vfile` | 6.0.3 | MIT |
| `vfile-location` | 5.0.3 | MIT |
| `vfile-message` | 4.0.3 | MIT |
| `victory-vendor` | 36.9.2 | MIT AND ISC |
| `vite` | 7.3.6 | MIT |
| `vite-node` | 3.2.4 | MIT |
| `vitest` | 3.2.7 | MIT |
| `vscode-jsonrpc` | 8.2.0 | MIT |
| `vscode-languageserver` | 9.0.1 | MIT |
| `vscode-languageserver-protocol` | 3.17.5 | MIT |
| `vscode-languageserver-textdocument` | 1.0.12 | MIT |
| `vscode-languageserver-types` | 3.17.5 | MIT |
| `vscode-uri` | 3.1.0 | MIT |
| `w3c-keyname` | 2.2.8 | MIT |
| `w3c-xmlserializer` | 5.0.0 | MIT |
| `warning` | 4.0.3 | MIT |
| `wasm-feature-detect` | 1.8.0 | Apache-2.0 |
| `weaviate-client` | 3.8.1 | BSD-3-Clause |
| `web-namespaces` | 2.0.1 | MIT |
| `web-streams-polyfill` | 3.3.3, 4.0.0-beta.3 | MIT |
| `webidl-conversions` | 3.0.1, 8.0.1 | BSD-2-Clause |
| `whatwg-encoding` | 3.1.1 | MIT |
| `whatwg-fetch` | 3.6.20 | MIT |
| `whatwg-mimetype` | 4.0.0, 5.0.0 | MIT |
| `whatwg-url` | 5.0.0, 16.0.1 | MIT |
| `which` | 2.0.2 | ISC |
| `why-is-node-running` | 2.3.0 | MIT |
| `winston` | 0.7.3 | MIT |
| `wmf` | 1.0.2 | Apache-2.0 |
| `word` | 0.3.0 | Apache-2.0 |
| `wordwrap` | 0.0.2 | MIT/X11 |
| `wordwrap` | 1.0.0 | MIT |
| `wrap-ansi` | 7.0.0 | MIT |
| `ws` | 8.21.1 | MIT |
| `xlsx` | 0.18.5 | Apache-2.0 |
| `xml-name-validator` | 5.0.0 | Apache-2.0 |
| `xmlbuilder` | 10.1.1 | MIT |
| `xmlchars` | 2.2.0 | MIT |
| `xtend` | 4.0.2 | MIT |
| `y18n` | 5.0.8 | ISC |
| `yallist` | 3.1.1 | ISC |
| `yallist` | 5.0.0 | BlueOak-1.0.0 |
| `yaml` | 2.9.0 | ISC |
| `yaml-config` | 0.3.0 | Unknown |
| `yargs` | 1.3.3 | MIT/X11 |
| `yargs` | 17.7.2, 17.7.3 | MIT |
| `yargs-parser` | 21.1.1 | ISC |
| `yocto-queue` | 1.2.1 | MIT |
| `zlibjs` | 0.3.1 | MIT |
| `zod` | 3.25.76, 4.5.4 | MIT |
| `zod-to-json-schema` | 3.25.2 | ISC |
| `zwitch` | 2.0.4 | MIT |

</details>

## services/document-converter

Node service: routing, vision classification, PDF page rendering, and docling-backed conversion.

**160 runtime packages.**

| License | Packages |
| --- | ---: |
| MIT | 99 |
| Apache-2.0 | 15 |
| BSD-3-Clause | 14 |
| ISC | 10 |
| LGPL-3.0-or-later | 10 |
| BlueOak-1.0.0 | 4 |
| Apache-2.0 AND LGPL-3.0-or-later | 3 |
| 0BSD | 2 |
| (MIT AND Zlib) | 1 |
| (MIT OR CC0-1.0) | 1 |
| Apache-2.0 AND LGPL-3.0-or-later AND MIT | 1 |

### Requires attention

- **Apache-2.0 AND LGPL-3.0-or-later AND MIT** — @img/sharp-wasm32@0.34.5
- **Apache-2.0 AND LGPL-3.0-or-later** — @img/sharp-win32-arm64@0.34.5, @img/sharp-win32-ia32@0.34.5, @img/sharp-win32-x64@0.34.5
- **LGPL-3.0-or-later** — @img/sharp-libvips-darwin-arm64@1.2.4, @img/sharp-libvips-darwin-x64@1.2.4, @img/sharp-libvips-linux-arm64@1.2.4, @img/sharp-libvips-linux-arm@1.2.4, @img/sharp-libvips-linux-ppc64@1.2.4, @img/sharp-libvips-linux-riscv64@1.2.4, @img/sharp-libvips-linux-s390x@1.2.4, @img/sharp-libvips-linux-x64@1.2.4, @img/sharp-libvips-linuxmusl-arm64@1.2.4, @img/sharp-libvips-linuxmusl-x64@1.2.4

<details>
<summary>Full inventory</summary>

| Package | Version | License |
| --- | --- | --- |
| `@emnapi/runtime` | 1.11.3 | MIT |
| `@huggingface/jinja` | 0.5.9 | MIT |
| `@huggingface/transformers` | 3.8.1 | Apache-2.0 |
| `@img/colour` | 1.1.0 | MIT |
| `@img/sharp-darwin-arm64` | 0.34.5 | Apache-2.0 |
| `@img/sharp-darwin-x64` | 0.34.5 | Apache-2.0 |
| `@img/sharp-libvips-darwin-arm64` | 1.2.4 | LGPL-3.0-or-later |
| `@img/sharp-libvips-darwin-x64` | 1.2.4 | LGPL-3.0-or-later |
| `@img/sharp-libvips-linux-arm` | 1.2.4 | LGPL-3.0-or-later |
| `@img/sharp-libvips-linux-arm64` | 1.2.4 | LGPL-3.0-or-later |
| `@img/sharp-libvips-linux-ppc64` | 1.2.4 | LGPL-3.0-or-later |
| `@img/sharp-libvips-linux-riscv64` | 1.2.4 | LGPL-3.0-or-later |
| `@img/sharp-libvips-linux-s390x` | 1.2.4 | LGPL-3.0-or-later |
| `@img/sharp-libvips-linux-x64` | 1.2.4 | LGPL-3.0-or-later |
| `@img/sharp-libvips-linuxmusl-arm64` | 1.2.4 | LGPL-3.0-or-later |
| `@img/sharp-libvips-linuxmusl-x64` | 1.2.4 | LGPL-3.0-or-later |
| `@img/sharp-linux-arm` | 0.34.5 | Apache-2.0 |
| `@img/sharp-linux-arm64` | 0.34.5 | Apache-2.0 |
| `@img/sharp-linux-ppc64` | 0.34.5 | Apache-2.0 |
| `@img/sharp-linux-riscv64` | 0.34.5 | Apache-2.0 |
| `@img/sharp-linux-s390x` | 0.34.5 | Apache-2.0 |
| `@img/sharp-linux-x64` | 0.34.5 | Apache-2.0 |
| `@img/sharp-linuxmusl-arm64` | 0.34.5 | Apache-2.0 |
| `@img/sharp-linuxmusl-x64` | 0.34.5 | Apache-2.0 |
| `@img/sharp-wasm32` | 0.34.5 | Apache-2.0 AND LGPL-3.0-or-later AND MIT |
| `@img/sharp-win32-arm64` | 0.34.5 | Apache-2.0 AND LGPL-3.0-or-later |
| `@img/sharp-win32-ia32` | 0.34.5 | Apache-2.0 AND LGPL-3.0-or-later |
| `@img/sharp-win32-x64` | 0.34.5 | Apache-2.0 AND LGPL-3.0-or-later |
| `@isaacs/fs-minipass` | 4.0.1 | ISC |
| `@pdf-lib/standard-fonts` | 1.0.0 | MIT |
| `@pdf-lib/upng` | 1.0.1 | MIT |
| `@protobufjs/aspromise` | 1.1.2 | BSD-3-Clause |
| `@protobufjs/base64` | 1.1.2 | BSD-3-Clause |
| `@protobufjs/codegen` | 2.0.5 | BSD-3-Clause |
| `@protobufjs/eventemitter` | 1.1.1 | BSD-3-Clause |
| `@protobufjs/fetch` | 1.1.1 | BSD-3-Clause |
| `@protobufjs/float` | 1.0.2 | BSD-3-Clause |
| `@protobufjs/path` | 1.1.2 | BSD-3-Clause |
| `@protobufjs/pool` | 1.1.0 | BSD-3-Clause |
| `@protobufjs/utf8` | 1.1.2 | BSD-3-Clause |
| `@types/node` | 22.20.1 | MIT |
| `accepts` | 2.0.0 | MIT |
| `array-parallel` | 0.1.3 | MIT |
| `array-series` | 0.1.5 | MIT |
| `body-parser` | 2.3.0 | MIT |
| `boolean` | 3.2.0 | MIT |
| `bytes` | 3.1.2 | MIT |
| `call-bind-apply-helpers` | 1.0.2 | MIT |
| `call-bound` | 1.0.4 | MIT |
| `chownr` | 3.0.0 | BlueOak-1.0.0 |
| `content-disposition` | 1.1.0 | MIT |
| `content-type` | 1.0.5 | MIT |
| `content-type` | 2.0.0 | MIT |
| `cookie` | 0.7.2 | MIT |
| `cookie-signature` | 1.2.2 | MIT |
| `cross-spawn` | 7.0.6 | MIT |
| `debug` | 3.2.7 | MIT |
| `debug` | 4.4.3 | MIT |
| `define-data-property` | 1.1.4 | MIT |
| `define-properties` | 1.2.1 | MIT |
| `depd` | 2.0.0 | MIT |
| `detect-libc` | 2.1.2 | Apache-2.0 |
| `detect-node` | 2.1.0 | MIT |
| `dunder-proto` | 1.0.1 | MIT |
| `ee-first` | 1.1.1 | MIT |
| `encodeurl` | 2.0.0 | MIT |
| `es-define-property` | 1.0.1 | MIT |
| `es-errors` | 1.3.0 | MIT |
| `es-object-atoms` | 1.1.2 | MIT |
| `es6-error` | 4.1.1 | MIT |
| `escape-html` | 1.0.3 | MIT |
| `escape-string-regexp` | 4.0.0 | MIT |
| `etag` | 1.8.1 | MIT |
| `express` | 5.2.1 | MIT |
| `finalhandler` | 2.1.1 | MIT |
| `flatbuffers` | 25.9.23 | Apache-2.0 |
| `forwarded` | 0.2.0 | MIT |
| `fresh` | 2.0.0 | MIT |
| `function-bind` | 1.1.2 | MIT |
| `get-intrinsic` | 1.3.0 | MIT |
| `get-proto` | 1.0.1 | MIT |
| `global-agent` | 3.0.0 | BSD-3-Clause |
| `globalthis` | 1.0.4 | MIT |
| `gm` | 1.25.1 | MIT |
| `gopd` | 1.2.0 | MIT |
| `guid-typescript` | 1.0.9 | ISC |
| `has-property-descriptors` | 1.0.2 | MIT |
| `has-symbols` | 1.1.0 | MIT |
| `hasown` | 2.0.4 | MIT |
| `http-errors` | 2.0.1 | MIT |
| `iconv-lite` | 0.7.3 | MIT |
| `inherits` | 2.0.4 | ISC |
| `ipaddr.js` | 1.9.1 | MIT |
| `is-promise` | 4.0.0 | MIT |
| `isexe` | 2.0.0 | ISC |
| `json-stringify-safe` | 5.0.1 | ISC |
| `long` | 5.3.2 | Apache-2.0 |
| `matcher` | 3.0.0 | MIT |
| `math-intrinsics` | 1.1.0 | MIT |
| `media-typer` | 1.1.1 | MIT |
| `merge-descriptors` | 2.0.0 | MIT |
| `mime-db` | 1.54.0 | MIT |
| `mime-types` | 3.0.2 | MIT |
| `minipass` | 7.1.3 | BlueOak-1.0.0 |
| `minizlib` | 3.1.0 | MIT |
| `ms` | 2.1.3 | MIT |
| `negotiator` | 1.0.0 | MIT |
| `node-ensure` | 0.0.0 | MIT |
| `object-inspect` | 1.13.4 | MIT |
| `object-keys` | 1.1.1 | MIT |
| `on-finished` | 2.4.1 | MIT |
| `once` | 1.4.0 | ISC |
| `onnxruntime-common` | 1.21.0 | MIT |
| `onnxruntime-common` | 1.22.0-dev.20250409-89f8206ba4 | MIT |
| `onnxruntime-node` | 1.21.0 | MIT |
| `onnxruntime-web` | 1.22.0-dev.20250409-89f8206ba4 | MIT |
| `pako` | 1.0.11 | (MIT AND Zlib) |
| `parseurl` | 1.3.3 | MIT |
| `path-key` | 3.1.1 | MIT |
| `path-to-regexp` | 8.4.2 | MIT |
| `pdf-lib` | 1.17.1 | MIT |
| `pdf-parse` | 1.1.4 | MIT |
| `pdf2pic` | 3.2.0 | MIT |
| `platform` | 1.3.6 | MIT |
| `protobufjs` | 7.6.5 | BSD-3-Clause |
| `proxy-addr` | 2.0.7 | MIT |
| `qs` | 6.15.3 | BSD-3-Clause |
| `range-parser` | 1.3.0 | MIT |
| `raw-body` | 3.0.2 | MIT |
| `roarr` | 2.15.4 | BSD-3-Clause |
| `router` | 2.2.0 | MIT |
| `safer-buffer` | 2.1.2 | MIT |
| `semver` | 7.8.5 | ISC |
| `semver-compare` | 1.0.0 | MIT |
| `send` | 1.2.1 | MIT |
| `serialize-error` | 7.0.1 | MIT |
| `serve-static` | 2.2.1 | MIT |
| `setprototypeof` | 1.2.0 | ISC |
| `sharp` | 0.34.5 | Apache-2.0 |
| `shebang-command` | 2.0.0 | MIT |
| `shebang-regex` | 3.0.0 | MIT |
| `side-channel` | 1.1.1 | MIT |
| `side-channel-list` | 1.0.1 | MIT |
| `side-channel-map` | 1.0.1 | MIT |
| `side-channel-weakmap` | 1.0.2 | MIT |
| `sprintf-js` | 1.1.3 | BSD-3-Clause |
| `statuses` | 2.0.2 | MIT |
| `tar` | 7.5.22 | BlueOak-1.0.0 |
| `toidentifier` | 1.0.1 | MIT |
| `tslib` | 1.14.1 | 0BSD |
| `tslib` | 2.8.1 | 0BSD |
| `type-fest` | 0.13.1 | (MIT OR CC0-1.0) |
| `type-is` | 2.1.0 | MIT |
| `undici-types` | 6.21.0 | MIT |
| `unpipe` | 1.0.0 | MIT |
| `vary` | 1.1.2 | MIT |
| `which` | 2.0.2 | ISC |
| `wrappy` | 1.0.2 | ISC |
| `yallist` | 5.0.0 | BlueOak-1.0.0 |
| `zod` | 3.25.76 | MIT |

</details>

## services/adeu-ai-docs-editing

Python service: DOCX tracked-change editing, review-item enumeration, CriticMarkup preview, diffing.

**83 runtime packages.**

| License | Packages |
| --- | ---: |
| MIT | 34 |
| BSD-3-Clause | 16 |
| Apache-2.0 | 11 |
| Unknown | 6 |
| MIT License | 3 |
| ISC | 2 |
| # Released under MIT License | 1 |
| Apache-2.0 AND CNRI-Python | 1 |
| Apache-2.0 OR BSD-2-Clause | 1 |
| Apache-2.0 OR BSD-3-Clause | 1 |
| BSD | 1 |
| BSD-2-Clause | 1 |
| MIT OR Apache-2.0 | 1 |
| MIT-0 | 1 |
| MPL-2.0 | 1 |
| PSF-2.0 | 1 |
| Unlicense | 1 |

### Requires attention

- **MPL-2.0** — certifi@2026.7.22

<details>
<summary>Full inventory</summary>

| Package | Version | License |
| --- | --- | --- |
| `adeu` | 2.4.1 | MIT License |
| `aiofile` | 3.12.3 | Apache-2.0 |
| `annotated-doc` | 0.0.5 | MIT |
| `annotated-types` | 0.8.0 | MIT |
| `anyio` | 4.14.2 | MIT |
| `attrs` | 26.1.0 | MIT |
| `Authlib` | 1.7.2 | BSD-3-Clause |
| `beartype` | 0.22.9 | MIT License |
| `cachetools` | 7.1.7 | MIT |
| `caio` | 0.12.2 | Apache-2.0 |
| `certifi` | 2026.7.22 | MPL-2.0 |
| `cffi` | 2.1.1 | MIT-0 |
| `click` | 8.5.0 | BSD-3-Clause |
| `cryptography` | 50.0.1 | Apache-2.0 OR BSD-3-Clause |
| `cyclopts` | 4.23.3 | Apache-2.0 |
| `diff-match-patch` | 20241021 | Unknown |
| `dnspython` | 2.8.0 | ISC |
| `docstring_parser` | 0.18.0 | MIT |
| `email-validator` | 2.3.0 | Unlicense |
| `exceptiongroup` | 1.3.1 | Unknown |
| `fastapi` | 0.141.1 | MIT |
| `fastmcp` | 4.0.0b1 | Apache-2.0 |
| `fastmcp-slim` | 4.0.0b1 | Apache-2.0 |
| `griffelib` | 2.2.0 | ISC |
| `h11` | 0.16.0 | MIT |
| `httpcore` | 1.0.9 | BSD-3-Clause |
| `httpcore2` | 2.12.0 | BSD-3-Clause |
| `httptools` | 0.8.0 | MIT |
| `httpx` | 0.28.1 | BSD-3-Clause |
| `httpx2` | 2.12.0 | BSD-3-Clause |
| `idna` | 3.19 | BSD-3-Clause |
| `jaraco.classes` | 3.4.0 | Unknown |
| `jaraco.context` | 6.1.2 | MIT |
| `jaraco.functools` | 4.6.0 | MIT |
| `Jinja2` | 3.1.6 | Unknown |
| `joserfc` | 1.7.5 | BSD-3-Clause |
| `jsonref` | 1.1.0 | MIT |
| `jsonschema` | 4.26.0 | MIT |
| `jsonschema-path` | 0.5.0 | Apache-2.0 |
| `jsonschema-specifications` | 2025.9.1 | MIT |
| `keyring` | 25.7.0 | MIT |
| `lxml` | 6.1.2 | BSD-3-Clause |
| `markdown-it-py` | 4.2.0 | Unknown |
| `MarkupSafe` | 3.0.3 | BSD-3-Clause |
| `mcp` | 2.1.1 | MIT |
| `mcp-types` | 2.1.1 | MIT |
| `mdurl` | 0.1.2 | Unknown |
| `more-itertools` | 11.1.0 | MIT |
| `openapi-pydantic` | 0.5.1 | MIT |
| `opentelemetry-api` | 1.44.0 | Apache-2.0 |
| `packaging` | 26.3 | Apache-2.0 OR BSD-2-Clause |
| `pathable` | 0.6.0 | Apache-2.0 |
| `platformdirs` | 4.11.5 | MIT |
| `prefab-ui` | 0.20.2 | Apache-2.0 |
| `py-key-value-aio` | 0.4.5 | Apache-2.0 |
| `pycparser` | 3.0 | BSD-3-Clause |
| `pydantic` | 2.13.5 | MIT |
| `pydantic_core` | 2.46.5 | MIT |
| `pydantic-settings` | 2.15.0 | MIT |
| `Pygments` | 2.21.0 | BSD-2-Clause |
| `PyJWT` | 2.13.0 | MIT |
| `pyperclip` | 1.11.0 | BSD |
| `python-docx` | 1.2.0 | MIT |
| `python-dotenv` | 1.2.3 | BSD-3-Clause |
| `python-multipart` | 0.0.32 | Apache-2.0 |
| `PyYAML` | 6.0.3 | MIT |
| `RapidFuzz` | 3.14.5 | MIT |
| `referencing` | 0.37.0 | MIT |
| `regex` | 2026.7.19 | Apache-2.0 AND CNRI-Python |
| `rich` | 15.0.0 | MIT |
| `rich-rst` | 2.1.0 | MIT |
| `rpds-py` | 2026.6.3 | MIT |
| `sse-starlette` | 3.4.8 | BSD-3-Clause |
| `starlette` | 1.6.0 | BSD-3-Clause |
| `structlog` | 26.1.0 | MIT OR Apache-2.0 |
| `truststore` | 0.10.4 | MIT |
| `typing_extensions` | 4.16.0 | PSF-2.0 |
| `typing-inspection` | 0.4.4 | MIT |
| `uncalled-for` | 0.4.0 | # Released under MIT License |
| `uvicorn` | 0.52.4 | BSD-3-Clause |
| `uvloop` | 0.22.1 | MIT License |
| `watchfiles` | 1.2.0 | MIT |
| `websockets` | 17.1 | BSD-3-Clause |

</details>

## services/transcription

Python service: Whisper transcription and yt-dlp download. `torch` is installed from the PyTorch CPU wheel index, not PyPI (see the service Dockerfile).

**42 runtime packages.**

| License | Packages |
| --- | ---: |
| MIT | 17 |
| BSD-3-Clause | 9 |
| BSD | 3 |
| Apache-2.0 | 2 |
| MIT License | 2 |
| Apache-2.0 AND Apache-2.0 WITH LLVM-exception AND BSD-2-Clause AND BSD-3-Clause AND BSL-1.0 AND MIT | 1 |
| Apache-2.0 AND CNRI-Python | 1 |
| BSD-2-Clause AND Apache-2.0 WITH LLVM-exception | 1 |
| BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0 | 1 |
| MPL-2.0 | 1 |
| MPL-2.0 AND MIT | 1 |
| PSF-2.0 | 1 |
| Unknown | 1 |
| Unlicense | 1 |

### Requires attention

- **MPL-2.0 AND MIT** — tqdm@4.70.0
- **MPL-2.0** — certifi@2026.7.22

<details>
<summary>Full inventory</summary>

| Package | Version | License |
| --- | --- | --- |
| `annotated-doc` | 0.0.5 | MIT |
| `annotated-types` | 0.8.0 | MIT |
| `anyio` | 4.14.2 | MIT |
| `certifi` | 2026.7.22 | MPL-2.0 |
| `charset-normalizer` | 3.5.1 | MIT |
| `click` | 8.5.0 | BSD-3-Clause |
| `fastapi` | 0.141.1 | MIT |
| `filelock` | 3.32.4 | MIT |
| `fsspec` | 2026.7.0 | BSD-3-Clause |
| `h11` | 0.16.0 | MIT |
| `httptools` | 0.8.0 | MIT |
| `idna` | 3.19 | BSD-3-Clause |
| `Jinja2` | 3.1.6 | Unknown |
| `llvmlite` | 0.49.0 | BSD-2-Clause AND Apache-2.0 WITH LLVM-exception |
| `MarkupSafe` | 3.0.3 | BSD-3-Clause |
| `more-itertools` | 11.1.0 | MIT |
| `mpmath` | 1.3.0 | BSD |
| `networkx` | 3.6.1 | BSD-3-Clause |
| `numba` | 0.67.0 | BSD |
| `numpy` | 2.5.2 | BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0 |
| `openai-whisper` | 20250625 | MIT |
| `pydantic` | 2.13.5 | MIT |
| `pydantic_core` | 2.46.5 | MIT |
| `python-dotenv` | 1.2.3 | BSD-3-Clause |
| `python-multipart` | 0.0.32 | Apache-2.0 |
| `PyYAML` | 6.0.3 | MIT |
| `regex` | 2026.7.19 | Apache-2.0 AND CNRI-Python |
| `requests` | 2.34.2 | Apache-2.0 |
| `setuptools` | 84.0.0 | MIT |
| `starlette` | 1.6.0 | BSD-3-Clause |
| `sympy` | 1.14.0 | BSD |
| `tiktoken` | 0.14.0 | MIT License |
| `torch` | 2.13.0 | Apache-2.0 AND Apache-2.0 WITH LLVM-exception AND BSD-2-Clause AND BSD-3-Clause AND BSL-1.0 AND MIT |
| `tqdm` | 4.70.0 | MPL-2.0 AND MIT |
| `typing_extensions` | 4.16.0 | PSF-2.0 |
| `typing-inspection` | 0.4.4 | MIT |
| `urllib3` | 2.7.0 | MIT |
| `uvicorn` | 0.52.4 | BSD-3-Clause |
| `uvloop` | 0.22.1 | MIT License |
| `watchfiles` | 1.2.0 | MIT |
| `websockets` | 17.1 | BSD-3-Clause |
| `yt-dlp` | 2026.8.19 | Unlicense |

</details>

## License texts

The permissive licenses above (MIT, BSD-2-Clause, BSD-3-Clause, ISC, Apache-2.0,
0BSD, Unlicense, BlueOak-1.0.0) are reproduced by reference: each package's own
`LICENSE` file ships inside the image alongside its code, in
`node_modules/<pkg>/` or `site-packages/<dist>-<version>.dist-info/`. The
verbatim text for adeu is included above because this repository names it
explicitly as a core dependency.

## Known gaps

- Packages reported as `Unknown` declare their license in a non-standard
  `package.json` field (typically the pre-2015 `licenses: [{type, url}]`
  array) rather than having none. Most are transitive dependencies of the
  deprecated `request` package.
- Dual-licensed packages are listed with both options. Where one is permissive
  and one is copyleft — `jszip`, `pizzip`, `dompurify` — LaunchStack takes
  the permissive option.
- `sharp` bundles prebuilt `libvips` binaries under LGPL-3.0-or-later. They
  are used unmodified and dynamically loaded, which is the arrangement the LGPL
  is written for; a build that modifies libvips would take on further
  obligations.
- This file lists licenses, not a full SBOM. For vulnerability or provenance
  work, generate one from the lockfiles.
