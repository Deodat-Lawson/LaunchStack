# Vantage synthetic demo: clean-clone startup

This development-only demo combines the existing V1 review workflow with the experimental TL/Sophia V0 context pipeline. It does not activate the production Generate route. The default demo path replays a saved real synthetic model response and explicitly labels it as replay; no provider credential is required. A replay is not a fresh model call.

## Prerequisites

- Node **24.19.0** (recorded in `.node-version`) and **pnpm 10.15.1** (pinned in root `package.json`).
- Local Docker Desktop / Docker Engine with Compose v2 running; a local Unix socket or named-pipe Docker context is required. Remote Docker targets are refused.
- Free loopback ports **55437** (PostgreSQL) and **3104** (frontend). Existing resources with different ownership or credentials are refused, never reset.
- Network access for the lockfile dependencies and `pgvector/pgvector:pg16` image on the first installation. Subsequent runs retain the local volume.

## Fresh machine

```powershell
git clone --branch demo/vantage-integrated-mvp --single-branch https://github.com/Deodat-Lawson/LaunchStack.git LaunchStack-vantage-demo
Set-Location LaunchStack-vantage-demo
npm.cmd install --global pnpm@10.15.1
pnpm.cmd install --frozen-lockfile
pnpm.cmd exec node scripts/dev/vantage-context-demo-runtime.mjs --setup
pnpm.cmd exec node scripts/dev/vantage-context-demo-runtime.mjs --serve
```

Open **http://localhost:3104/dev/vantage-context**. Sign in with the generated synthetic account: open `test-output/vantage-context-demo/runtime/credentials.json` locally to retrieve `loginEmail` and `loginPassword`. Do not share that file, paste it into logs, or commit it. Authentication uses the existing app login mechanism; no bypass is added.

The setup command creates or validates the specifically owned local database, applies/checks the existing engine/product migrations, then prepares the synthetic workspace and its enriched canonical Company Profile. It does not reset a database, delete a Docker volume, run the test suites, or call a model. The first run requires database writes only inside this isolated target:

```text
host:      127.0.0.1
port:      55437
database:  vantage_week2_tl_contract_v1
user:      vantage_week2_tl
container: launchstack-vantage-week2-tl-20261022-db
volume:    launchstack-vantage-week2-tl-20261022-data
```

The password is generated once in ignored `scripts/dev/vantage-integration-tl.env.local`. The app account, auth/encryption keys, seed journal and fixture descriptor live under ignored `test-output/vantage-context-demo/runtime/`. Preserve these files together with the Docker volume for reruns. Do not copy a generic repository `.env`: the demo launcher deliberately refuses root/app dotenv files to prevent accidental use of another database. No worker, external storage, production connector, or public research service is needed.

Setup is safe to repeat for an intact prepared fixture. It verifies the synthetic company/actor and existing source identities rather than overwriting reviews or recreating deleted sources. If verification fails, inspect the reported stage; do not reset the volume. A new fixture records its actual initialization cutoff; retained fixtures keep their original cutoff. The reporting weeks are intentionally labeled backfilled synthetic examples.

## Browser walkthrough

1. Select the synthetic reporting week of October 12, 2026.
2. Open **Inspect Company Architecture**. It should show 13 supported facts, distinct Engineering/Operations/Privacy functions, explicit unknown personnel/hierarchy, and **unreviewed** status.
3. Use the explicitly labeled replay control to load the saved synthetic response; this does not call Azure. Its citations are bound to the exact authorized current fixture versions, with replay provenance retained.
4. Read the summary and discussion topics, open their exact V0 citations, and inspect the historical pending question. Keep/dismiss and recorded Go/No-Go/Needs More Evidence review controls are distinct from generated suggestions and actions.
5. Refresh to verify the saved demo state. Native Weekly Review and Weekly Actions remain separate from the experimental context report.

The profile is fictional source-derived context, not an approved policy. A companion fictional review exercise is explicitly marked as such. **Company Architecture remains `unreviewed`; no named personnel, hierarchy, actual privacy approval, completed action, or pilot-access decision is invented.**

## Optional fresh live generation

The default `--serve` does not need Azure credentials. To enable fresh calls, stop only this app process and export the approved synthetic-only resource and key into its process environment. A sanitized structure is documented in `scripts/dev/vantage-context-demo.env.example`; this example is never loaded automatically.

```powershell
$env:CHAT_BASE_URL = 'https://YOUR-APPROVED-RESOURCE.openai.azure.com/openai/v1/'
$demoSecureKey = Read-Host 'Approved synthetic Azure key' -AsSecureString
$env:CHAT_API_KEY = [System.Net.NetworkCredential]::new('', $demoSecureKey).Password
pnpm.cmd exec node scripts/dev/vantage-context-demo-runtime.mjs --serve-live
```

The deployment must actually be named **`gpt-6-luna`** on that resource. The tracked credential-free `apps/web/config/chat-models.vantage-demo.azure.yaml` is the default exact model behavior; an optional `CHAT_MODELS_CONFIG` override must be absolute and match its normalized-content hash. The host uses explicit demo-only reasoning effort `none`. Do not substitute a different model or endpoint. Fresh calls may fail or vary; a rejected result does not replace a saved report. No current clean-clone verification should be interpreted as a new live-model quality evaluation.

## Isolated clean-checkout verification alongside tonight's demo

To leave the existing 55437/3104 runtime untouched, a fresh checkout can explicitly select only this alternate bounded pair:

```powershell
$env:VANTAGE_CONTEXT_DEMO_DB_PORT = '55438'
$env:VANTAGE_CONTEXT_DEMO_APP_PORT = '3105'
pnpm.cmd exec node scripts/dev/vantage-context-demo-runtime.mjs --setup
pnpm.cmd exec node scripts/dev/vantage-context-demo-runtime.mjs --serve
```

This creates/reuses a separately labeled **`launchstack-vantage-week2-tl-20261022-portable`** Docker project/container/volume and a password under that checkout's ignored runtime directory. The database name/user remain the same, but the target is loopback **55438** and the URL is **http://localhost:3105/dev/vantage-context**. Arbitrary database/app ports and remote targets are refused. The launcher never changes or stops tonight's resources. On a normal fresh machine, omit these switches and use the standard 55437/3104 commands above.

## Checks

```powershell
node --test scripts/dev/vantage-context-demo-runtime.test.mjs scripts/dev/vantage-integration-tl-test.test.mjs
pnpm.cmd --filter @launchstack/web typecheck
```

Use the published acceptance report for actual clean-checkout install, PostgreSQL, API, headless browser and screenshot results. Setup instructions describe supported commands; they do not by themselves prove those checks ran. Generated test artifacts and credentials remain ignored.
