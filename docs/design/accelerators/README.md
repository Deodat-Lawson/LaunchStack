# Accelerators — feature delivery and delegation

**Status: C's implementation was authorised and the working base is implemented on `grants-pipeline`. Section 12 records the concrete contracts, setup, evidence, and data limitations. A's remaining Catalogue coverage and B's selected-text feature are separate deliveries.**

This README records the new scope and responsibilities agreed in the current conversation. It replaces the previous A/B/C assignments and weekly dependency plan in [issue #510](https://github.com/Deodat-Lawson/LaunchStack/issues/510), [the technical design](technical-design.md), and [the condensed review](technical-design-review.md) for this delivery. Those documents remain historical context, not an additional backlog for this week.

The user is **Person C**, the product lead and integration owner. Product approved the delegation, answered the pre-implementation questions, and then authorised C's implementation with YC as the first example. Current main and the required trust fixes were integrated before feature work. The formal A/B handoff uses the checked and pushed implementation commit reported with this delivery, not the earlier documentation-only commit.

## 1. The feature we want this week

> A company sees accelerator Programs ranked by fit, opens a Program's Form, and saves answers written manually or drafted by AI from its core profile. B adds a separate feature where the user selects answer text, gives an instruction, previews an AI replacement, and applies or cancels it.

The list contains **accelerator Programs**, not other startup companies. Public Program information can be shared across companies within one installation. Fit results, Applications, and answers belong to the company; sharing the Catalogue does not share company data.

Accelerators is available only to active company members with **unrestricted access to all company documents**, subject to the existing action permissions. Enforce this rule on the app and every server read, mutation, and AI action, not only the navigation item. Recheck current access for background work and before returning or saving its results; loss of full access blocks further use, including saved fit results and answers.

Eligible users share one company version of fit results and each Application for its Program/Cycle. Do not create different rankings or answer versions for each viewer. This does not mean one Application across all Programs: Applications for different Programs and Cycles remain separate.

### Terms used here

| Term            | Meaning                                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Program         | An accelerator that a startup can apply to.                                                                                                 |
| Cycle           | A particular batch or rolling intake of a Program.                                                                                          |
| Catalogue       | The reviewed collection of Programs, Cycles, and Forms.                                                                                     |
| Program profile | A sourced description of the accelerator, including AI-written summaries of its target applicants. It is not a company-specific fit result. |
| Form            | An ordered set of application questions, with its source and review status.                                                                 |
| Field           | One question or requested input in a Form.                                                                                                  |
| Application     | One company's saved copy of a Form and its answers for a Program and Cycle.                                                                 |
| Core profile    | The existing company profile and its accessible supporting evidence; not a new profile store.                                               |
| Fit result      | A company-specific comparison of a Program profile with the core profile.                                                                   |
| Suggestion      | An AI-proposed replacement that does not change an answer until the user applies it.                                                        |

`CONTEXT.md` currently defines Call Notes terms, not Accelerators terms. These definitions make this delegation readable without changing that unrelated glossary.

### User-visible completion checks

| Action                     | Required result                                                                                                                                             | Owner                                              |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Open Accelerators          | Require full company-document access. Show saved shared fit results or “not matched yet”; opening the app does not start paid matching.                     | C, using records supplied by C and A               |
| Open a Program             | See its description, target applicants, available Cycle information, and supporting sources.                                                                | C supplies the surface; A supplies further records |
| Match Programs             | Start matching only after the user clicks Match Programs. Show reasons, unknowns, and whether saved results are out of date.                                | C                                                  |
| Start an Application       | Allow only a checked Form whose structure the editor supports. Copy it into a company-private Application, preserving question order and Field constraints. | C                                                  |
| Write an answer            | Save it, reload the page, and restore the same answer. Reject a stale write rather than overwrite newer text.                                               | C                                                  |
| Draft a Field with AI      | Fill an empty Field from the core profile and accessible evidence. Show missing information; never overwrite newer typing with a late result.               | C                                                  |
| Edit selected text with AI | Select text, supply an instruction, preview a replacement, and Apply or Cancel without damaging other text.                                                 | B                                                  |
| Add another Program        | Validate and import its record without changing the UI or database schema for that Program.                                                                 | A uses C's import path                             |

C's base is not the full team delivery: the remaining Catalogue coverage belongs to A, and selected-text AI editing belongs to B. A working base must not be reported as completion of missing A or B work.

### Decisions approved in the pre-implementation Q&A

| Area                | Decision                                                                                                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App access          | Require unrestricted access to all company documents; existing action permissions still apply.                                                                                                                            |
| Company version     | Share fit results and Applications among eligible company members; no per-viewer variants.                                                                                                                                |
| Matching            | The user clicks Match Programs. Opening the app reads saved results without starting paid matching; profile or Program changes mark affected results as out of date.                                                      |
| Credits             | Use the existing credit rules and show the charge before an AI action. Successful generation consumes credits even if the user cancels the preview or does not apply the suggestion. Failures follow the existing policy. |
| Form accuracy       | Only checked Forms can start Applications. Approximate or unconfirmed Forms cannot.                                                                                                                                       |
| Form structure      | An unsupported conditional or repeated structure blocks starting that Form; show the limitation and keep the Program visible.                                                                                             |
| Basic drafting      | Draft empty Fields only. B's preview-and-Apply feature handles AI changes to existing answers.                                                                                                                            |
| Catalogue delivery  | A supplies versioned data files. A trusted operator uses C's validated import command in a named installation; no company-user Catalogue mutation endpoint.                                                               |
| Implementation base | Integrate current main and the required trust fixes into this branch before feature work. Do not wait for the trust-fix PRs to merge into main.                                                                           |

Two engineering rules support these decisions: all answer writers use one stale-write protection contract, and Accelerator Applications stay out of grants screens and actions. Section 12 identifies the implementation and exercised checks.

## 2. Scope boundaries

### Included

- A real, stored Catalogue and company-specific fit matching.
- AI-written Program descriptions and target-applicant summaries from collected web information.
- Checked, supported application Forms, a typed Form editor, persistence, and Field limits.
- Basic AI drafting into empty Fields from the existing core profile and accessible evidence.
- B's selected-text AI editing feature, separate from basic drafting.
- Versioned Catalogue data files and a validated operator import command using the same format as C's reference records.

### Not required for this delivery

- A general-purpose scraper platform, scheduled refresh, or a durable collection service.
- Open-ended web discovery initiated by end users; A can research public sources for the reviewed Catalogue.
- A browser extension, automatic portal filling, automatic submission, or automatic file/video upload.
- The previous full approval-packet, Claim-verification, answer-reuse, telemetry, reporting, or suite-integration programme.
- New Vantage metrics work, a separate core-profile store, diagrams as a product feature, or changes to the grants user experience.

No founder-approved or source-verified label is implied by a draft, fit score, or accepted editing suggestion. The founder still checks answers and submits on the Program's own website.

Earlier product choices remain context: owner/admin approval defaults, custom-role grants, and the 30/90-day metric policy selected on the Whiteboard. They do not require C to build the excluded approval and metric systems for this spike. The old pilot/beta dates and success-threshold report are not acceptance gates for this delivery; product controls scope and dates.

Existing access controls, safe run execution, credit handling, and approval invalidation still apply. Integrate current main and C's required prior trust fixes into this branch before feature work; do not wait for those PRs to merge into main. Resolve integration conflicts and verify the required safety behavior before exercising private company data. Record the integrated base and fix commits in the handoff; do not bypass or rebuild the fixes just to start this feature.

## 3. Responsibility split

| Area             | C: shared working product                                                                                   | A: researched Catalogue data                                                   | B: selected-text AI editing                                            |
| ---------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Contracts        | Own schemas, validation, import, fit, and editing interfaces.                                               | Produce records in the agreed format; propose needed changes to C.             | Consume the editing contract; propose needed changes to C.             |
| Database         | Own product migrations, company boundaries, full-access gate, persistence, and revision-aware shared saves. | Supply versioned files and prove imports through the trusted operator command. | Use the existing revision-aware save/apply path.                       |
| Program research | Produce the initial real reference records.                                                                 | Collect, AI-process, check, and import the remaining records.                  | Not responsible.                                                       |
| Fit              | Own the shared company matcher, explicit Match Programs action, and out-of-date result handling.            | Supply sourced descriptive input, not company-specific scores.                 | Not responsible.                                                       |
| Form UI          | Own list, detail, Form rendering, manual editing, and save/reload.                                          | Supply checked questions and constraints.                                      | Add selection, instruction, preview, Apply, and Cancel.                |
| AI               | Own basic drafting and the shared scoped AI/execution connection.                                           | Run collected web text through AI for the Program profile.                     | Own the selected-text editing prompt, handler, UI, and error behavior. |
| Integration      | Own branch integration, shared files, and complete-path proof.                                              | Prove imported records work in the product.                                    | Prove the editing feature works in the product.                        |

The previous lane restrictions do not apply to this new split: C now owns the shared Program and Form schemas as well as their integration. A and B retain real feature responsibilities, not checker roles.

## 4. C's approved implementation slice

The slice uses real data, storage, and configured model calls. C implements the common product path, not B's selected-text generation and preview feature. The following requirements remain the acceptance contract; section 12 names the delivered modules.

### Spike step 1. Define and validate the shared contracts

Define the output A must produce and the interfaces B must use. Publish runtime validation as well as the language types.

| Contract               | Required information or behavior                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Program and Cycle      | Stable identity, public URLs, a required sourced logo, available dates/timezone, rolling or unknown state, and provenance. Missing dates remain unknown.           |
| Program profile        | Description and target-applicant narrative, source references, checked date, and distinction between source statements and AI interpretations.                     |
| Form and Field         | Stable identity/order, question, instructions, type, required state, options, character/word limits, limit evidence, and Form source/review status.                |
| Import                 | Validate versioned records through a trusted operator command; return actionable errors and re-import without duplicate identities.                                |
| Fit result             | Shared company result: score when assessable, explanation, supporting references, unknowns, and the profile/Program versions used to identify out-of-date results. |
| Editing request/result | Application and Field identity, the answer revision and selected range, user instruction, proposed replacement, and information needed to reject stale Apply.      |
| Answer write           | Manual saves, basic draft completion, and B's Apply all use an authoritative expected revision. Reject stale writes without discarding newer text.                 |

Program target applicants are **not** restricted to a stage enum such as `pre_idea` or `early_stage`. The descriptive narrative is a first-class matching input. C can add useful structured facts, but must not discard the richer source description or turn an interpretation into a hard requirement.

The implementation uses schema version 2 with a required Program logo, a nullable 0–100 fit score, ten Field types, UTF-16 selection offsets, and atomic integer answer revisions. See section 12 for the exported contracts. The access gate, explicit matching trigger, existing credit policy, checked/supported-Form gate, empty-only drafting, operator import, and shared company version remain the approved product rules.

### Spike step 2. Build storage, import, and company boundaries

- Own the Catalogue/Form/application schema changes and migration sequence.
- Keep public Program records separate from company-specific matches and answers.
- Provide a trusted operator import command for A's versioned data files. Ordinary company users, including company owners/admins, do not gain installation-wide Catalogue write access from their company role. Do not add a company-user import endpoint or use direct ad hoc database writes as the handoff contract.
- Snapshot a Form when creating an Application. A later Catalogue import must not silently alter an existing Application or its answers.
- Keep Accelerator Applications separate from grants in list, detail, counts, home/deadline, and action paths when extending shared Proposals storage. Accelerator Field rules and B's controls must not alter the grants user experience.
- Enforce the full-document-access gate for all Accelerators reads and writes, including direct API requests and background results. Retain active membership and the existing read/edit permissions.
- Make manual saves, basic draft completion, and B's Apply use the same atomic expected-revision check. Coordinate pending local saves; reject conflicts visibly and preserve newer text.

### Spike step 3. Build the usable screens

- Register Accelerators in the existing workspace tool host.
- Display the Catalogue, fit results, Program profile, and Form source/review state.
- Show unscored and out-of-date fit states without starting paid work on page open; expose the explicit Match Programs action.
- Show why Start Application is unavailable for an unconfirmed Form or unsupported structure. Approximate templates and silently flattened conditional/repeated questions do not satisfy the checked-Form flow.
- Render the supported Field types, their order, options, required state, and limits.
- Support manual editing, save/reload, and visible save errors.
- Keep file/video requirements visible as manual actions, not text that AI pretends to upload.

Use the repository's shared UI primitives and design tokens. Do not build a separate editor shell or bypass the existing workspace conventions.

### Spike step 4. Implement company fit matching

The user clicks **Match Programs** to compare the sourced Program profiles with the company's core profile. This is a shared company result, available only to users who pass the full-document-access gate. Return reasons and unknowns alongside the score; the score is an assessment of fit, not a probability of acceptance.

A description such as “we help ambitious technical founders” is useful matching input without an invented stage classification. Only an explicit, supported requirement can be treated as a hard rule. Missing company information must not silently become a pass or a failure.

Opening or reopening the app reads saved results and must not start a paid match. Store the profile and Program versions used for each result; changes mark affected results as out of date, without starting a new paid run. Recalculate only when a user requests matching. Follow the existing credit rules, show the charge before starting, and prevent duplicate execution through the shared safe executor.

### Spike step 5. Connect basic AI drafting

Reuse the current Proposals drafting path and company-profile mapping rather than building another profile pipeline. Connect it to the new Application and Field contracts, including the required limits and non-prose behavior.

- Draft an empty prose Field from the question, Program context, and company facts/evidence. A non-empty Field is not a basic-Draft target; use manual editing or B's selected-text feature instead.
- Do not send all Field types to an essay generator; typed values need compatible facts, and missing values remain visible.
- Show missing facts and generation errors; do not fabricate an answer to satisfy the demo.
- Before saving a generated draft, check that the expected answer revision still matches and the Field remains empty. A late result must not overwrite new typing; the editor must also protect unsaved local changes from being replaced by a returned draft.
- Use the existing credit rules and show the charge before generation. B's successful suggestion generation also consumes credits even when the user cancels the preview or does not apply it; failures follow the existing policy. Apply itself must not charge for the same generation again.
- Keep basic drafting independent of B's selected-text editing feature.
- Provide B with the full-access-gated AI connection and common revision-aware save/apply interface. Do not expose the grants editor's unrestricted full-answer Rewrite as a second Accelerators editing path.

### Spike step 6. Produce real reference records

The reference set contains three real Programs: YC, aboveA Startup Accelerator, and Techstars London. aboveA has a checked public Form and supplies the complete editor/drafting demonstration. YC and Techstars remain visible with honest Form access limitations; neither can start an Application.

Reference records must be real product records, kept as versioned files and loaded by the same operator command A will use. Record source/access limitations honestly. A Program without a checked current Form, or with a structure the editor cannot represent, cannot start an Application or count as proof of the exact-Form flow.

These three versioned records are C's reference set, not completion of A's remaining Catalogue coverage.

## 5. What C must deliver before formal handoff

A or B can inspect early contracts and work independently, but the formal handoff happens only after the approved C spike is implemented, checked, and pushed on this branch.

- [x] The Program/profile/Form/import and editing contracts are available in code, with runtime validation.
- [x] Current main and the required trust fixes were integrated before feature work; the commits are recorded below.
- [x] App, direct API, and background checks reject restricted or revoked access.
- [x] Catalogue storage, company-private Applications, and the migration path work.
- [x] The reference records use the same format and import path A will use.
- [x] A checked Form supports edit/save/reload; unconfirmed Forms remain blocked.
- [x] Explicit matching saves company results; page opening is read-only and changed inputs mark results out of date.
- [x] Empty-Field drafting works through the configured model with company inputs and existing credit handling.
- [x] B has an editor integration point, production AI ports, and validated Suggestion/Apply contracts.
- [x] The operator importer rejects duplicate identities; a corrected input imports without duplicate records.
- [x] Two-company isolation, colleague sharing, restricted access, and live access revocation were exercised.
- [x] Revision checks and the editor buffer preserve newer saved and unsaved text during late generation.
- [x] The affected shared grant storage, run, scope, and approval paths have regression coverage.
- [x] Implementation commit `862fabc9` is pushed to `origin/grants-pipeline`; setup, checks, commands, and data limitations are recorded below.
- [x] A/B's bounded assignments and file ownership are published below for handoff.

This completes C's documented working-base handoff. Neither the reference data nor C's implementation means A's or B's assignment is complete. The broader repository gate and full-suite runner limitation below remain visible; this is not a claim that every release check is green.

## 6. Person A — collect, process, and deliver Program data

### Assignment

> Use C's schema, validated operator import command, and real reference records. Collect the remaining accelerator Programs, use AI to produce sourced descriptions and target-applicant summaries, check their Forms, and supply versioned data files. Prove their import in the named installation through a trusted operator. Choose the collection method. A reusable pipeline is welcome, but the required deliverable is checked, reproducible data in the product.

### Required workflow

1. Propose the starter Program list and record count for product approval, identifying which records C has already supplied.
2. Collect relevant official pages and, where useful, other public sources. Collect each Program's official logo or brand mark and preserve its source.
3. Run the collected text through AI to write the descriptive Program profile and target-applicant narrative.
4. Check that the output is supported. Preserve gaps, conflicting descriptions, and the distinction between reported facts and interpretations.
5. Collect and check the actual application questions, order, types, options, required flags, and limits where access permits.
6. Submit versioned data files and logo assets and validate one complete record at a time. Use the trusted operator command to prove import into the named installation and confirm that the record and its logo appear correctly in the product.

The final Program list and coverage must be approved for this delivery. The old issue's record count is not an automatic commitment, and an approved Program list does not establish that every Form is accessible.

### Data quality rules

- Include source URLs, supporting text, and checked dates; do not invent dates, terms, preferences, or questions.
- Every Program requires its official logo or brand mark. Commit the image under `apps/web/public/accelerators/logos/` with the record, cite the official source, and check its appearance on the Program list and detail page. Do not substitute generated artwork, initials, or an unrelated image.
- Official statements and third-party descriptions must remain distinguishable. Repeated web text is not automatically a verified consensus.
- Keep target applicants as evidence-backed narrative, not a forced pair of categories or a company-specific fit score.
- Check Forms against the portal where access is permitted. Never label an estimated template as the exact current Form.
- If a Form is inaccessible, unconfirmed, or has a conditional/repeated structure the editor cannot represent, report that state. Keep the Program visible with the limitation and block Start Application. An approximate or partial template cannot be used to bypass this rule.
- Do not import applicant answers, portal credentials, cookies, or company-private pages into the public Catalogue.

### Method is A's choice

A can use one-off scripts, existing web tools, manual collection where needed, or a reusable pipeline. C does not require A to design a general scraping platform. A is still responsible for the practical process that produces the records and for the required AI-summary step.

A durable pipeline is welcome only if it does not delay the checked records. Scheduling, automatic refresh, broad vendor support, and collection infrastructure are not acceptance gates for this assignment. A must provide enough instructions to reproduce the chosen collect/process/import steps.

### Done when

The approved Program set is delivered as versioned data files and logo assets and imported in C's format into the named installation using the trusted operator command. Every entry displays its sourced official logo; narrative summaries have traceable support; checked/supported Forms can start Applications, and unconfirmed or unsupported Forms cannot. Form coverage and limitations are explicit. Local-only database changes are not the deliverable, and any missing portion of the approved set remains incomplete even if C's reference flow works.

A supplies Program information. C's matcher, not A's collection step, computes fit for each company.

## 7. Person B — selected-text AI editing, end to end

### Assignment

> Own selected-text AI editing. Users select text in an answer, describe a change, review an AI replacement, and Apply or Cancel it safely. Deliver the UI, AI behavior, and saved result. Basic drafting must keep working independently.

This is a complete user feature. B is not assigned to review C's drafting output or merely adjust its prompts.

### User flow

1. Select part of an answer in C's Form editor.
2. Enter an instruction, such as “make this clearer” or “use the customer numbers from our profile.”
3. Send the selection, question, answer context, instruction, and revision through the agreed AI interface.
4. Show the proposed replacement alongside the original selection.
5. Apply only after the user chooses Apply; Cancel leaves the answer unchanged.
6. Save through C's shared path and show the actual save result.

The agreed feature is **user instruction followed by an AI edit**, not only an AI critique. Separate critique mode, batch drafting, and full-answer editing are not additional requirements for B this week.

### B owns

- Selection controls and instruction input in the real editor.
- The selected-text editing handler and prompt, using C's scoped AI connection.
- Original/proposed text preview, Apply, Cancel, and loading/error states.
- Correct mapping from the selected range to the proposed replacement.
- Integration with C's common answer-revision, validation, and save interfaces, including pending manual saves and drafts.
- Behavioral checks and an actual editor demonstration.

### Safety and stability rules

- AI returns a suggestion; it does not mutate the saved answer by itself.
- Applying replaces only the selected text. Text outside the selection stays unchanged, including when the same words occur elsewhere in the answer.
- If the answer changes while AI works, an old suggestion cannot overwrite newer text. Reject the stale Apply and ask for a fresh selection. Use C's authoritative revision check; B's UI-only check is not enough, and pending manual saves must not later overwrite an applied edit.
- Use accessible company facts and evidence. If an instruction requires an unknown number, report the missing fact rather than invent it.
- Require the same full-company-document access as the rest of Accelerators, including at generation and Apply. Follow the existing credit rules: show the charge before generation, successful generation is charged even if the preview is cancelled or unused, and failures follow the existing policy.
- Reuse C's Field validation and show limit violations; never silently truncate text or bypass save checks.
- Cancellation, generation failure, or save failure must not be presented as a successful edit. Cancelling an already-generated preview does not undo the credit charge for that generation.
- Use the existing approval-invalidation behavior where applicable; applying a suggestion does not approve or verify the answer.
- Do not change the basic Draft action, shared database schema, or executor ownership without C's agreement.

### Done when

A user can complete select → instruct → real AI proposal → preview → Apply or Cancel in the running product. A reload preserves an applied edit; unchanged surrounding text, repeated text, non-ASCII selections, stale answers, and failed requests are handled safely.

B's feature can be reviewed in two checkpoints: first the complete successful path, then the boundary/error proof. Both checkpoints are required before reporting B's assignment complete.

## 8. Stable base versus full team delivery

| If this happens                          | What still works                                                                            | What is not delivered                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| A has not finished the remaining records | C's real reference Programs, fit matching, Form editor, save/reload, and basic AI drafting. | The missing portion of the approved Catalogue and checked-Form coverage.           |
| B has not finished selected-text editing | Manual answers and C's basic per-Field AI drafting.                                         | Selected-text AI editing. Do not expose an unfinished action as a working feature. |
| Both A and B complete their assignments  | The full agreed Catalogue plus the complete editing feature, on C's stable base.            | Nothing within the approved scope, subject to the checks below.                    |

This separation reduces dependency risk. It does not authorise silent scope reduction. If the approved data coverage or B's feature is missing, product must explicitly accept a reduced release or C must complete the missing work.

## 9. Integration and verification

C owns shared contracts, migrations, the workspace host, full-access gate, shared executor wiring, and integration. A owns its collection/process implementation and versioned data records, with import proof through C's operator command. B owns its editing module and UI controls in the Accelerators editor only. Identify concrete file ownership in the handoff; shared-file edits go through C, and migrations have one owner at a time.

A and B should deliver small complete slices rather than wait for a final batch. Neither assignment may introduce a second company-profile store, an alternative answer format, or an access-control shortcut.

### Evidence required during implementation

| Area                      | Proof                                                                                                                                                                                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C base                    | Use a real Program and checked/supported Form through list → explicit Match Programs → detail → Application → manual save/reload → real AI draft into an empty Field.                                                                                |
| Company safety            | Exercise two companies, two eligible colleagues sharing the same company version, and a restricted user denied app/API/background access. Revoke access and confirm saved results and answers are no longer readable through Accelerators.           |
| A import                  | Validate versioned files, import a new real record into the named installation, observe it in the product, correct a rejected record, and re-import without duplicates. Company-user API access cannot mutate the shared Catalogue.                  |
| Form fidelity             | Compare questions/order/types/options/limits with the checked source. Unconfirmed Forms and unsupported structures display their limitation and cannot start Applications.                                                                           |
| Matching                  | Different company profiles change the assessment; missing facts remain unknown. Page opens do not start paid matching, input changes mark results as out of date, and an explicit new match refreshes them under the existing credit rules.          |
| B editing                 | Exercise Apply, Cancel, stale text, repeated text, Unicode, missing facts, provider failure, save failure, and pending saves. Observe UI, persisted result, and credit behavior; cancelling a successful generated preview does not undo its charge. |
| Answer concurrency        | Race manual saves, basic draft completion, and Apply. Reject stale writes, preserve newer saved/local text, and do not basic-draft a non-empty Field.                                                                                                |
| Shared Proposals behavior | Exercise affected grant paths, safe run/credit behavior, and existing approval invalidation without replacing them.                                                                                                                                  |

Use regression tests for risky behavior and actual running-product checks for the complete path. A mocked AI response alone does not prove real drafting or editing. Reference data and demonstrations must not be confused with evidence of broader Catalogue coverage or production AI accuracy.

## 10. Reuse points, not a second implementation

These existing files are starting points, not a claim that the accelerator feature is already wired:

- [Company-profile mapping](../../../pipelines/src/proposals/profile.ts): reuse the core-profile-to-drafting view with its access requirements.
- [Draft stage](../../../pipelines/src/proposals/stages.ts): reuse the existing evidence-backed draft behavior.
- [Proposals service](../../../apps/web/src/server/proposals/service.ts): existing save, draft, and rewrite entry points.
- [Application editor](../../../apps/web/src/app/employer/tools/proposals/_screens/ApplicationScreen.tsx): existing editing, save, and drafting behavior.

Reuse shared modules or extract shared components as needed. Keep grants' behavior unchanged; do not copy an entire route-area implementation or create cross-route-area imports. Accelerator Applications must not appear in grants lists, counts, home/deadline views, or grant-specific actions, and B's selection controls belong only in the Accelerators editor.

## 11. Review and execution order

1. **Completed: delegation review and product Q&A.** The decisions above replace the previous delegation.
2. **Completed: C scope authorised.** Product asked for implementation and YC as the first example.
3. **Completed: integrate the base before feature work.** Main and the required trust fixes were merged before the feature.
4. **C handoff: check and push the working base.** Use section 12 and the final delivery's exact branch/commit.
5. **Then: A and B work in parallel.** A extends the Catalogue; B implements selected-text AI editing. C owns shared contract and executor integration.
6. **Finally: prove the team delivery.** Report A's coverage and B's feature separately from C's base.

## 12. Implementation and handoff

### Integrated base

- Branch: `grants-pipeline`.
- Main integrated at `a869cd9f`.
- Required prior C trust fixes: `510-person-c-integration` at `9626c11d`.
- Merge commit before feature work: `7c3bf9c7`.
- Original C implementation: [`862fabc9`](https://github.com/Deodat-Lawson/LaunchStack/commit/862fabc9), pushed to `origin/grants-pipeline`. A and B must use the current branch tip, including the required-logo/schema-version-2 update, not the original implementation or old documentation branch.

### Concrete contracts and storage

| Contract                                      | Implementation                                                                                                  |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Versioned data, runtime validation, DTOs      | `pipelines/src/proposals/accelerators/types.ts`; client-safe export `@launchstack/pipelines/accelerators/types` |
| Public Catalogue and company fit storage      | `pipelines/src/proposals/accelerators/schema.ts` and `db.ts`                                                    |
| Form snapshots and answers                    | Existing Proposals Application/Section storage, discriminated by `kind`; no parallel answer column              |
| Migration                                     | `apps/web/drizzle/20261025074424_accelerators_base.sql`, generated snapshot and journal                         |
| Operator importer                             | `apps/web/scripts/import-accelerators.ts`                                                                       |
| Access and company matching/drafting          | `apps/web/src/server/accelerators/{access,service,run}.ts`                                                      |
| Common safe execution and charging            | `pipelines/src/proposals/run.ts`, web Proposals ports/executor                                                  |
| Workspace UI and separate local/saved buffers | `apps/web/src/app/employer/tools/accelerators/`                                                                 |

The shared implementation lives inside Proposals because both product surfaces use the same Application/Section storage and executor. The public Accelerators exports and API remain separate. This preserves the repository's rule against relative imports between feature verticals.

### Required Program logos

Every Program requires `logo: { path, sourceId }`. `path` is a local image URL under `/accelerators/logos/`; the corresponding non-empty asset must be committed under `apps/web/public/accelerators/logos/`. `sourceId` references an entry in that Program's `sources`, recording the official page, the original asset URL in its supporting text, and the checked date. Images are served locally; opening the Catalogue does not fetch logos from third-party websites.

The importer rejects missing logo metadata, external logo paths, missing source references, and missing/empty local assets. A must supply the image and record together. Keep the official mark intact; do not crop it into a different mark or generate a replacement.

The format is now **schema version 2**. Update and re-import all version-1 records before running the updated UI. There is no version-1 fallback. This is a Catalogue JSON update, not a SQL schema migration; existing Application snapshots and answers remain unchanged. Importing changed Program records marks their saved fit results out of date, without starting another paid match.

YC, aboveA, and Techstars London include checked official marks, shown beside their names in both the list and detail pages.

### Answer contracts

The supported Field types are `short_text`, `long_text`, `url`, `email`, `number`, `date`, `select`, `multi_select`, `file`, and `video`. File/video requirements are visible manual actions, not uploads. Only empty prose Fields have basic Draft. A required Field may be saved unfinished. Numeric length limits need source evidence; unknown limits remain unknown.

Manual saves use `{ expectedRevision, draft }`. `draft` is the only saved answer; `multi_select` stores a JSON array string. Revisions increase for every accepted save. Application creation snapshots the Form, so later Catalogue imports cannot change existing questions or answers.

The selected-text contracts are `EditSuggestionRequestSchema`, `EditSuggestionSchema`, and `ApplyEditSchema`. Offsets are JavaScript UTF-16 code units: start inclusive, end exclusive. A generation request contains the original revision/range and the instruction. A Suggestion contains that revision/range, exact original text, proposed replacement, and gaps. B must validate the selection against the saved answer before generation. Apply validates the revision and replaces that range only; it does not find-and-replace matching words.

### API available to B

All endpoints resolve the authenticated company; callers cannot supply tenancy. Reads require `documents.read`; mutations require `documents.edit`; both also require current unrestricted document access.

| Method and path                                                | Input/result                                                                     |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `GET /api/accelerators`                                        | Saved Programs, matches, Applications, profile readiness, edit permission, costs |
| `GET /api/accelerators/programs/:id`                           | Program detail                                                                   |
| `POST /api/accelerators/match`                                 | Starts a shared matching run; returns `{ run }`                                  |
| `POST /api/accelerators/applications`                          | `{ programId, cycleId }` → `{ application }`                                     |
| `GET /api/accelerators/applications/:id`                       | `{ application }`                                                                |
| `PATCH /api/accelerators/applications/:id/sections/:sectionId` | `{ expectedRevision, draft }` → `{ section }`                                    |
| `POST …/sections/:sectionId/draft`                             | `{ expectedRevision }` → `{ run }`                                               |
| `POST …/sections/:sectionId/apply`                             | `{ expectedRevision, start, end, replacement }` → `{ section }`                  |
| `GET /api/accelerators/runs/:id`                               | `{ run }` within the authenticated company                                       |

There is deliberately no Catalogue mutation endpoint for company users. There is no selected-text generation endpoint or preview control yet: those are B's feature, not an unfinished action exposed by C.

For B's handler, reuse `acceleratorRequest`, `parseBody`, `resolveAcceleratorMember`, `loadOrgProfile`, and `createProposalPorts(companyId, authUserId)`. Enter `withWorkspaceChatModels(companyId, "proposals", …)` after authentication, as the existing Accelerators AI routes do. The ports expose the configured structured model, current-access check, and existing debit adapter; B owns the selected-text prompt and handler. Recheck access before returning a generated Suggestion. Integrate its execution/charging with C's shared run owner; do not add an unmetered model call or charge again on Apply.

`FieldEditor.tsx`, `AnswerBuffer`, and `useAccelerators()` are the editor integration points. Keep `value`, `baseline`, and `baseRevision` separate. Save pending text before selecting a saved revision, serialize Apply with pending saves, and refresh the Application after Apply without discarding local text. A `409` is a conflict, not permission to retry an old answer against a new revision automatically.

The displayed costs are 2,000 credits for matching, 1,500 for basic Draft, and 1,000 reserved for B's successful selected-text generation. Matching and Draft use shared claimed runs. Accelerator output, debit, and run completion commit atomically; failed final access/revision/debit checks publish no output and charge no credits.

### Setup and operator commands

Run from the repository root. Set `DATABASE_URL` to the intended installation first; do not point a demonstration at production.

```sh
pnpm install --frozen-lockfile
pnpm --filter @launchstack/web db:migrate

# Validation does not write a database.
pnpm --filter @launchstack/web accelerators:import -- --validate \
  ../../fixtures/accelerators/programs/y-combinator.json \
  ../../fixtures/accelerators/programs/abovea-startup-accelerator.json \
  ../../fixtures/accelerators/programs/techstars-london.json

# Trusted operator only. DATABASE_URL, not this label, selects the database.
pnpm --filter @launchstack/web accelerators:import -- --installation local-accelerators \
  ../../fixtures/accelerators/programs/y-combinator.json \
  ../../fixtures/accelerators/programs/abovea-startup-accelerator.json \
  ../../fixtures/accelerators/programs/techstars-london.json
```

For a local-only synthetic demonstration, set `DEV_SEED_PASSWORD` yourself, then run:

```sh
DEV_SEED_WORKSPACE='Accelerators Demo — Northwind fixture' pnpm --filter @launchstack/web db:seed
DEV_SEED_WORKSPACE='Accelerators Demo — Northwind fixture' pnpm --filter @launchstack/web accelerators:demo
pnpm --filter @launchstack/web dev
```

The demo seeder requires a named workspace and loopback database, and refuses to overwrite an existing Core profile. It uses the repository's synthetic Northwind facts with an explicit demonstration label. It does not save fabricated fit scores. Configure the existing model provider, open `/employer/documents?feature=accelerators&at=/programs`, and click **Match Programs** to generate actual results.

### Reference records and known limitations

| Record                     | Verified use and limitation                                                                                                                                                                                                                                                                           |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| YC                         | Sourced Program and target-applicant narratives, sources, and company fit. The current official application portal redirects to login. Exact current questions are not invented; Start Application is blocked. A permitted current blank export/review is needed, not credentials or private answers. |
| aboveA Startup Accelerator | Checked public Form with ten ordered applicant Fields, including a required single-option consent Field. Unknown dates and length limits stay unknown. Demonstrates local answers only; nothing is submitted externally.                                                                              |
| Techstars London           | Sourced description and target applicants, March 2027 Cycle, and date-only 18 November 2026 deadline. The complete current Form is unconfirmed; Start Application is blocked.                                                                                                                         |

Fit is an assessment, not an admission probability. The local Core profile is synthetic, so these demonstration scores are not evidence of production accuracy.

### C base verification before the logo update

- Applied all 6 engine and 38 product migrations to an isolated Postgres instance; migration verification reports up to date. Journal checks and `drizzle-kit check` pass. Wire schema drift check passes for 22 existing contracts.
- Imported the three reference records through the operator command. A repeated import reported `inserted: 0`, `updated: 0`, `unchanged: 3`. Duplicate input identities were rejected before database writes, then the corrected input succeeded.
- In the real workspace UI: opened Program list/detail, ran matching through the configured model, started aboveA's checked Form, saved typed answers, reloaded, and restored the same answers. Real AI drafting saved an answer from the Core profile and showed missing information.
- Verified that owner and admin read the same Application and fit results. A second company could not read the first company's Application or run and had no shared matches. Its deliberately unknown synthetic profile produced null scores with explicit unknowns, not invented company facts.
- Changing the profile version marked existing matches out of date without starting another run. A live match whose writer lost full access failed with zero credits and no new fit output. Catalogue/detail/Application/run reads and an answer write returned `403` after revocation; the actual app showed only its full-access error.
- Typed into a Field while real generation was in flight. The local text survived; the returned saved draft appeared as a conflict for an explicit keep-local/use-saved choice. Saved the local choice through the new revision.
- Database regressions cover unique shared Applications, two-company and grants isolation, concurrent saves, saved-and-cleared revision races, exact Unicode Apply, duplicate run admission, revoked final access, debit rollback, unavailable Forms, and immutable Form snapshots. Existing shared run/scope/approval tests were also exercised.
- Workspace typechecks pass. All 55 pipeline test files pass: 628 tests. All 118 LLM package tests pass. The five affected database/run/scope/approval suites pass: 108 tests. The model-scope, API service-map, Studio registry, and vertical-seam suites pass: 37 tests.
- Repository lint passes with zero errors and 36 existing warnings. The final production build passes; its standalone server restores the saved fit results and answers. All three published Accelerators entry points load in plain Node ESM.
- The full web run reports 578 passed suites and 2 skipped suites: 6,500 passed tests, 4 skipped, no failed assertions. The runner nevertheless remains alive after its summary, including with `--detectOpenHandles`, and was terminated at the command deadline. This is not a clean full-suite command pass; no `--forceExit` or test exclusions were added to hide it.
- Repaired the LLM package's build-only ambient DOM type dependency with an explicit Node web-stream type import. No runtime metering behavior changed.

### Required-logo update verification

- All 55 pipeline test files pass: 629 tests, including rejection of missing, remote, and unsourced logos. The 9 Accelerator database regressions pass.
- Pipeline/web typechecks, changed-file lint, and the pipeline package build pass.
- Re-imported the three reference Programs with required logo data and assets. Verified all three images load in the actual Program list and the YC mark appears in Program detail. No paid matching was started.

### Broader repository gate

The installation-wide publish-export check still reports an unrelated missing `@launchstack/conversion/heading-chunker` artifact. Its source export also points to a missing file. This slice does not remove or replace that pre-existing public export. Do not report the whole repository's publish gate as green because the Accelerators path works.

### File ownership for parallel work

- **A:** further files under `fixtures/accelerators/programs/`, their official logo assets under `apps/web/public/accelerators/logos/`, and its own collection scripts. Do not change the public schema, importer, migration, or company-specific scores without C's agreement.
- **B:** selected-text UI/handler modules under the Accelerators feature, integration in `FieldEditor.tsx`, its API client/editor context, and the matching `en`/`zh-CN` messages. Own the complete feature and its behavioral proof, not checks of C's drafting.
- **C:** shared contracts, database/migrations, access, workspace host, run/executor/credit integration, grants separation, and final integration. Coordinate changes here before B merges the selected-text execution extension.

A uses the reference format and operator command immediately. B can build the selection/prompt/preview flow against the published schemas and existing production model ports immediately. Neither must wait for the other person's work.
