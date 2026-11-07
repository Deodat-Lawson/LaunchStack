# LaunchStack Capture for Mac

The Apple-silicon, macOS 14+ menu-bar companion for LaunchStack Call Notes. It
pairs with a website deployment, stores its device credential in Keychain, and
supervises the bundled worker. There is no npm package in this directory: the app
and audio helper use SwiftPM; the worker is built by the monorepo's pnpm workspace.

## Build and run locally

Use an Apple-silicon Mac with Xcode command-line tools, Node 24, and Corepack. From
the repository root:

```sh
corepack enable
corepack prepare pnpm@10.15.1 --activate
pnpm install --frozen-lockfile
apps/capture-mac/scripts/build-app.sh
apps/capture-mac/scripts/sign.sh
open 'dist/capture-mac/LaunchStack Capture.app'
```

The default development version is **0.1.0**, and the default signing identity is
`-` (ad-hoc). Set the same `CAPTURE_VERSION=MAJOR.MINOR.PATCH` for each command if
you override it. Rebuilding replaces only the generated `.app`; run `sign.sh`
after every build. Ad-hoc builds may omit `SPARKLE_PUBLIC_ED_KEY`; the key is then
removed from the generated Info.plist, and that build cannot publish signed
updates. This is for local development, not Gatekeeper-ready distribution.

`build-app.sh` builds `@launchstack/call-worker`, then builds the Swift audio
helper and `LaunchStackCapture` in arm64 release configuration. It downloads
**Node 24.14.0 darwin-arm64** and its official `SHASUMS256.txt`, checks the selected
checksum against the pinned SHA-256 and the downloaded archive, and re-extracts
the checked runtime. Downloads are cached in the gitignored
`.cache/capture-mac/`; outputs go to the gitignored `dist/capture-mac/`. SwiftPM's
`.build/` directories are also ignored. Failed checksum verification is fatal;
remove a damaged cached download and rebuild rather than bypassing verification.

Before signing, bundling thins every regular Mach-O to arm64, including Sparkle's
otherwise universal framework and nested updater/XPC executables. Framework
symlinks and executable modes are preserved; a binary without arm64 is rejected.

### Pair with the local website

Start the website with its normal database, authentication, transcription
provider, and migrated Call Notes schema. For a localhost deployment, set
`APP_PUBLIC_URL=http://localhost:3000` in the web configuration and run:

```sh
pnpm --filter @launchstack/web dev
```

Sign in, open **Calls**, and use **Connect this Mac**. The website issues a
single-use pairing code and opens a URL of this form:

```text
launchstack-capture://pair?origin=http%3A%2F%2Flocalhost%3A3000&code=lsp_...
```

For a manually issued fresh code, `open '<the returned deepLink>'` exercises the
same flow. Do not invent or reuse codes, paste a device token into a URL, or put
credentials in shell history. Keep the website running at the exact paired
origin; localhost and another hostname are different deployments. The bundle
permits local-network connections for this development flow without permitting
arbitrary insecure network loads.

For an installed release, **Get Call Notes for Mac** downloads a session-bound
DMG from the website. Drag the app to Applications and open it. The first-launch
window shows connection and permission state; the same controls remain in the
menu bar after closing the window.

The app first reads its quarantine download URL. Chrome stores the URL only on
the DMG, so the app also matches its inherited quarantine event identifier to
that exact installer's `kMDItemWhereFroms` metadata. It tries Spotlight first,
then only `LaunchStack-Capture*.dmg` entries in Downloads. macOS may ask for
Downloads access for this one-time pairing lookup. It reads no downloaded file
contents and uploads none. If metadata was stripped or access is denied, use
**Connect this Mac** on the website instead. Other transfers and browser
combinations need installed-artifact verification; do not assume every browser
preserves the same provenance.

Grant microphone and screen/system-audio recording permissions when prompted.
Capture can then start/stop from either Calls or the menu bar. Ad-hoc builds may
need renewed permissions after an upgrade because they lack a stable Developer
ID identity; do not treat this as evidence for signed-release permission reuse.

### Worker and audio-helper contract

The app launches these exact bundle paths, with no secret in argv/environment:

```text
Contents/Helpers/node Contents/Resources/worker/main.js
```

Worker stdin line 1 is JSON with `origin`, `deviceToken`, `appVersion`, and
`systemAudioHelperPath`, plus optional `language` and `autoEnrich`. Subsequent
stdin lines carry control messages. Worker stdout is JSON-line IPC only; logs
belong on stderr. To run the worker without the app, keep a private config file
outside the checkout and pass it through stdin:

```sh
pnpm --filter @launchstack/call-worker dev < ~/.config/launchstack/call-worker.json
```

The helper is bundled at `Contents/Helpers/launchstack-system-audio` and accepts
`--source microphone|system --sample-rate 16000` (mono raw s16le on stdout),
`--status`, and `--request-permission microphone|system`. Status reports
`microphone` and `system`, each with `supported`, `authorized`, `state`, `reason`,
and `message`. Reasons are `ready`, `unsupported`, or `permission_denied`;
`--status` itself exits 0 even when a source is denied. A permission request exits
0/2/3 for ready/denied-or-unavailable/unsupported. System permission state can be
`unknown` because the OS preflight API cannot distinguish a first request from a
prior denial.

The worker uses `--status --source microphone|system`, which reports only the
selected permission. Plain `--status` reports both for the app's permission UI.
These checks observe authorization and active displays without querying
ScreenCaptureKit's window inventory; they are not proof that capture will work.
Only explicit system-audio Start enumerates capture content, with a five-second
deadline. This avoids concurrent inventory requests from routine status checks,
which reproduced one ready response and one stalled response on the test Mac.

## Signing and notarization

The committed entitlement files grant only the required hardened-runtime
exceptions: Node gets JIT and unsigned executable memory; the app and audio helper
get audio input. `sign.sh` signs Sparkle's XPC services, updater and Autoupdate
inside-out, then the framework, Node, helper, and finally the containing app. The
Swift app links Sparkle through `@executable_path/../Frameworks`. Framework
symlinks are preserved throughout bundling, archiving, and DMG creation.

Only for `CAPTURE_SIGN_IDENTITY=-`, `sign.sh` selects
`Resources/app-adhoc.entitlements.plist`, which also disables library validation
so the ad-hoc app can load its ad-hoc Sparkle framework without a shared Team ID.
This exception is development-only. Any non-ad-hoc identity uses the strict
`Resources/app.entitlements.plist`, which grants audio input but does not disable
library validation.

A production build needs a stable Sparkle public key **before it is signed** and
a **Developer ID Application** signing identity. Generate and safely back up a
Sparkle Ed25519 key once with the pinned SwiftPM artifact's `bin/generate_keys`.
Use its printed public key as `SPARKLE_PUBLIC_ED_KEY`; export the private key with
`generate_keys -x <private-file-outside-the-repo>` and put the file's base64 text
in the `SPARKLE_PRIVATE_KEY` release secret. Never rotate the key casually: clients
must trust the signing key embedded in their installed app.

The Sparkle **2.8.1** SwiftPM artifact includes the matching `bin/generate_keys`,
`bin/generate_appcast`, and `bin/sign_update` next to `Sparkle.xcframework`. Scripts
locate them under `apps/capture-mac/.build/artifacts/<package>/<artifact>/`; they do
not download an unrelated tool version. The framework slice is
`Sparkle.xcframework/macos-arm64_x86_64/Sparkle.framework`.

For a signed local artifact, export the production variables and run build/sign.
Then run the notarization and disk-image steps in this order:

```sh
apps/capture-mac/scripts/notarize.sh app
apps/capture-mac/scripts/make-dmg.sh
apps/capture-mac/scripts/notarize.sh dmg
```

Notarization runs only when **all three** `CAPTURE_NOTARY_KEY_ID`,
`CAPTURE_NOTARY_ISSUER`, and `CAPTURE_NOTARY_KEY_PATH` are nonempty. Otherwise each
invocation clearly skips, including partial configuration. With full credentials,
submission must be Accepted before stapling; failures stop the release. An ad-hoc
signature cannot be notarized. The app is stapled **before** it is copied into the
DMG or Sparkle ZIP; the signed UDZO DMG is submitted and stapled separately. App
notarization receipts are retained under `dist/capture-mac/notarization/`.

## Release and private updates

Install Azure CLI (`brew install azure-cli`) and export the variables below. From
the repository root run:

```sh
apps/capture-mac/scripts/release.sh
```

This is `build-app.sh` → `sign.sh` → `notarize.sh app` → `make-dmg.sh` →
`notarize.sh dmg` → `publish.sh`. The versioned artifacts are:

- `LaunchStack-Capture-<version>-arm64.dmg`: UDZO disk image with an Applications
  symlink; signed and, when credentials are supplied, notarized/stapled.
- `LaunchStack-Capture-<version>-arm64.zip`: Sparkle archive of the signed/stapled
  app, produced with `ditto` to preserve framework symlinks.
- `appcast.xml`: generated by Sparkle with the ZIP's EdDSA signature, which
  `sign_update` verifies before upload. The feed itself is not separately signed.
  Private key contents are supplied on stdin, never in process arguments or a
  temporary key file.
- `latest.json`: `{ "version": "x.y.z", "dmg": "releases/x.y.z/LaunchStack-Capture-x.y.z-arm64.dmg" }`.

`publish.sh` creates/enforces a private Azure container named `capture-app` and
uploads `releases/<version>/<filename>.zip`, `releases/<version>/<filename>.dmg`,
then root `appcast.xml`, and **`latest.json` last**. Storage credentials stay in
`AZURE_STORAGE_CONNECTION_STRING`, not command arguments. The web deployment uses
`CALL_NOTES_CAPTURE_APP_STORAGE_CONNECTION_STRING` for the same account and
`CALL_NOTES_CAPTURE_APP_CONTAINER=capture-app` (the default). Do not make blob
objects public or use blob/SAS URLs as appcast enclosures.

The stored appcast uses the literal origin marker `__LAUNCHSTACK_ORIGIN__` before
`/api/call-notes/devices/updates/LaunchStack-Capture-<version>-arm64.zip`. The
website's authenticated `/api/call-notes/devices/appcast.xml` route substitutes
its public request origin. Its authenticated updates route maps that filename to
`releases/<version>/<filename>`. Thus one release can serve multiple deployments;
there is no deployment origin baked into the app or release. The app supplies the
paired-origin feed URL through Sparkle's updater delegate and sets the device
authentication headers on
[`SPUUpdater.httpHeaders`](<https://sparkle-project.org/documentation/api-reference/Classes/SPUUpdater.html#/c:objc(cs)SPUUpdater(py)httpHeaders>).
Sparkle applies these headers to appcast, release-note, and update-archive
requests. The initial DMG still requires the website's session-bound pairing
download route.

### Environment variables

| Variable                          | Default / requirement                                                                                                                                                                           |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CAPTURE_VERSION`                 | `0.1.0` for individual development steps; explicitly required by `release.sh` and `publish.sh`. Must be numeric `MAJOR.MINOR.PATCH`; used for both bundle versions, filenames, and Azure paths. |
| `CAPTURE_SIGN_IDENTITY`           | `-` for ad-hoc signing. Production distribution requires an installed Developer ID Application identity, e.g. `Developer ID Application: Your Company (TEAMID)`.                                |
| `SPARKLE_PUBLIC_ED_KEY`           | Base64 32-byte Ed25519 public key, embedded as `SUPublicEDKey`. Required for Developer ID builds and for release/publish; may be omitted only for ad-hoc local development.                     |
| `SPARKLE_PRIVATE_KEY`             | Contents (not a path) of the exported Sparkle private key; required by release/publish and must match the app's public key.                                                                     |
| `CAPTURE_NOTARY_KEY_ID`           | App Store Connect notarization API key ID; used only with both remaining notary inputs.                                                                                                         |
| `CAPTURE_NOTARY_ISSUER`           | App Store Connect issuer UUID.                                                                                                                                                                  |
| `CAPTURE_NOTARY_KEY_PATH`         | Local path to the `.p8` API private key; never bundled.                                                                                                                                         |
| `AZURE_STORAGE_CONNECTION_STRING` | Release-account connection string for Azure CLI; required by release/publish.                                                                                                                   |
| `CAPTURE_BUILD_DIR`               | `<repo>/dist/capture-mac`; optional packaging-output override.                                                                                                                                  |
| `CAPTURE_CACHE_DIR`               | `<repo>/.cache/capture-mac`; optional verified-download cache override.                                                                                                                         |

Relative build/cache overrides resolve against the repository root. Use identical
values across standalone packaging steps. Missing notarization inputs intentionally
skip notarization; they do **not** make an ad-hoc or unnotarized app ready for public
production distribution. Always supply the Developer ID and all notary credentials
for a production release.

### GitHub Actions

`.github/workflows/capture-mac.yml` runs on the Apple-silicon `macos-15` runner for
`capture-v*` tags and manual dispatch with an explicit version. Tags must be
`capture-vMAJOR.MINOR.PATCH`; the version is passed to the same release script.
The workflow configures pinned Node/Corepack/pnpm, installs workspace dependencies
and Azure CLI, and retains the generated release artifacts.

Configure repository secrets `CAPTURE_SIGN_IDENTITY`, `SPARKLE_PUBLIC_ED_KEY`,
`SPARKLE_PRIVATE_KEY`, `AZURE_STORAGE_CONNECTION_STRING`, `CAPTURE_NOTARY_KEY_ID`,
and `CAPTURE_NOTARY_ISSUER`. `CAPTURE_NOTARY_KEY_P8` contains the `.p8` file text;
the workflow materializes it privately and sets `CAPTURE_NOTARY_KEY_PATH`.
`CAPTURE_CERTIFICATE_P12_BASE64` imports the Developer ID certificate/private key
into an ephemeral runner keychain; `CAPTURE_CERTIFICATE_PASSWORD` supplies its
import password. CI requires the certificate, Sparkle, Azure, and complete notary
credentials before building or publishing, and rejects an ad-hoc identity.
Temporary certificates, notary keys, and the keychain are removed even when the
release fails. Local scripts still support explicitly chosen ad-hoc test builds;
the release workflow never silently publishes one.
