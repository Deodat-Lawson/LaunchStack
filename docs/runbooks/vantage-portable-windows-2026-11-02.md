# Portable recorded Vantage demo - Windows handoff

Branch: `demo/vantage-portable-windows-20261102`, based on `284a5dc9` plus the polished, uncommitted UI copied from worktree 514f. The 17 transferred files are enumerated and SHA-256 checked in `apps/vantage-demo/source-ui-snapshot.json`. Both the source and transferred files matched at final verification. The source checkout was never modified or committed. The separate audit worktree was never accessed.

## Run on another Windows laptop

Copy the complete `apps/vantage-demo` folder from this branch, or extract the prepared `Vantage-Portable-Windows.zip`. Double-click `Start-Vantage-Demo.cmd`, then open `http://127.0.0.1:3177/` if needed. Keep the launcher window open. Close it or press Ctrl+C to stop only that demo.

Windows PowerShell 5.1 and a current Edge/Chrome browser are sufficient. No Node, pnpm, Docker, database, account, API key, environment file or existing local runtime is needed for the prebuilt package. The launcher uses a loopback TCP listener, avoiding an HTTP.sys URL ACL/admin prerequisite. For another available port, run the PowerShell launcher with `-Port 3178`; ports 3104 and 3111 are explicitly refused.

## Scope and provenance

This mounts the actual polished `VantageTool`, Weekly Review, decision drawer and My context components. It is not the earlier ActionWorkspace design sample. A standalone transport supplies the checked-in recorded synthetic snapshot and simulates review/context/pending changes in tab memory, with version checks. Reload and Reset discard preview edits; theme preference may remain. Unsupported native mutations fail with an explicit unavailable message and create no work. Only the captured week is offered. The uncaptured alternative native Rules report is omitted. The evidence list is derived from the recorded exact sources; no metric series or action records are invented.

Report wording, source bodies, versioned references, unreviewed profile state and historical-question provenance are retained. Source authority is labeled as captured, with no live access/version check. This does not demonstrate production authorization, database persistence, generation quality, or the Phase A audit's conclusions. No Generation endpoint is called.

The bundled Inter and JetBrains Mono fonts are local assets with their OFL licenses. The build manifest rejects unexpected output files, checks the source UI snapshot, and records non-bundler input hashes. The launcher verifies every shipped asset hash/size before starting and serves only manifest-listed files. Git attributes preserve asset bytes under Windows automatic line-ending conversion. No symlinks or absolute source paths are needed at runtime.

## Executed verification

- Polished UI Jest regression: 125 tests / 10 suites passed, single worker.
- Standalone transport Vitest: 8 tests passed; unsupported and external requests fail closed, exact refs are checked, and local version checks/reset are exercised.
- Portable TypeScript `--noEmit` passed; focused source ESLint passed.
- The lightweight esbuild/Tailwind build passed; no full Next.js build or shared cache cleanup was run.
- Real Windows TCP launcher: 8 HTTP checks passed, including GET, HEAD, CSS/JS MIME, SPA fallback, missing file, path traversal and unsupported method.
- Copied-package checks: missing/tampered assets rejected before startup, unlisted file not served, clean package started from a directory containing spaces.
- Final clean extracted ZIP browser acceptance: 7 groups passed on independent port 3181, desktop and mobile, light and dark, exact sources, neutral decisions, local context/review/reset, navigation and unsupported writes. Zero external requests, HTTP failures or page errors during that run. Both local font faces loaded. Light controls were checked after theme transitions settled.

Evidence and ZIP are under the new worktree's ignored `test-output/vantage-portable-20261102/`: `browser-acceptance.json`, `package.json`, `windows-launcher-checks.json`, `clean-package-checks.json` and final screenshots. Browser and all four temporary test listeners were closed. No existing database, runtime directory or reserved port was used; the concurrent audit was neither waited on nor interrupted.

## Rebuild and recheck

From the repository root with Node 24 and pnpm 10.15.1, install the frozen workspace dependencies, then run:

```powershell
node scripts/dev/vantage-portable-build.mjs
node node_modules/typescript/bin/tsc --project apps/vantage-demo/tsconfig.json --noEmit
node pipelines/node_modules/vitest/vitest.mjs run apps/vantage-demo/src/transport.test.ts --root . --exclude 'test-output/**'
```

The prebuilt copy is the recommended receiving-laptop path. To run browser acceptance during development, open an isolated `playwright-cli` session at a task-owned port, then use `scripts/dev/vantage-portable-acceptance.mjs`. The harness accepts only the listed task ports and reports synthetic UI coverage, not live backend acceptance. Rebuilding requires the transferred UI text hashes to match their manifest (LF-normalized); deliberate later UI changes require an explicitly updated snapshot.
