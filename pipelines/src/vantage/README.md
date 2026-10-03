# Vantage — the weekly founder-meeting loop

Every week, Vantage turns what a founder already knows — customer
conversations, a few numbers, last week's promises — into an agenda whose
every claim points at its source, then checks next week whether the agreed
action happened. It gives a program administrator a view of where help is
wanted, without exposing what the founder chose to keep private.

```
evidence + metric observations ──► signals (pure) ──► evidence pack
        ──► draft: model (cited) or rules ──► agenda topics
        ──► decision + commitment ──► next week's signals
```

## Tables (product migration set)

| Table                                   | What one row is                                                                                               |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `pdr_ai_v2_vantage_evidence`            | A note, interview, link, task, claim or document with the date it is _about_, a source and a visibility       |
| `pdr_ai_v2_vantage_metric_definitions`  | What a number means — signups vs activated vs paying vs active — keyed for CSV import                         |
| `pdr_ai_v2_vantage_metric_observations` | One number for one period from one source                                                                     |
| `pdr_ai_v2_vantage_agendas`             | One agenda per Monday, with the signals and model metadata it was prepared from                               |
| `pdr_ai_v2_vantage_agenda_topics`       | What happened (cited facts), why it matters, the decision, the next step, help requested, unknowns, conflicts |
| `pdr_ai_v2_vantage_commitments`         | An owner, a due date and the test that resolves the uncertainty; checked in the following week                |
| `pdr_ai_v2_vantage_program_deadlines`   | Program dates an administrator puts in front of the team                                                      |

Every read and write is scoped by `companyId`. A wrong-workspace id is "not
found", never a row.

## Modules

- `week.ts` — Monday-based week math and the rule for _which_ week an agenda
  is for (from Thursday, next week's).
- `csv.ts` — the metric spreadsheet import; bad rows are reported by line and
  the good rows still land.
- `signals.ts` — pure change detection: metric deltas against the previous
  non-overlapping period, conflicts when overlapping periods disagree,
  overdue and due commitments, evidence counts. Also the evidence pack the
  generator cites from, the citation validator, and the rules-based draft.
- `generator.ts` — the model call. Takes a `ResolvedChatModel` (the web app
  resolves it with its deployment's config); reads no environment.
- `prepare.ts` — orchestration. Model first when one is configured; the rules
  when there is none or the call fails; the agenda records which.
- `update.ts` — the weekly update as Markdown, built from shared topics only
  unless the founder asks for their private copy.
- `db.ts` — the repository. DTOs out, ISO dates, `VantageError` with a status.

## What "verified" means here

A fact on an agenda is verified when it has a reviewable source with a date
and, for a number, a definition — and the founder kept it. `validateFacts`
keeps only citations the pack can confirm; a sentence the model wrote with no
confirmable source is kept and marked `unsupported`, so the gap is visible
rather than silently deleted or silently trusted. Vantage never asserts that a
source is _true_.

Observed fact, founder interpretation and generator suggestion are separate
fields on a topic (`facts` / `whyItMatters` / `proposedNextStep`,
`rationale`), so the screen can label each and the founder can reject the
last two without losing the first.

## Sharing

`shared` on a topic and a commitment, `visibility` on evidence. The program
triage view and the weekly update read only shared rows. A private note may
inform a generated topic but is never quoted in its facts (the pack marks it
and the prompt forbids it).

## Scope note

A LaunchStack workspace is one company. The administrator triage view
therefore shows one team's shared requests, missed commitments, deadlines and
staleness. Rolling several teams into one cohort view means reading across
workspaces, which the platform does not do today; the tables are ready for it
(every row carries `company_id`).
