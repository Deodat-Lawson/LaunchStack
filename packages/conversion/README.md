# @launchstack/conversion

Any source in, ingestable evidence out. The document converter with one converter per supported type (pdf · docx · pptx · html · readability · image · spreadsheet · text · zip · github-export · slack-export · docling · fallback), audio and video transcription in their own folders with their own wire contracts and clients, OCR primitives and provider adapters, chunking, archive expansion, and the extraction router. It deliberately does not contain embedding, graph, or persistence of the converted output — that is @launchstack/indexing's job.

## Install

```bash
pnpm add @launchstack/conversion
```

## Use

```ts
import { routeDocument } from "@launchstack/conversion/extraction-router";
import { transcribeAudioFromUrl } from "@launchstack/conversion/audio-transcription";
import { isVideoUrl, transcribeVideoFromUrl } from "@launchstack/conversion/video-transcription";
```

## API

| Subpath | What it is |
| --- | --- |
| `.` | the whole feature: converters, transcriptions, router, ports, EvidenceDocument |
| `./evidence-document` | the feature's output contract — every converter's promise |
| `./document-converter` | converters, registry, wire, client |
| `./audio-transcription` | detection + transcription + document creation |
| `./video-transcription` | URL detection + download-then-transcribe |
| `./extraction-router` | (mime, filename, signals) → converter choice |
| `./archive-expansion` | archive upload → member sources |
| `./heading-chunker` | markdown → heading-aligned chunks |
| `./ocr` | OCR primitives: config, complexity, enrichment, provider adapters, processor |
| `./ports` | DocumentConverterPort · TranscriptionPort |

## Configuration

Nothing here reads `process.env`. Configuration is injected by the
composition root — `createEngine(config)` in `@launchstack/engine`, or the
package's own `configure*` hooks when used standalone.

The nine document parsers (mammoth, cheerio, jsdom, turndown, xlsx, jszip, pdf-lib, pdfjs-serverless, readability) are loaded lazily at the call site; `tesseract.js` is an optional peer. The transcription clients resolve their service endpoint from the environment — the one documented env exception below the composition root.

## Stability

0.x. The EvidenceDocument schema is frozen wire format (see ./evidence-document and the schema generator); everything else may still move.

## License

Apache-2.0 — see [LICENSE](LICENSE).
