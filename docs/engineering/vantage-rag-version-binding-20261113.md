# Exact-version RAG bridge compatibility

The isolated experiment adds one metadata forwarding field in `apps/web/src/server/rag/port.ts`. The mapper retains the backend `versionId` value. It never substitutes a current document head or coerces an unsafe value into a trusted version.

The public retrieval metadata type already permits the additive field. No shared type or production ranking change is necessary. Workspace membership identifies the authenticated actor. Sophia's business-role query context remains a separate experimental input.

The portable mapper suite passed 10 tests after its first red run exposed nine failures. An explicit separate probe executed the actual PR602 bridge from `d53cefc7c048dbaecc5d1eee387686211570f082`, Git blob `68c06f03b4ae1ef0fae8a5f8f16f2e928ee37e2f`. It passed 12 checks after initially failing exact-version and business-role cases. Missing, stale, string, bigint, non-finite, non-positive and unsafe-integer version values remain rejected by the exact-version consumer. Backend text is replaced with trusted catalog evidence. Changing a business-role query retains the authenticated actor and document ACL.

The probe made zero embedding or network calls. It establishes offline compatibility. Registered production RAG, semantic relevance, and live model quality remain unmeasured. Sophia's ranking remains outside the canonical default workflow.

The exact source export, manifest, probe and result are retained under `C:/Users/junku/orca/LaunchStack/test-output/vantage-retrieval-version-binding-20261113/`. The portable committed tests require no ignored artifact. The explicit compatibility probe requires its pinned source export and fails when that prerequisite is unavailable.
