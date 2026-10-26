# Deploying LaunchStack on a single Azure VM ("lean" stack)

This is the complete, reproducible guide to running LaunchStack publicly on one
Azure VM. It is written to be followed from an empty Azure subscription, and it
also documents the instance that is currently live.

**What "lean" means.** The full Compose stack self-hosts everything, including
a Whisper transcription model and the Docling document-parsing engine — roughly
7 GB of resident memory, which forces a 16 GB VM. The lean stack moves those two
workloads to pay-per-use APIs, drops to ~4.3 GB, and fits an 8 GB VM at about
half the monthly cost. Everything else — the app, the worker, Postgres with
pgvector, object storage, the document services — still runs on your own box.

`docker-compose.prod.yml` is the overlay that encodes this shape.
`docker/Caddyfile.prod` terminates TLS.

---

## Your deployment's inventory

Fill this in once and the rest of the guide refers back to it. The commands
below use these names.

| | |
|---|---|
| **URL** | `https://<DOMAIN>` |
| **Files origin** | `https://files.<DOMAIN>` |
| Resource group | `<RESOURCE_GROUP>` |
| VM | `<VM_NAME>` — Standard_D2as_v7 (2 vCPU / 8 GB), Ubuntu 24.04 |
| Public IP | `<PUBLIC_IP>` (static) |
| SSH | `ssh <ADMIN_USER>@<PUBLIC_IP>` |
| Open ports | 22, 80, 443 (Azure NSG) — nothing else is reachable from outside |
| Stack location | `/home/<ADMIN_USER>/LaunchStack` |
| OCR | `<DOCINTEL_NAME>` — Azure Document Intelligence, S0 (pay per page), see [OCR](#ocr-azure-document-intelligence) |
| Secrets | Key Vault `<VAULT_NAME>` |
| Backups | Storage account `<BACKUP_ACCOUNT>`, container `db-backups`, 30-day retention |

**On hostnames without a domain.** `*.sslip.io` is wildcard DNS that resolves
any `<ip>.sslip.io` name to that IP, so `https://<PUBLIC_IP>.sslip.io` gives a
publicly valid HTTPS hostname with no registrar. Certificates issue normally.
Swapping in your own domain later is the substitution in
[Moving to your own domain](#moving-to-your-own-domain).

## Prerequisites

- An Azure subscription and the `az` CLI, logged in (`az login`).
- The images published to GHCR by `.github/workflows/docker.yml`. They are
  public, so the VM pulls them without credentials, and they carry no
  build-time secrets — every value is read at runtime, so one image serves any
  deployment.
- Accounts for the services the app depends on: an OpenAI-compatible chat
  endpoint and an embeddings provider. Authentication is self-hosted
  (better-auth), so there is no auth vendor to sign up with.

---

## Step 1 — Provision the Azure resources

```bash
az group create -n <RESOURCE_GROUP> -l eastus2

az vm create \
  -g <RESOURCE_GROUP> -n <VM_NAME> -l eastus2 \
  --image Ubuntu2404 --size Standard_D2as_v7 \
  --os-disk-size-gb 64 --storage-sku StandardSSD_LRS \
  --public-ip-sku Standard --public-ip-address-allocation static \
  --admin-username launchstack --generate-ssh-keys \
  --custom-data cloud-init.yaml

az vm open-port -g <RESOURCE_GROUP> -n <VM_NAME> --port 80,443 --priority 900
```

with `cloud-init.yaml` installing Docker on first boot:

```yaml
#cloud-config
package_update: true
packages: [ca-certificates, curl, git]
runcmd:
  - curl -fsSL https://get.docker.com | sh
  - systemctl enable --now docker
  - usermod -aG docker launchstack
```

**On VM sizing.** Any 2 vCPU / 8 GB size works. The B-series burstable sizes
(`Standard_B2ms`) are the cheapest on paper, but were unavailable to this
subscription in every US region tested — `SkuNotAvailable ... Capacity
Restrictions`. `Standard_D2as_v7` is the same class at a comparable price and
isn't subject to burst-credit throttling. If a size fails, list what your
subscription can actually get:

```bash
az vm list-skus -l eastus2 --resource-type virtualMachines --query \
  "[?!restrictions[0]].name" -o tsv | sort -u
```

Then provision OCR (S0) and the backup storage account. Use S0, not the free
F0 tier: F0 analyzes only the **first two pages** of each document, so a
scanned book (or, with `OCR_PDF_STRATEGY=provider-first`, any book) would be
indexed as two pages.

```bash
az provider register --namespace Microsoft.CognitiveServices   # once per subscription

az cognitiveservices account create \
  -n <DOCINTEL_NAME> -g <RESOURCE_GROUP> \
  --kind FormRecognizer --sku S0 -l eastus2 --yes

az storage account create -n <unique-name> -g <RESOURCE_GROUP> -l eastus2 \
  --sku Standard_LRS --kind StorageV2 --access-tier Cool --allow-blob-public-access false
az storage container create -n db-backups --account-name <unique-name>
```

---

## Step 2 — Install the stack on the VM

```bash
ssh <ADMIN_USER>@<PUBLIC_IP>
git clone --depth 1 https://github.com/Deodat-Lawson/LaunchStack.git
```

Copy `docker-compose.prod.yml` and `docker/Caddyfile.prod` up if you are ahead
of what is committed on `main`.

---

## Step 3 — Configure `.env`

Create `/home/<ADMIN_USER>/LaunchStack/.env` (mode `600`, never committed).

**Generate every internal secret** — do not ship the `pdr_local_*` defaults from
`docker-compose.yml`. They exist so `make up` works locally and are marked
"override in production" for good reason:

```bash
openssl rand -hex 24    # one per secret below
```

| Variable | Notes |
|---|---|
| `DOMAIN` | The hostname you serve from. `files.$DOMAIN` is derived from it. |
| `POSTGRES_PASSWORD` | Also authenticates SeaweedFS's filer store — see [Troubleshooting](#seaweedfs-wont-start-failed-sasl-auth). |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` / `S3_BUCKET_NAME` / `S3_REGION` | SeaweedFS credentials. |
| `TRANSCRIPTION_SERVICE_API_KEY`, `ADEU_SERVICE_API_KEY`, `DOCUMENT_CONVERTER_API_KEY` | Each service authenticates fail-closed; a mismatch returns 401 on every call. |
| `FILE_ACCESS_TOKEN_SECRET` | Signs internal `/api/files` URLs. **App and worker must share one value**, or database-backed ingestion fails closed. |
| `EMAIL_UNSUBSCRIBE_SECRET` | Min 16 chars; required to send email campaigns. |
| `METRICS_SCRAPE_TOKEN` | Bearer token for `/api/metrics`; unset means the route fails closed at 503. |
| `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` | **Required.** Our own keys for the self-hosted Inngest server: `openssl rand -hex 32` each (the signing key must be hex, even length). Compose refuses to start without them. See [Background jobs](#background-jobs-self-hosted-inngest). |

**Required third-party credentials** (the app will not boot without the first
three):

| Variable | Notes |
|---|---|
| `BETTER_AUTH_SECRET` | **Required — the app will not boot without it.** Signs session cookies and verification tokens: `openssl rand -base64 32`. Rotating it invalidates every live session. |
| `BETTER_AUTH_URL` | The public origin (`https://$DOMAIN`). Required: browser sign-up is refused with "Invalid origin" without it, and callback URLs and trusted origins resolve from it. |
| `GOTENBERG_SERVICE_PASSWORD` | Basic-auth password for the PDF-rendering service (ADR-009). Fails closed like the other services — override the local default. |
| `CHAT_BASE_URL` (+ `CHAT_API_KEY`) | One OpenAI-compatible endpoint. Model IDs live in `apps/web/config/chat-models.yaml`, not env vars. |
| `OPENAI_API_KEY` | Backs embeddings and other non-chat capabilities. Never used for chat. |
| `GOOGLE_AI_API_KEY` | Cloud transcription defaults to Gemini. Alternatively set `TRANSCRIPTION_API_BASE_URL` + `TRANSCRIPTION_API_KEY` to any OpenAI-compatible endpoint. |

**Lean-stack specifics:**

```bash
OCR_DEFAULT_PROVIDER=AZURE
AZURE_DOC_INTELLIGENCE_ENDPOINT=https://<name>.cognitiveservices.azure.com/
AZURE_DOC_INTELLIGENCE_KEY=<key>          # az cognitiveservices account keys list
# Optional, see "OCR: Azure Document Intelligence" below:
# OCR_PDF_STRATEGY=provider-first           # every PDF through Azure (default: text layer first)
# AZURE_DOC_INTELLIGENCE_MODEL=prebuilt-read  # text-only, ~1/7 the price (default: prebuilt-layout)

# SSRF allowlists must include the public files origin, or the document
# services refuse to fetch objects by reference.
CONVERTER_ALLOWED_FETCH_ORIGINS=http://app:3000,http://seaweedfs:8333,https://files.$DOMAIN
ADEU_ALLOWED_FETCH_ORIGINS=http://app:3000,http://seaweedfs:8333,https://files.$DOMAIN

DEPLOYMENT_MODE=self-hosted

# Optional: in-app bug reports and feature requests. Off until someone triages.
# FEEDBACK_ADMIN_EMAILS=you@example.com
# FEEDBACK_WEBHOOK_URL=https://hooks.slack.com/services/…   # one line per new report
```

**Inngest runs on the VM.** The two Inngest keys above drive a self-hosted
Inngest server that the overlay starts next to the worker; it runs the
background jobs (Drive and Gmail sync, brand publishing, Prospects and
Proposals runs, the founder weekly review, reindex, crawls). Document
**ingestion does not use it** — that runs through the Postgres transactional
outbox (ADR-003). Nothing is registered by hand and nothing outside the VM
calls the worker. Details, checks and rollback:
[Background jobs](#background-jobs-self-hosted-inngest).

With the event key but no signing key, events are accepted and **nothing ever
runs**: production ran that way until 2026-10-17, and Drive sat at "Not synced
yet". Caddyfile changes need the Caddy container recreated (or at least
restarted), not `caddy reload`: the file is a single-file bind mount, and a
`git pull` that rewrites it swaps the inode, so the container keeps reading
the old one.

---

## Step 4 — Point DNS at the VM

Using `sslip.io`, there is nothing to do: `<ip>.sslip.io` and
`files.<ip>.sslip.io` already resolve.

For your own domain, create two **A records** at your registrar:

| Type | Name | Value |
|---|---|---|
| A | `app` | `<PUBLIC_IP>` |
| A | `files.app` | `<PUBLIC_IP>` |

Behind Cloudflare, set both to **DNS only** (grey cloud). Proxied records break
the HTTP-01 challenge Caddy uses. Verify before continuing — certificate
issuance will fail otherwise:

```bash
dig +short app.example.com files.app.example.com   # both must print the IP
```

---

## Step 5 — Start it

```bash
cd ~/LaunchStack
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env up -d
```

Order is handled for you: Postgres becomes healthy, the one-shot `migrate`
service applies the ordered SQL migrations and exits, then the app and worker
start. **Nothing applies schema on container boot** — migrations only ever run
through that service.

Caddy then obtains Let's Encrypt certificates for both hostnames, usually within
30 seconds of first start.

---

## Step 6 — Verify

```bash
# From anywhere — expect a 307 to /signin and a valid certificate
curl -sS -o /dev/null -w "%{http_code} %{ssl_verify_result}\n" https://$DOMAIN/

# On the VM — every service up, migrate exited 0
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env ps -a
docker exec pdr_ai_v2-worker wget -qO- http://localhost:8020/healthz    # {"status":"ok"}

# Background jobs — the worker's functions are synced and connected
curl -s -X POST http://127.0.0.1:8288/v0/gql -H 'content-type: application/json' \
  -d '{"query":"{ apps { name url error connected functionCount } }"}'
```

The last command should print `"name":"pdr-ai"`, `"url":"http://worker:8020/api/inngest"`,
`"connected":true` and `"error":null` within a minute of the worker becoming
healthy. More checks are in [Background jobs](#background-jobs-self-hosted-inngest).

Then in a browser:

1. Open `https://$DOMAIN` — you should get the sign-in page with a padlock.
2. **Sign up immediately.** The first account to register becomes the workspace
   owner, already verified, with no approval step. Do this before sharing the
   URL.
3. Upload a small PDF at `/employer/upload`. The returned URL should be
   `https://files.$DOMAIN/<bucket>/documents/…` and should download when opened.
4. If the upload is processed rather than just stored, the whole chain — app,
   outbox, worker, storage, OCR — is confirmed.

---

## Deploying updates

Images publish to GHCR on every push to `main`.

```bash
ssh <ADMIN_USER>@<PUBLIC_IP> 'cd LaunchStack && git pull && \
  docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env pull app worker && \
  docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env up -d --build'
```

`--build` rebuilds `migrate` (so new migrations apply) and the two Python
services when their sources changed. After changing `.env`, add
`--force-recreate app worker` — Compose does not restart containers for env
changes on its own.

---

## Secrets: Azure Key Vault

`.env` on the VM is a **derived artifact**. The source of record is Key Vault
`<VAULT_NAME>`, which holds 29 secrets (empty-valued variables are not
stored — Key Vault rejects empty values, and Compose treats absent and empty
identically through its `${VAR:-}` defaults).

Nothing in the application changed for this. Compose cannot read Key Vault and
the app reads plain environment variables, so rather than touch application
code, a script regenerates the `.env` Compose already consumes.

**No credential is stored on the VM.** The VM has a system-assigned managed
identity (`<VM_PRINCIPAL_ID>`) holding exactly one role on
the vault — `Key Vault Secrets User`, read-only. The token comes from IMDS
(`169.254.169.254`), which only answers processes on that machine. Writes are
refused with HTTP 403; the seeding step used a temporary
`Key Vault Secrets Officer` grant that has since been revoked.

Regenerate `.env` before bringing the stack up:

```bash
python3 ~/sync-env-from-keyvault.py <VAULT_NAME>
```

It writes atomically via a temp file, saves the previous copy as `.env.bak`,
chmods 600, and **fails without touching the existing file** if the vault is
unreachable — a stale `.env` still boots the stack, a truncated one does not.

Note that running containers do **not** re-read `.env`; Compose bakes the
environment in at container creation. So syncing matters immediately before a
`docker compose up`, not on reboot.

To change a secret, set the new value in Key Vault, re-run the sync, and
recreate the affected services:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env \
  up -d --force-recreate app worker
```

Key Vault secret names allow `[0-9a-zA-Z-]` only, so `FOO_BAR` is stored as
`FOO-BAR` and mapped back on read. Environment variable names cannot contain
dashes, so the reverse mapping is unambiguous.

## OCR: Azure Document Intelligence

Three settings decide how documents are read. All three are plain `.env`
values (stored in Key Vault like the rest, see
[Secrets](#secrets-azure-key-vault)); none is a default baked into the
repository, so a self-hosted install keeps the free text-layer path unless
its operator opts in.

| Variable | Values | Effect |
|---|---|---|
| `OCR_DEFAULT_PROVIDER` | `AZURE` (lean stack), `DOCLING`, `LANDING_AI`, `DATALAB`, `NATIVE_PDF` | Which OCR service reads documents that need OCR. |
| `OCR_PDF_STRATEGY` | `text-layer-first` (default), `provider-first` | `text-layer-first` reads a PDF's own text when it has one, free and in seconds, and sends only scans to OCR. `provider-first` sends **every** PDF to the provider. |
| `AZURE_DOC_INTELLIGENCE_MODEL` | `prebuilt-layout` (default), `prebuilt-read` | Layout adds tables and reading order. Read is text only and costs about a seventh as much. |

Choose `provider-first` when documents carry tables or multi-column layouts,
or scanned pages inside otherwise digital PDFs, that a text layer reads
poorly. Each PDF then costs Azure pages and takes a minute or two instead of
seconds.

**Fallback (`provider-first`).** If Azure fails, the worker reads the PDF's own text layer
instead (`NATIVE_PDF`), so the document still indexes. A scanned PDF has no
text layer, so for a scan the Azure error stands and the outbox retries it
(see [`docs/runbooks/outbox.md`](./outbox.md)). The worker logs
`[Normalize] AZURE failed, reading the PDF's text layer instead: …` whenever it
falls back.

**Before falling back, the adapter retries.** A 429 or 5xx on submit is retried
up to four times, waiting as long as Azure's `Retry-After` asks (otherwise 2, 5,
13, then 34 s). Result polling never runs more often than every 2 s and keeps
going through 429s, 5xx, and network errors, because giving up would make the
outbox resubmit and Azure bills every submission. One analysis may run for up
to 15 minutes before it is abandoned.

**Limits (S0, per resource).** Microsoft's published quotas:

| Quota | S0 | F0 (don't use) |
|---|---|---|
| Analyze (submit) requests | 15 per second, can be raised by support request | 1 per second |
| Result polls | 50 per second, can be raised | 1 per second |
| Max file size | 500 MB | 4 MB |
| Pages analyzed per document | 2,000 | 2 |

The worker submits one document at a time per outbox slot (at most 10 at
once), so it cannot reach 15 submits per second. Azure reads at most 2,000
pages per request, so the adapter sends a longer PDF as consecutive page
ranges (`1-2000`, `2001-4000`, …) side by side and joins the pages back in
order; each range is billed only for its own pages. The 500 MB limit still
applies to the whole file, because every range uploads it.

**Cost.** Billed per page analyzed, pay-as-you-go, no monthly minimum:

| Model | Per 1,000 pages | A 260-page book |
|---|---|---|
| `prebuilt-layout` | $10 | ≈ $2.60 |
| `prebuilt-read` | $1.50 | ≈ $0.39 |

Usage is under the resource's **Metrics** blade in the portal ("Processed
Pages").

**Changing a setting.** Store it in Key Vault (`OCR-PDF-STRATEGY`,
`AZURE-DOC-INTELLIGENCE-MODEL`), re-sync `.env`, and recreate app and worker.
New uploads use it; documents already indexed keep the text they were read
with until they are re-uploaded.

```bash
# Which provider read recent documents (NATIVE_PDF = text layer, AZURE = OCR)
docker exec pdr_ai_v2-postgres psql -U postgres -d pdr_ai_v2 -c \
  "SELECT created_at::date, payload->'payload'->>'provider' AS provider, count(*),
          sum((payload->'payload'->>'pageCount')::int) AS pages
   FROM pdr_ai_v2_event_outbox WHERE event_type = 'evidence.version.extracted'
   GROUP BY 1, 2 ORDER BY 1 DESC LIMIT 20"
```

---

## Connecting Notion

Members connect Notion from **Add source › Notion**: one click, Notion's own
consent screen (with Notion's page picker), and the picked pages sync into
`Notion/<workspace>` every 15 minutes. For that button to work, the
deployment needs one **public** Notion connection. This is a one-time setup.
Design notes: [`docs/design/notion-connector.md`](../design/notion-connector.md).

1. **Create the connection.** At
   [notion.so/profile/integrations](https://www.notion.so/profile/integrations),
   create a new connection of type **Public**.
   - **Redirect URI:** `<BETTER_AUTH_URL>/api/connectors/notion/oauth/callback`,
     for example `https://app.example.com/api/connectors/notion/oauth/callback`.
     It must match the public origin exactly, scheme and host included.
   - **Capabilities:** *Read content* only. Leave insert and update content
     off; the connector never writes to Notion. User information is not
     needed.
   - **Installation scope:** *Any workspace* for customers' workspaces;
     *Selected workspaces* if only your own will connect. Notion does not let
     you change this later.
   - **Company details:** name, website, and the privacy policy and terms
     URLs (the landing site's `/privacy` and `/terms`).
   - Notion shows the **authorization URL only after a public connection is
     submitted for review.** If it is not shown yet, submit it and wait for
     approval before going further; nobody can connect until then.

2. **Store the pair in Key Vault**, from your own `az login` (the VM's
   identity is read-only):

   ```bash
   az keyvault secret set --vault-name <VAULT_NAME> --name NOTION-OAUTH-CLIENT-ID --value '<client id>'
   az keyvault secret set --vault-name <VAULT_NAME> --name NOTION-OAUTH-CLIENT-SECRET --value '<client secret>'
   ```

3. **Deploy and load it on the VM.** The code ships in the images, and the
   `notion_connector` migration applies through the one-shot `migrate`
   service as usual:

   ```bash
   cd LaunchStack && git pull
   python3 ~/sync-env-from-keyvault.py <VAULT_NAME>
   grep -c -E '^NOTION_OAUTH_CLIENT_(ID|SECRET)=.+' .env      # 2
   C="docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env"
   $C pull app worker && $C up -d --build --force-recreate app worker
   ```

   Both containers need the pair: the app runs the OAuth handshake, and the
   worker refreshes tokens during a sync. `docker-compose.yml` passes them
   through its `x-shared-env` allowlist.

4. **Check it.**
   - Add source › Notion shows **Connect Notion**. If it says "not configured
     on this server", the container did not get the pair; re-check step 3.
   - Connect, pick a page, and approve. You land back on the Notion tab with
     "Notion connected", and the workspace card moves from "Starting sync…"
     to a page count within a minute.
   - `$C logs worker | grep notion-sync` shows the run, and the page appears
     under `Notion/<workspace>` in Sources.
   - Disconnecting the card removes it and revokes the token at Notion.

**If it goes wrong:**

| Symptom | Fix |
| --- | --- |
| Notion says the redirect URI is invalid | The registered URI and `BETTER_AUTH_URL` differ (scheme, host, trailing path). |
| "The sync was requested … still hasn't started" | The worker or Inngest is down; see [Background jobs](#background-jobs-self-hosted-inngest). |
| Card says access was revoked | The member removed LaunchStack in Notion, or the grant expired. **Reconnect** on the card. |
| Some pages are missing | Only pages shared with the connection sync. **Choose pages** on the card reopens Notion's picker. |

Obsidian needs no setup: **Add source › Obsidian** imports a vault in the
browser, and nothing leaves the deployment.

## Backups and restore

`/home/<ADMIN_USER>/backup-db.sh` runs nightly at **03:10 UTC** via cron: it
pipes `pg_dump` of `pdr_ai_v2` through gzip into the `db-backups` container
using a **write-only SAS token** (valid ~2 years — rotate before mid-2028). A
storage lifecycle policy deletes blobs after 30 days. Check `~/backup.log`.

Restore:

```bash
az storage blob download --account-name <acct> -c db-backups \
  -n launchstack-db-<DATE>.sql.gz -f - | gunzip | \
  docker exec -i pdr_ai_v2-postgres psql -U postgres pdr_ai_v2
```

**Scope caveat:** this backs up Postgres only. Uploaded source files live in
SeaweedFS on the VM disk and are **not** included — extracted evidence and all
application data survive a restore, but original uploads would not. Acceptable
early on; revisit when originals become irreplaceable.

**Inngest's database.** The script dumps `pdr_ai_v2` only; the Inngest server
keeps its synced app list and run history in a second database, `inngest`, on
the same Postgres. Add a second dump to `backup-db.sh`: copy its `pg_dump`
line, change the database to `inngest`, and name the blob
`inngest-db-<DATE>.sql.gz` (same container, same SAS token):

```bash
docker exec pdr_ai_v2-postgres pg_dump -U postgres inngest | gzip | <the same upload step>
```

Restore it the same way into `inngest` (start the stack once first so
`inngest-db-init` has created the empty database, then stop `inngest` while
you load it). Losing it is not fatal: the server re-syncs the worker's
functions on its own and only the run history is gone. What it cannot bring
back is work that was queued at the moment of loss; that lives in Redis (next
section).

---

## Background jobs (self-hosted Inngest)

The worker's background functions run on an Inngest server on the VM, not on
Inngest Cloud. Until 2026-10-17 production had no signing key and the worker
rejected every call (`Signature validation failed ... No signing key found`),
so Drive and Gmail sync, brand publishing, Prospects/Proposals runs and the
weekly review never ran.

```
            events (INNGEST_EVENT_KEY)
  app ──────────────────────────────────┐
                                        ▼
  worker ── events, function sync ──▶ inngest:8288 ──▶ inngest-redis:6379   queue + in-flight run state
    ▲                                   │   │
    └─ signed calls (INNGEST_SIGNING_KEY)┘   └──────▶ db:5432, database `inngest`   apps, functions, history

  The dashboard listens on 127.0.0.1:8288 on the VM only (SSH tunnel).
```

Commands below use the stack's usual prefix:

```bash
C="docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env"
```

| Service (container) | What it is | Memory |
|---|---|---|
| `inngest` (`pdr_ai_v2-inngest-server`) | `inngest start` from `inngest/inngest:v1.46.0` — the production server, not the dev server. Event API, executor and dashboard on port 8288. | limit 512 MB; ~65 MB observed |
| `inngest-redis` (`pdr_ai_v2-inngest-redis`) | `redis:7.4.11-alpine`, append-only file fsynced every second, `noeviction`. Holds the queue and in-flight run state. | limit 256 MB (Redis capped at 192 MB); ~7 MB observed |
| `inngest` database on `db` | Synced apps and functions, events, run history. Pool capped at 10 connections (2 idle). | grows with runs — pruned daily, below |
| `inngest-db-init` | One-shot: creates the `inngest` database if it is missing, then exits 0. | — |

How it fits together:

- **Keys.** The server accepts events only with `INNGEST_EVENT_KEY` and signs
  every request to the worker with `INNGEST_SIGNING_KEY`; app and worker read
  the same two values, in signed mode (`INNGEST_DEV` empty,
  `INNGEST_BASE_URL=http://inngest:8288`). A request with any other key gets
  a 401.
- **Registration is automatic.** The server syncs
  `http://worker:8020/api/inngest` at boot and re-checks every 60 seconds, so
  new or changed functions in a worker redeploy are live within a minute. There
  is nothing to register by hand, and Caddy no longer routes `/api/inngest`.
- **Isolation.** The server and its Redis sit on their own Docker network
  (`inngest`) shared only with `app`, `worker` and `db`. Gotenberg and the
  document services, which fetch user-supplied URLs, cannot resolve it.
- **The dashboard has no login.** It binds to `127.0.0.1:8288` on the VM only.
  Anyone who can reach it can read event payloads and replay or cancel runs,
  so never route it through Caddy or open 8288 in the NSG.
- **No telemetry.** `DO_NOT_TRACK=1` on the service stops the usage events the
  CLI otherwise posts to Inngest's cloud event API (`cli/command.executed` at
  every start, `cli/dev_ui.loaded` on each dashboard load). With it set,
  nothing the server does reaches Inngest. The privacy policy relies on this:
  it lists no Inngest processing.

### Cutting the live VM over (from the interim server)

Since 2026-10-17 the VM has run an interim `inngest` service: first as
**local, uncommitted edits** to `docker-compose.prod.yml`, `docker-compose.yml`
(the Gotenberg deny-list) and `docker/Caddyfile.prod`, then the same design
merged to main as PR #487. Same service name and container
(`pdr_ai_v2-inngest-server`), SQLite plus the built-in Redis on the
`launchstack_inngest_data` volume. This deploy replaces it in place. Its SQLite history and anything queued in it are dropped; the crons
start again on the new server within a minute.

**Reuse the keys already in Key Vault.** `INNGEST-EVENT-KEY` and
`INNGEST-SIGNING-KEY` were set for the interim server and `.env` already has
them. Do not generate new ones: the running app and worker hold the current
values, and new keys would put them out of step with the server.

1. **Dump the database first** — the usual cut-over safety net:

   ```bash
   docker exec pdr_ai_v2-postgres pg_dump -U postgres pdr_ai_v2 | gzip > ~/pre-inngest-$(date +%Y%m%d).sql.gz
   ```

2. **Set the local edits aside, keep a copy, and pull:**

   ```bash
   cd ~/LaunchStack
   git status --short                                  # the three files above, or nothing
   cp docker-compose.prod.yml ~/docker-compose.prod.yml.interim-inngest
   git stash push -m "interim inngest $(date +%F)" -- docker-compose.prod.yml docker-compose.yml docker/Caddyfile.prod
   git pull
   ```

   If `git status` shows nothing, the VM is already on PR #487's committed
   version: skip the `git stash` line (keep the `cp`, it is the rollback copy).

   The stashed `docker-compose.yml` edit adds `inngest` to Gotenberg's
   deny-list. If it has not been committed by then, losing it is harmless:
   Gotenberg is not on the `inngest` network and cannot resolve the name.

3. **Check the keys are still in `.env`** (re-run the Key Vault sync if in
   doubt — it writes the same values):

   ```bash
   grep -c -E '^INNGEST_(EVENT|SIGNING)_KEY=.+' .env      # 2
   ```

4. **Bring it up.** Compose recreates `inngest` with the new definition (same
   container name, so there is no clash), creates `inngest-db-init` and
   `inngest-redis`, and recreates `app`, `worker` and `db`, which join the
   `inngest` network. **Postgres restarts once** (seconds); app, worker and
   SeaweedFS reconnect on their own. Caddy needs the explicit recreate:
   `git pull` replaced the Caddyfile, and a single-file bind mount keeps
   showing a running container the old file.

   ```bash
   $C up -d
   $C up -d --force-recreate caddy
   ```

5. Run [Checking it works](#checking-it-works). The `url` must be
   `http://worker:8020/api/inngest` and the log must say
   `using external redis`, not an in-memory one.

6. Once it has run cleanly for a day, delete the interim volume and the
   stash: `docker volume rm launchstack_inngest_data`, then
   `git stash list` and `git stash drop stash@{N}` for the "interim inngest"
   entry.

To go back to the interim server: `$C rm -sf inngest inngest-redis inngest-db-init`,
`cp ~/docker-compose.prod.yml.interim-inngest docker-compose.prod.yml`, then
`$C up -d` (its volume is still there until step 6).

### Turning it on (fresh install)

1. **Generate the keys into Key Vault** from a machine whose Azure identity
   can write secrets (the VM's identity is read-only):

   ```bash
   az keyvault secret set --vault-name <VAULT_NAME> -n INNGEST-EVENT-KEY   --value "$(openssl rand -hex 32)" -o none
   az keyvault secret set --vault-name <VAULT_NAME> -n INNGEST-SIGNING-KEY --value "$(openssl rand -hex 32)" -o none
   ```

2. **On the VM**, regenerate `.env` and start the stack as in Step 5:

   ```bash
   python3 ~/sync-env-from-keyvault.py <VAULT_NAME>
   grep -c -E '^INNGEST_(EVENT|SIGNING)_KEY=.+' .env      # 2
   $C up -d
   ```

### Checking it works

```bash
# inngest + inngest-redis healthy, inngest-db-init exited 0
$C ps -a inngest inngest-redis inngest-db-init

# Boot log: Postgres + external Redis in use
docker logs pdr_ai_v2-inngest-server 2>&1 | grep -E 'ran database migrations|using external redis|starting server'

# The worker's functions are synced (expect pdr-ai, http://worker:8020/api/inngest, connected, error null)
curl -s -X POST http://127.0.0.1:8288/v0/gql -H 'content-type: application/json' \
  -d '{"query":"{ apps { name url error connected functionCount } }"}'

# Runs are executing: brand publishing alone runs every minute
docker exec pdr_ai_v2-postgres psql -U postgres -d inngest -c "
  SELECT f.slug, ff.status, r.run_started_at
  FROM function_runs r JOIN functions f ON f.id = r.function_id
  LEFT JOIN function_finishes ff ON ff.run_id = r.run_id
  ORDER BY r.run_started_at DESC LIMIT 10"

# The worker no longer rejects calls
docker logs pdr_ai_v2-worker --since 10m 2>&1 | grep -c 'Signature validation failed'   # 0
```

For one specific event, the REST API takes the signing key as a bearer token:
`curl -s -H "Authorization: Bearer $INNGEST_SIGNING_KEY" http://127.0.0.1:8288/v1/events/<event-id>/runs`
returns each run's `status` (`Completed`, `Failed`, …) and `output`. Finally,
press **Sync now** on the Drive connection in the app and watch the
`pdr-ai-google-drive-sync` run appear.

### The dashboard

```bash
ssh -N -L 8288:127.0.0.1:8288 <ADMIN_USER>@<PUBLIC_IP>
# then open http://localhost:8288 on your machine
```

### History retention

`inngest start` never deletes old events, runs or traces from Postgres. The
crons alone start about 62,000 runs a month (brand publishing every minute,
the weekly-review reconciler every 5, Drive and Gmail every 15, repo polls
every 30), plus one Drive run per connection every 15 minutes. Each run
leaves roughly 30 KB of history (measured on the pinned version), so an
unpruned database grows by about 2 GB a month — on a disk with ~13 GB free.
`docker/inngest-retention.sql` keeps the last 7 days (a few hundred MB);
schedule it daily on the VM after the backup (`crontab -e`):

```cron
40 3 * * * docker exec -i pdr_ai_v2-postgres psql -U postgres -d inngest -v days=7 < /home/<ADMIN_USER>/LaunchStack/docker/inngest-retention.sql >> /home/<ADMIN_USER>/inngest-retention.log 2>&1
```

Check the size now and then:
`docker exec pdr_ai_v2-postgres psql -U postgres -tAc "SELECT pg_size_pretty(pg_database_size('inngest'))"`.
The script only touches history tables; when you bump the Inngest image,
re-check its table list against the new schema.

### Upgrading Inngest

Bump the tag in `docker-compose.prod.yml` after reading the release notes
(<https://github.com/inngest/inngest/releases>), then
`$C pull inngest && $C up -d inngest`. The server migrates its own database
on boot (`ran database migrations` in the log); take a dump of `inngest`
first.

### Rotating the signing key

Set a new `INNGEST-SIGNING-KEY` in Key Vault, re-run the sync, then
`$C up -d --force-recreate inngest app worker` together. Steps in flight
during the swap fail their signature check and are retried.

### Rollback

To stop background jobs but keep everything else running:
`$C stop inngest`. The app keeps working and ingestion is unaffected, but
event sends (Sync now, Prospects runs, …) fail and none of the jobs above
run until you `$C start inngest` again.

To remove it entirely, take the containers down **before** reverting the
files (afterwards Compose no longer knows about them), then restore the
previous overlay and Caddyfile:

```bash
$C rm -sf inngest inngest-redis inngest-db-init
git checkout <previous-commit> -- docker-compose.prod.yml docker/Caddyfile.prod
$C up -d --force-recreate app worker caddy
```

The `inngest` database and the `launchstack_inngest_redis_data` volume are
kept. Drop them only once you are sure:
`docker exec pdr_ai_v2-postgres psql -U postgres -c 'DROP DATABASE inngest'`
and `docker volume rm launchstack_inngest_redis_data`.

### Using Inngest Cloud instead

Possible, but not what this overlay is set up for, and not tested. You would:
put the Cloud environment's event key and signing key (`signkey-prod-…`) in
Key Vault; add a VM-local overlay that turns the self-hosted services off and
points the SDK back at Cloud —

```yaml
# docker-compose.inngest-cloud.yml (VM-local, add as a third -f)
services:
  app:
    environment:
      INNGEST_BASE_URL: ""
  worker:
    environment:
      INNGEST_BASE_URL: ""
      INNGEST_SERVE_HOST: https://${DOMAIN}
  inngest: { profiles: ["inngest-self-hosted"] }
  inngest-redis: { profiles: ["inngest-self-hosted"] }
  inngest-db-init: { profiles: ["inngest-self-hosted"] }
```

— put back a `handle /api/inngest* { reverse_proxy worker:8020 }` block in
`docker/Caddyfile.prod`, and register `https://$DOMAIN/api/inngest` in the
Inngest Cloud dashboard. Inngest then receives every event payload and step
result, so add it back to the provider table in
`apps/landing/src/app/privacy/page.tsx` (and bump `PRIVACY_UPDATED`) before
you switch.

---

## Moving to your own domain

1. Create the two A records (Step 4) and confirm with `dig`.
2. On the VM, rewrite the hostname everywhere it appears:

   ```bash
   cd ~/LaunchStack
   sed -i "s/<PUBLIC_IP>.sslip.io/app.example.com/g" .env
   docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env up -d \
     --force-recreate app worker caddy
   ```

   That one substitution covers `DOMAIN`, the public S3 endpoint, and both SSRF
   allowlists.
3. Update `BETTER_AUTH_URL` to the new origin in the same pass — it is one of
   the values the substitution above rewrites.

Objects already stored keep URLs on the old hostname. Keep the old DNS record
alive, or rewrite `document_versions.url` if you migrate before real traffic.

---

## Scaling up later

- **Whisper back on-box:** `--profile whisper` plus
  `TRANSCRIPTION_PROVIDER=sidecar`. Budget ~1.5 GB.
- **Docling back on-box:** `--profile ocr` plus `OCR_DEFAULT_PROVIDER=DOCLING`
  and `DOCLING_SERVE_URL=http://docling-serve:5001`. Budget ~1.2 GB. Without
  Docling (the lean default, `DOCLING_SERVE_URL` empty), complex PDFs go to the
  OCR provider and the worker converts Word, PowerPoint, and Excel files itself
  with mammoth/SheetJS. Before this was the default, the converter pointed at a
  `docling-serve` that was not running, and every Office upload failed with
  `docling-serve request failed: fetch failed`.
- Either one needs a bigger VM first: stop it, `az vm resize -g <RESOURCE_GROUP>
  -n <VM_NAME> --size Standard_D4as_v7` (16 GB), start it.
- **Document Intelligence** on F0 (only an older install would still be on it)
  analyzes two pages per document. Upgrade in place:
  `az cognitiveservices account update -n <DOCINTEL_NAME> -g <RESOURCE_GROUP> --sku S0`.
  On S0, a sustained burst of 429s means the 15-per-second submit limit; raise
  it with a support request ("Quota or usage validation").
- **Managed Postgres** (Azure Flexible Server, ~$15/mo and up) is the first
  upgrade worth buying once you have users whose data you cannot lose — it
  brings real backups and point-in-time restore.

---

## Troubleshooting

### SeaweedFS won't start (`failed SASL auth`)

SeaweedFS keeps its filer metadata in Postgres, and `docker/filer.toml` is
mounted read-only, so its `password` line can only ever hold the local default.
The real credential comes from `WEED_POSTGRES_PASSWORD`, which
`docker-compose.yml` sets from `POSTGRES_PASSWORD` (SeaweedFS overlays any
`filer.toml` key from `WEED_<SECTION>_<KEY>`). Without it, **every deployment
using a real password** crash-loops here and object storage never comes up,
while the rest of the stack looks healthy — the visible symptom is a 502 from
`files.$DOMAIN`.

If you hit it, confirm the filer's database survived (it is created by
`docker/init-db.sql` on first initialisation only):

```bash
docker exec pdr_ai_v2-postgres psql -U postgres -tAc \
  "SELECT datname FROM pg_database WHERE datname='seaweedfs'"
docker exec pdr_ai_v2-postgres psql -U postgres -d seaweedfs -tAc \
  "SELECT tablename FROM pg_tables WHERE tablename='filemeta'"
```

Both must return a row. If they do not, the volume was initialised before
`init-db.sql` existed — create them by hand from that file rather than wiping
the volume.

### Certificates aren't issued

`docker logs pdr_ai_v2-caddy --tail 30`. Nearly always DNS: the record does not
resolve yet, or it is proxied through Cloudflare. Caddy retries on its own once
DNS is correct.

### Uploads accepted but never processed

Ingestion is the worker's job, not the app's. Check
`docker exec pdr_ai_v2-worker wget -qO- http://localhost:8020/healthz` and see
[`docs/runbooks/outbox.md`](./outbox.md) for inspecting and replaying outbox
rows.

### `Cannot load "@napi-rs/canvas"` in the app log

Benign. pdf.js looks for an optional native canvas for server-side rendering;
the same warnings appear in local development.

### Transcription or OCR returns "API key not configured"

Base URL and key are read as a **pair** at every level. Forwarding a model name
or a lone key is not enough — without its base URL, a capability falls through
to that error at call time.

---

## Cost

| Item | Monthly |
|---|---|
| VM (D2as_v7, pay-as-you-go) | ~$62–70 |
| Managed disk (64 GB StandardSSD) | ~$5 |
| Static public IP | ~$4 |
| Backup storage (Cool, small) | ~$1 |
| Document Intelligence S0 | per page OCR'd: $10 per 1,000 (layout) or $1.50 per 1,000 (read) |
| **Total** | **~$72 + OCR pages** |

After a month of stable running, a 1-year reservation or savings plan takes the
VM down by roughly a third (~$51/mo all-in). Microsoft for Startups Founders Hub
grants $1,000 in Azure credits at the entry tier with no funding requirement —
enough to cover this for over a year.

---

## Relationship to Vercel

`apps/landing` (the marketing site) is a separate application with no deploy
pipeline in this repo, and it is deliberately **not** part of a self-hosted
deployment. Keeping it on Vercel is the intended split:

- `example.com` → landing site on Vercel
- `app.example.com` → this stack on the Azure VM

Point the landing site's sign-in links at the app with `NEXT_PUBLIC_APP_URL`,
and set `LANDING_PUBLIC_URL` on the app to the landing origin (a runtime
variable, so the CI-built image picks it up; `NEXT_PUBLIC_SITE_URL` would
need a rebuild). On a self-hosted instance `/` redirects to `/signin`, so the app never tries to serve
marketing pages itself.

Running `apps/web` **on** Vercel is a different architecture, not a config flag:
Postgres, the S3 endpoint, and all three compute services would have to be
publicly exposed over TLS with connection pooling in front of the database. The
lean VM stack exists to avoid exactly that.
