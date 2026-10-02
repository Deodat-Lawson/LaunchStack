---
"@launchstack/pipelines": patch
---

Publish the `./connectors/google-drive`, `./connectors/gmail` and
`./distribution/stages` subpaths. They were in the workspace `exports` map
but missing from `publishConfig.exports`, so a consumer of the published
package could not import them.
