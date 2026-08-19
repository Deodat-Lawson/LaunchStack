---
id: MN-WF-007
title: Decide the Self-Hosted Docker Topology
parent: MN-WF-000
status: closed
assignee: Main
labels:
  - wayfinder:grilling
blocked_by:
  - MN-WF-001
  - MN-WF-006
---

# Decide the Self-Hosted Docker Topology

## Question

What is the authoritative operator-owned deployment topology for web UI, RTMS worker, public HTTPS webhook and callback ingress, PostgreSQL, secrets, migrations, health checks, and optional existing services—and how should local development, a public Docker Compose host, and the current Vercel-plus-external-worker mode differ without becoming three architectures?

## Resolution

The authoritative production topology is the operator-owned Docker deployment with one
additional private `call-worker` service. It reuses the public HTTPS origin already used
to open the LaunchStack website; Call Notes does not add a mandatory proxy or tunnelling
vendor.

```text
Internet / Zoom
       |
existing LaunchStack HTTPS ingress
       |
     app  ───────── PostgreSQL
                       |
                  call-worker ── outbound HTTPS/WSS ── Zoom
```

### Production Compose contract

- `app` and `call-worker` are built from the same monorepo revision and start only after
  the one-shot `migrate` service succeeds and PostgreSQL is healthy.
- Existing HTTPS ingress forwards the website plus the documented Zoom webhook and OAuth
  callback paths to `app:3000`. `call-worker` publishes no port.
- `call-worker` restarts unless stopped, reports liveness/readiness, records a periodic
  database heartbeat, and can reach PostgreSQL and Zoom over outbound HTTPS/WSS.
- PostgreSQL retains Call Notes state and Transcript evidence in the existing durable
  volume. No Call Notes object-storage volume is added.
- Secrets are runtime inputs, never image build arguments or repository files. The web
  receives the Zoom client/webhook credentials needed at its edge; the worker receives
  only the Zoom/token-encryption and model credentials required for claimed jobs.
- OAuth access and refresh tokens are encrypted before database persistence. A separate
  operator-supplied encryption key is shared only with runtimes that must decrypt them.
- Health checks distinguish process liveness, database readiness, and stale worker
  heartbeat. An unhealthy web process must not imply that an active worker-owned Capture
  has stopped.
- Existing optional OCR, sidecar, object-storage, and Inngest services remain independent
  of RTMS availability. Call Notes release one adds no queue or mandatory Inngest
  production service.

### Same contract in each environment

- **Local development:** web and worker may run as local processes against the Compose
  database. Because Zoom cannot reach `localhost`, a developer-selected temporary HTTPS
  tunnel forwards the same Zoom paths to the local web process. That public origin must
  be configured in the developer's Zoom app for the test.
- **Public Docker host:** the operator's existing DNS, TLS, and reverse proxy expose the
  normal LaunchStack origin and Zoom paths. The worker stays on the private Compose
  network.
- **Current Vercel plus external worker:** Vercel supplies the web HTTPS origin while the
  externally hosted worker and web share the same reachable PostgreSQL command/event
  contract. No RTMS socket runs in Vercel.

The public base URL is configuration, not a separate architecture: production uses the
normal website URL; local RTMS tests use a tunnel URL. A bundled Caddy service or required
Cloudflare Tunnel may be documented as operator examples later, but neither is a release
dependency.
