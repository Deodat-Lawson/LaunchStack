# Self-hosting Launchstack

Run your own Launchstack on one machine. The only thing the machine needs is
Docker. You do not clone the repository, install Node, or edit a long `.env`
by hand.

```bash
curl -fsSL https://raw.githubusercontent.com/Deodat-Lawson/LaunchStack/main/deploy/install.sh | bash
```

```bash
launchstack setup
```

The installer downloads a small bundle (a Compose file, a few config files and
the `launchstack` command) into `~/.launchstack`. `launchstack setup` asks a
handful of questions, generates every secret, checks the result, pulls the
published images and starts the stack. When it finishes it prints the address
to open. Create your account there; you own the workspace you set up.

> **Sign-up is open.** Anyone who can reach the address can create an account
> and a workspace of their own, which uses your model keys. There is no
> invite-only switch yet. Until there is, keep a private instance on
> `localhost`, a VPN or a firewall allowlist, or cap what each person can
> spend with `AI_MONTHLY_TOKEN_LIMIT_PER_USER`.

- [What you need](#what-you-need)
- [What setup asks](#what-setup-asks)
- [Day-to-day commands](#day-to-day-commands)
- [Updating](#updating)
- [Backup and restore](#backup-and-restore)
- [When something is wrong](#when-something-is-wrong)
- [What runs](#what-runs)
- [Changing settings later](#changing-settings-later)
- [Unattended installs](#unattended-installs)
- [Other ways to deploy](#other-ways-to-deploy)

## What you need

|                      |                                                                                                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Machine              | An x86-64 Linux machine (any distribution that runs Docker). The published images are x86-64 only for now: on ARM servers and Apple-silicon Macs, [run from source](../README.md#run-it-locally) instead. On Windows, use WSL2. |
| Docker               | Docker Engine or Docker Desktop with Compose 2.24 or newer (`docker compose version`). The installer does not install Docker.                                                                                                   |
| Memory               | 4 GB free for the default stack. Add about 1 GB for local OCR (Docling) and about 1 GB for local transcription (Whisper).                                                                                                       |
| Disk                 | 10 GB for images, plus your documents.                                                                                                                                                                                          |
| A chat model         | A Gemini API key, or any OpenAI-compatible endpoint and key (OpenRouter, Azure OpenAI, Ollama, vLLM, …).                                                                                                                        |
| An embeddings model  | A Gemini key, an OpenAI key, or any OpenAI-compatible embeddings endpoint. There is no built-in default: without one, uploads are stored but never become searchable.                                                           |
| For a public address | Ports 80 and 443 open, and either a domain or a public IP (see below).                                                                                                                                                          |

## What setup asks

1. **Where people will reach it.**
   - _This machine only_: plain HTTP on `http://localhost:3000`. Nothing is
     exposed to the network. (Stored files are served from
     `http://files.localhost:8333`, which every browser resolves to the same
     machine.)
   - _A domain you own_: point `your.domain` **and** `files.your.domain` at the
     machine. HTTPS certificates are issued and renewed automatically.
   - _A public IP, no domain_: the wizard uses `<ip>.sslip.io`, a wildcard DNS
     name that resolves to your IP, so you still get real HTTPS.
2. **Chat model**: Gemini, or an OpenAI-compatible endpoint and key. Model
   ids come from a file inside the image that names Gemini models; if your
   endpoint serves other ids, see [Chat models](chat-models.md).
3. **Embeddings**: Gemini, OpenAI, or another OpenAI-compatible endpoint.
   The choice fixes the vector index, so pick the provider you intend to keep.
4. **Optional extras**, one yes/no each: local OCR for scans and Office files,
   local transcription, and keyless web search.

**Choose the address before you add files.** Each stored file is recorded
under the address it was uploaded through. If you later move an instance from
`localhost` to a domain, or from one domain to another, files uploaded before
the move will not open until they are uploaded again. Chats, accounts and
settings are unaffected.

Everything else (database password, signing keys, service-to-service keys) is
generated for you and written to `~/.launchstack/.env`, readable only by your
user. Running `launchstack setup` again changes your answers and keeps the
generated secrets.

## Day-to-day commands

| Command                                        | What it does                                                                            |
| ---------------------------------------------- | --------------------------------------------------------------------------------------- |
| `launchstack status`                           | Which services are up and healthy.                                                      |
| `launchstack logs [service]`                   | Follow logs, for everything or one service.                                             |
| `launchstack start` / `stop` / `restart`       | Start or stop the stack. `stop` removes the containers; data is kept in Docker volumes. |
| `launchstack doctor`                           | Check the configuration and probe every running service. Exits non-zero on any error.   |
| `launchstack update [version]`                 | Back up, move to a newer release, migrate, restart.                                     |
| `launchstack backup [file]`                    | One archive with the database, uploaded files and settings.                             |
| `launchstack restore <file>`                   | Put a backup back.                                                                      |
| `launchstack config show`                      | Current settings, with secrets hidden.                                                  |
| `launchstack config edit`                      | Open the settings file in your editor.                                                  |
| `launchstack config get KEY` / `set KEY=VALUE` | Read or change one setting.                                                             |
| `launchstack version`                          | Installed release.                                                                      |
| `launchstack uninstall`                        | Remove the stack. Data is kept unless you pass `--purge`.                               |

## Updating

```bash
launchstack update
```

This takes a backup (`backups/pre-update-<date>-<time>.tar.gz`), switches to
the latest release, applies database migrations and restarts. If the new
release cannot be pulled, rejects your configuration or does not become
healthy, the previous version is started again. Migrations are not undone;
if the old version cannot run on the migrated database, restore the
pre-update backup. To move to a specific release, pass it:
`launchstack update 2.1.0`. `--no-backup` skips the backup.

Releases are versioned images. An install stays on the version it was set up
with until you run `update`; nothing changes underneath you.

## Backup and restore

```bash
launchstack backup
```

writes `~/.launchstack/backups/launchstack-<date>-<time>.tar.gz` containing a dump of
every database, the uploaded files, and your settings file. The settings file
holds the keys that encrypt stored credentials, so a database dump without it
is not a complete backup. The stack stays up while it runs. The archive
contains every secret of the install: copy it off the machine and keep it
private.

```bash
launchstack restore ~/.launchstack/backups/launchstack-<date>-<time>.tar.gz
```

asks you to confirm (`--yes` skips the question), stops the stack, restores
all three parts and starts again. Restoring onto a new machine is: install,
then `restore` instead of `setup`.

For a nightly backup, add a cron entry:

```
0 2 * * * $HOME/.launchstack/bin/launchstack backup >> $HOME/.launchstack/backups/backup.log 2>&1
```

## When something is wrong

```bash
launchstack doctor
```

`doctor` reads your settings and reports each problem with the setting that
caused it and how to fix it, then probes the running services with the
credentials they were given, so a mismatch between two services is named
rather than showing up later as a failed upload. `setup` and `update` run the
same checks before starting anything.

| Symptom                                 | Likely cause                                                                                                                                                                                                                                        |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Uploads stay "queued"                   | The worker is not running: `launchstack status`, then `launchstack logs worker`.                                                                                                                                                                    |
| Uploads finish but search finds nothing | Embeddings are not configured, or the embeddings key is wrong: `launchstack doctor`.                                                                                                                                                                |
| "Invalid origin" at sign-up             | The address in your browser is not the one setup was given. Run `launchstack setup` and choose the address you actually use.                                                                                                                        |
| Certificate errors on a domain          | DNS for the domain or `files.` subdomain does not point at this machine yet, or ports 80/443 are closed.                                                                                                                                            |
| "port is already allocated" on start    | Another program has the port. Move LaunchStack's: `launchstack config set LAUNCHSTACK_HTTP_PORT=3100` (also `LAUNCHSTACK_FILES_PORT`, default 8333, and `LAUNCHSTACK_INNGEST_PORT`, default 8288), then `launchstack setup` so the address matches. |

## What runs

| Service                                                | Role                                                          |
| ------------------------------------------------------ | ------------------------------------------------------------- |
| `app`                                                  | The web application.                                          |
| `worker`                                               | Processes uploads and runs background jobs. Required.         |
| `db`                                                   | PostgreSQL 16 with pgvector.                                  |
| `seaweedfs`                                            | S3-compatible storage for uploaded files.                     |
| `document-converter`, `adeu-docs-editing`, `gotenberg` | Document parsing, Word editing, PDF rendering.                |
| `inngest`, `inngest-redis`                             | Scheduler for connector sync and other background work.       |
| `caddy`                                                | HTTPS, when you chose a domain or public IP.                  |
| `docling-serve`, `transcription`, `searxng`            | Optional: local OCR, local transcription, keyless web search. |

Self-hosted defaults: no telemetry, no usage gate, no third-party asset
fetches, and sign-in runs on your own instance. Details are in
[Self-hosting defaults](deployment.md#self-hosting-defaults).

## Changing settings later

The wizard writes only what a working instance needs. Everything else the
application supports (sign in with Google, GitHub, Microsoft or your own OIDC
provider; Google Drive, Gmail, Slack, Notion and GitHub connectors; web search
keys; per-person AI limits; email delivery) is turned on by adding its
variables:

```bash
launchstack config edit
```

```bash
launchstack restart
```

The variables are documented in [`.env.example`](../.env.example) and
summarised in the [deployment guide](deployment.md#environment-variables-summary).
`launchstack doctor` tells you when a pair is incomplete.

## Unattended installs

Both steps run without prompts, for cloud-init or configuration management:

```bash
curl -fsSL https://raw.githubusercontent.com/Deodat-Lawson/LaunchStack/main/deploy/install.sh | LAUNCHSTACK_VERSION=<version> bash
```

```bash
launchstack setup --non-interactive
```

In non-interactive mode each answer comes from a `LAUNCHSTACK_SETUP_*`
environment variable; `launchstack setup --help` lists them. Without
`LAUNCHSTACK_VERSION` the installer takes the latest release, or the main
branch (`edge`) when no release carries a bundle yet.

### Machines without internet access

Download `launchstack-self-host.tar.gz` and `install.sh` from the release
page, `docker save` the images on a connected machine and `docker load` them
on the target, then:

```bash
LAUNCHSTACK_BUNDLE=./launchstack-self-host.tar.gz bash install.sh
```

```bash
LAUNCHSTACK_PULL_POLICY=missing launchstack setup
```

`LAUNCHSTACK_PULL_POLICY=missing` pulls only images that are not already on
the machine. `launchstack update` accepts the same two variables.

### Serving a LAN without a domain

```bash
launchstack config set LAUNCHSTACK_BIND=0.0.0.0
```

```bash
launchstack setup
```

Choose "this machine only"; setup then asks for the name or IP other machines
use for this one (`LAUNCHSTACK_SETUP_BIND` and `LAUNCHSTACK_SETUP_LAN_HOST`
when unattended). This is plain HTTP: use it on a network you trust.

## Other ways to deploy

- **From source**, for development or to run unreleased code: see
  [Run it locally](../README.md#run-it-locally).
- **Your own orchestrator or managed Postgres**: the images are public on GHCR;
  see [Container images](deployment.md#option-2-container-images-any-container-host).
- **A worked cloud example** with provisioning, secrets in a vault and off-site
  backups: [Azure single-VM runbook](runbooks/azure-lean-deploy.md).
