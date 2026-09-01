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

## Current live instance

| | |
|---|---|
| **URL** | https://20.110.112.248.sslip.io |
| **Files origin** | https://files.20.110.112.248.sslip.io |
| Resource group | `launchstack-prod` (subscription "Azure subscription 1") |
| VM | `launchstack-vm` — Standard_D2as_v7 (2 vCPU / 8 GB), Ubuntu 24.04, eastus2 |
| Public IP | `20.110.112.248` (static) |
| SSH | `ssh launchstack@20.110.112.248` |
| Open ports | 22, 80, 443 (Azure NSG) |
| Stack location | `/home/launchstack/LaunchStack` |
| OCR | `launchstack-docintel` — Azure Document Intelligence, **F0 free tier (500 pages/month)** |
| Backups | Storage account `lsbackup0fd637`, container `db-backups`, 30-day retention |

`*.sslip.io` is wildcard DNS that resolves any `<ip>.sslip.io` name to that IP —
it gives a real, publicly valid HTTPS hostname with no registrar. Swapping in
your own domain is a two-minute change; see
[Moving to your own domain](#moving-to-your-own-domain).

---

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
az group create -n launchstack-prod -l eastus2

az vm create \
  -g launchstack-prod -n launchstack-vm -l eastus2 \
  --image Ubuntu2404 --size Standard_D2as_v7 \
  --os-disk-size-gb 64 --storage-sku StandardSSD_LRS \
  --public-ip-sku Standard --public-ip-address-allocation static \
  --admin-username launchstack --generate-ssh-keys \
  --custom-data cloud-init.yaml

az vm open-port -g launchstack-prod -n launchstack-vm --port 80,443 --priority 900
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

Then provision OCR (free tier) and the backup storage account:

```bash
az provider register --namespace Microsoft.CognitiveServices   # once per subscription

az cognitiveservices account create \
  -n launchstack-docintel -g launchstack-prod \
  --kind FormRecognizer --sku F0 -l eastus2 --yes

az storage account create -n <unique-name> -g launchstack-prod -l eastus2 \
  --sku Standard_LRS --kind StorageV2 --access-tier Cool --allow-blob-public-access false
az storage container create -n db-backups --account-name <unique-name>
```

---

## Step 2 — Install the stack on the VM

```bash
ssh launchstack@<PUBLIC_IP>
git clone --depth 1 https://github.com/Deodat-Lawson/LaunchStack.git
```

Copy `docker-compose.prod.yml` and `docker/Caddyfile.prod` up if you are ahead
of what is committed on `main`.

---

## Step 3 — Configure `.env`

Create `/home/launchstack/LaunchStack/.env` (mode `600`, never committed).

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

**Required third-party credentials** (the app will not boot without the first
three):

| Variable | Notes |
|---|---|
| `BETTER_AUTH_SECRET` | **Required — the app will not boot without it.** Signs session cookies and verification tokens: `openssl rand -base64 32`. Rotating it invalidates every live session. |
| `BETTER_AUTH_URL` | The public origin (`https://$DOMAIN`). Optional in dev; set it behind a proxy so callback URLs and trusted origins resolve to the outside hostname. |
| `GOTENBERG_SERVICE_PASSWORD` | Basic-auth password for the PDF-rendering service (ADR-009). Fails closed like the other services — override the local default. |
| `CHAT_BASE_URL` (+ `CHAT_API_KEY`) | One OpenAI-compatible endpoint. Model IDs live in `apps/web/config/chat-models.yaml`, not env vars. |
| `OPENAI_API_KEY` | Backs embeddings and other non-chat capabilities. Never used for chat. |
| `GOOGLE_AI_API_KEY` | Cloud transcription defaults to Gemini. Alternatively set `TRANSCRIPTION_API_BASE_URL` + `TRANSCRIPTION_API_KEY` to any OpenAI-compatible endpoint. |

**Lean-stack specifics:**

```bash
OCR_DEFAULT_PROVIDER=AZURE
AZURE_DOC_INTELLIGENCE_ENDPOINT=https://<name>.cognitiveservices.azure.com/
AZURE_DOC_INTELLIGENCE_KEY=<key>          # az cognitiveservices account keys list

# SSRF allowlists must include the public files origin, or the document
# services refuse to fetch objects by reference.
CONVERTER_ALLOWED_FETCH_ORIGINS=http://app:3000,http://seaweedfs:8333,https://files.$DOMAIN
ADEU_ALLOWED_FETCH_ORIGINS=http://app:3000,http://seaweedfs:8333,https://files.$DOMAIN

DEPLOYMENT_MODE=self-hosted
```

**Optional — Inngest.** `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` enable the
background verticals (trend search, prospector, founder weekly review,
predictive analysis, reindex). Document **ingestion does not need them** — that
runs through the Postgres transactional outbox (ADR-003). Leave them empty and
you get a warning at boot and a working instance. To enable, register the
**worker's** `https://$DOMAIN/api/inngest` in Inngest Cloud; the app no longer
serves that endpoint.

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
```

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
ssh launchstack@<PUBLIC_IP> 'cd LaunchStack && git pull && \
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
`launchstack-kv-a9be20`, which holds 29 secrets (empty-valued variables are not
stored — Key Vault rejects empty values, and Compose treats absent and empty
identically through its `${VAR:-}` defaults).

Nothing in the application changed for this. Compose cannot read Key Vault and
the app reads plain environment variables, so rather than touch application
code, a script regenerates the `.env` Compose already consumes.

**No credential is stored on the VM.** The VM has a system-assigned managed
identity (`55e2e28d-7476-48db-b199-2e8c8b68a8aa`) holding exactly one role on
the vault — `Key Vault Secrets User`, read-only. The token comes from IMDS
(`169.254.169.254`), which only answers processes on that machine. Writes are
refused with HTTP 403; the seeding step used a temporary
`Key Vault Secrets Officer` grant that has since been revoked.

Regenerate `.env` before bringing the stack up:

```bash
python3 ~/sync-env-from-keyvault.py launchstack-kv-a9be20
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

## Backups and restore

`/home/launchstack/backup-db.sh` runs nightly at **03:10 UTC** via cron: it
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

---

## Moving to your own domain

1. Create the two A records (Step 4) and confirm with `dig`.
2. On the VM, rewrite the hostname everywhere it appears:

   ```bash
   cd ~/LaunchStack
   sed -i "s/20.110.112.248.sslip.io/app.example.com/g" .env
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
- **Docling back on-box:** `--profile ocr` plus `OCR_DEFAULT_PROVIDER=DOCLING`.
  Budget ~1.2 GB.
- Either one needs a bigger VM first: stop it, `az vm resize -g launchstack-prod
  -n launchstack-vm --size Standard_D4as_v7` (16 GB), start it.
- **Document Intelligence** F0 caps at 500 pages/month. Upgrade in place:
  `az cognitiveservices account update -n launchstack-docintel -g launchstack-prod --sku S0`.
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
| Document Intelligence F0 | $0 (500 pages/mo) |
| **Total** | **~$72** |

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
and set `NEXT_PUBLIC_SITE_URL` on the app to the landing origin. On a
self-hosted instance `/` redirects to `/signin`, so the app never tries to serve
marketing pages itself.

Running `apps/web` **on** Vercel is a different architecture, not a config flag:
Postgres, the S3 endpoint, and all three compute services would have to be
publicly exposed over TLS with connection pooling in front of the database. The
lean VM stack exists to avoid exactly that.
