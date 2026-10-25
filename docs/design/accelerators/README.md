# Accelerators — feature delivery and delegation

**Status: delegation and review decisions approved. C's bounded implementation scope still needs approval. This update is documentation only; implementation is not yet authorised.**

This README records the new scope and responsibilities agreed in the current conversation. It replaces the previous A/B/C assignments and weekly dependency plan in [issue #510](https://github.com/Deodat-Lawson/LaunchStack/issues/510), [the technical design](technical-design.md), and [the condensed review](technical-design-review.md) for this delivery. Those documents remain historical context, not an additional backlog for this week.

The user is **Person C**, the product lead and integration owner. Product has reviewed the delegation and answered the pre-implementation questions below. The next step is to agree C's bounded implementation scope, then integrate current main and the required trust fixes into the current `grants-pipeline` branch before feature work. The working spike must be checked and pushed before the formal handoff to A and B. This document does not claim that integration, implementation, checks, or a push have happened.

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

Two engineering rules support these decisions: all answer writers use one stale-write protection contract, and Accelerator Applications stay out of grants screens and actions. These are requirements to implement, not claims about the current code.

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

## 4. C's proposed implementation spike

The spike must be a working path with real data, storage, and AI calls. It is not a collection of types, mocked endpoints, or a simulator-only demonstration. Its exact implementation scope needs product approval after this README review.

### Spike step 1. Define and validate the shared contracts

Define the output A must produce and the interfaces B must use. Publish runtime validation as well as the language types.

| Contract               | Required information or behavior                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Program and Cycle      | Stable identity, public URLs, available dates/timezone, rolling or unknown state, and provenance. Missing values must remain unknown.                              |
| Program profile        | Description and target-applicant narrative, source references, checked date, and distinction between source statements and AI interpretations.                     |
| Form and Field         | Stable identity/order, question, instructions, type, required state, options, character/word limits, limit evidence, and Form source/review status.                |
| Import                 | Validate versioned records through a trusted operator command; return actionable errors and re-import without duplicate identities.                                |
| Fit result             | Shared company result: score when assessable, explanation, supporting references, unknowns, and the profile/Program versions used to identify out-of-date results. |
| Editing request/result | Application and Field identity, the answer revision and selected range, user instruction, proposed replacement, and information needed to reject stale Apply.      |
| Answer write           | Manual saves, basic draft completion, and B's Apply all use an authoritative expected revision. Reject stale writes without discarding newer text.                 |

Program target applicants are **not** restricted to a stage enum such as `pre_idea` or `early_stage`. The descriptive narrative is a first-class matching input. C can add useful structured facts, but must not discard the richer source description or turn an interpretation into a hard requirement.

Exact type names, endpoint names, schema versioning, score scale, supported Field set, and range/revision representation are implementation choices to settle in the C scope review. The access gate, explicit matching trigger, existing credit policy, checked/supported-Form gate, empty-only drafting, operator import, and shared company version are already decided. This README defines required behavior, not an already implemented API.

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

Proposed reference set: about three real Programs, following the same collection, AI processing, validation, and import steps A will use. At least one must include a Form checked against the actual portal and must exercise the complete user path.

Reference records must be real product records, kept as versioned files and loaded by the same operator command A will use. Record source/access limitations honestly. A Program without a checked current Form, or with a structure the editor cannot represent, cannot start an Application or count as proof of the exact-Form flow.

The final reference count is part of C's scope approval. It is not a claim that three Programs have already been collected.

## 5. What C must deliver before formal handoff

A or B can inspect early contracts and work independently, but the formal handoff happens only after the approved C spike is implemented, checked, and pushed on this branch.

- [ ] The Program/profile/Form/import and editing contracts are available in code, with runtime validation.
- [ ] Current main and the required trust fixes are integrated into this branch before feature work; the base and fix commits are recorded.
- [ ] App, direct API, and background access checks deny users without full company-document access, including after access is revoked.
- [ ] Catalogue storage, company-private Applications, and the migration path work.
- [ ] The reference records use the same format and import path A will use.
- [ ] A checked, supported Form can be opened, edited, saved, and restored after reload; unconfirmed or unsupported Forms cannot start an Application.
- [ ] Match Programs produces a shared company result; page opening does not trigger paid work, and changed inputs mark results as out of date.
- [ ] Basic AI drafting into empty Fields works through a real configured model with company inputs; existing credit rules and failure behavior apply.
- [ ] B has an editor integration point, AI interface, and stale-safe save/apply contract.
- [ ] A can supply a versioned record, correct a validation error, and prove an operator import into the named installation without duplicates.
- [ ] Two-company isolation, the full-document-access gate, access revocation, and shared visibility among eligible colleagues have been exercised.
- [ ] Manual saves, late draft completion, and B's Apply share stale-write protection and preserve newer saved or unsaved user edits.
- [ ] Existing grants still work through the affected shared paths.
- [ ] The approved spike is pushed; the handoff names its branch, commit, setup/import/run commands, checks, and known data limitations.
- [ ] A and B receive their bounded assignments below and a clear list of files/modules they own.

These are evidence gates, not work already completed. A type-only PR or a pushed but unusable scaffold does not satisfy this handoff.

## 6. Person A — collect, process, and deliver Program data

### Assignment

> Use C's schema, validated operator import command, and real reference records. Collect the remaining accelerator Programs, use AI to produce sourced descriptions and target-applicant summaries, check their Forms, and supply versioned data files. Prove their import in the named installation through a trusted operator. Choose the collection method. A reusable pipeline is welcome, but the required deliverable is checked, reproducible data in the product.

### Required workflow

1. Propose the starter Program list and record count for product approval, identifying which records C has already supplied.
2. Collect relevant official pages and, where useful, other public sources. Preserve where each piece of information came from.
3. Run the collected text through AI to write the descriptive Program profile and target-applicant narrative.
4. Check that the output is supported. Preserve gaps, conflicting descriptions, and the distinction between reported facts and interpretations.
5. Collect and check the actual application questions, order, types, options, required flags, and limits where access permits.
6. Submit versioned data files and validate one complete record at a time. Use the trusted operator command to prove import into the named installation and confirm that the record appears correctly in the product.

The final Program list and coverage must be approved for this delivery. The old issue's record count is not an automatic commitment, and an approved Program list does not establish that every Form is accessible.

### Data quality rules

- Include source URLs, supporting text, and checked dates; do not invent dates, terms, preferences, or questions.
- Official statements and third-party descriptions must remain distinguishable. Repeated web text is not automatically a verified consensus.
- Keep target applicants as evidence-backed narrative, not a forced pair of categories or a company-specific fit score.
- Check Forms against the portal where access is permitted. Never label an estimated template as the exact current Form.
- If a Form is inaccessible, unconfirmed, or has a conditional/repeated structure the editor cannot represent, report that state. Keep the Program visible with the limitation and block Start Application. An approximate or partial template cannot be used to bypass this rule.
- Do not import applicant answers, portal credentials, cookies, or company-private pages into the public Catalogue.

### Method is A's choice

A can use one-off scripts, existing web tools, manual collection where needed, or a reusable pipeline. C does not require A to design a general scraping platform. A is still responsible for the practical process that produces the records and for the required AI-summary step.

A durable pipeline is welcome only if it does not delay the checked records. Scheduling, automatic refresh, broad vendor support, and collection infrastructure are not acceptance gates for this assignment. A must provide enough instructions to reproduce the chosen collect/process/import steps.

### Done when

The approved Program set is delivered as versioned data files and imported in C's format into the named installation using the trusted operator command. Records display correctly; narrative summaries have traceable support; checked/supported Forms can start Applications, and unconfirmed or unsupported Forms cannot. Form coverage and limitations are explicit. Local-only database changes are not the deliverable, and any missing portion of the approved set remains incomplete even if C's reference flow works.

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

1. **Completed: delegation review and product Q&A.** The decisions recorded above replace the open alternatives raised in that review. This documentation update does not authorise implementation or a push.
2. **Next: agree C's bounded implementation scope.** Confirm the reference set, supported Field set and real Form structures, score scale, and editing interfaces. Do not reopen the decided access, matching, credit, Form gate, import, or ownership rules.
3. **Then: integrate the base before feature work.** Bring current main and the required trust fixes into this branch without waiting for their PRs to merge into main. Record the commits, resolve conflicts, and verify the required safety behavior; do not treat the old branch as if those fixes were already present.
4. **Then: implement, check, and push C's working spike.** Demonstrate the complete base path and satisfy the handoff checklist. Give A and B the same base commit, versioned examples, setup/import/run commands, contracts, file ownership, and their assignments.
5. **Then: A and B work in parallel.** A extends the real Catalogue; B adds selected-text AI editing. C reviews contract changes and integrates completed slices.
6. **Finally: prove and report the team delivery.** Check the approved Catalogue coverage and B's feature separately from the base, and name anything product explicitly excludes.

The delegation and product decisions are approved. C's bounded implementation scope is the next approval; it does not revive the old multi-week programme or authorise coding merely because this README has been updated.
