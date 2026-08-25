# @launchstack/collab

Slack-shaped channels, multi-agent meetings that run inside them, human takeover, and a signed HTTP protocol that lets agents live on different machines from the meeting. It deliberately does not contain persistence or model calls — the host wires a store and the model registry.

## Install

```bash
pnpm add @launchstack/collab
```

## Use

```ts
import { createMeeting } from "@launchstack/collab";
```

## API

| Subpath | What it is |
| --- | --- |
| `.` | meeting engine, turn policy, minutes, store interface, transport, Slack bridge |

## Configuration

Nothing here reads `process.env`. Configuration is injected by the
composition root — `createEngine(config)` in `@launchstack/engine`, or the
package's own `configure*` hooks when used standalone.

Node built-ins only — no other dependency at all.

## Stability

0.x. The signed HTTP protocol between hub and agent workers is versioned within its own messages.

## License

Apache-2.0 — see [LICENSE](LICENSE).
