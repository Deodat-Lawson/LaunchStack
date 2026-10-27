# Accelerator Program collection

This note is the reproduction path for the records added on `accelerators/tony-catalogue`. It does not change the shared importer.

## Coverage in this delivery

Kien's reference records already cover Y Combinator, Techstars London, and aboveA Startup Accelerator. The first pass added a16z speedrun, Antler, and Entrepreneurs First. A later pass added the programs below. Each new record is schemaVersion 2. Descriptions are `interpretation: true` and stay inside the quoted official pages. Deadlines without a year, a clock, or an agreed date were left empty. Forms that were login-gated, split across pages, or not opened stay unsupported, so Start Application stays blocked.

| Record                               | File                                                 | Form                                                                                      |
| ------------------------------------ | ---------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Y Combinator                         | existing reference                                   | Unavailable. Login-gated. Not changed here.                                               |
| Techstars London                     | existing reference                                   | Unconfirmed. Not changed here.                                                            |
| aboveA Startup Accelerator           | existing reference                                   | Checked public Form. Not changed here.                                                    |
| a16z speedrun                        | `programs/a16z-speedrun.json`                        | Public markup reviewed. Repeated co-founder structure. Start Application blocked.         |
| Antler                               | `programs/antler.json`                               | Public markup reviewed. Conditional city and Elevate branch. Start Application blocked.   |
| Entrepreneurs First                  | `programs/entrepreneurs-first.json`                  | Bangalore and Bridge first steps only. Remainder is behind email verification.            |
| 500 Global                           | `programs/500-global.json`                           | Flagship page read. Close date has no year. Start Application blocked.                    |
| MassChallenge                        | `programs/masschallenge.json`                        | Accelerator groups only. Placeholder lines ignored. Start Application blocked.            |
| Alchemist                            | `programs/alchemist.json`                            | Apply page had no questions. Chicago, Doha, and Japan not opened.                         |
| SOSV                                 | `programs/sosv.json`                                 | Apply page is a chooser among NY, SF, and HAX. No single Form.                            |
| HAX                                  | `programs/hax.json`                                  | Program page read. Application not opened. Newsletter form not imported.                  |
| Founder Institute                    | `programs/founder-institute.json`                    | Washington DC - Philadelphia Fall 2026. Nov 10 and Nov 17 closings left unresolved.       |
| Berkeley SkyDeck                     | `programs/berkeley-skydeck.json`                     | Batch 23 window ends 2026-08-21 with no clock. Batch 24 says January and has no year.     |
| Creative Destruction Lab             | `programs/creative-destruction-lab.json`             | Program page read. Stream pages and the Form were not opened.                             |
| Founders Factory                     | `programs/founders-factory.json`                     | Accelerator page read. Partner programs and the Form were not opened.                     |
| AngelPad                             | `programs/angelpad.json`                             | Homepage read. On-page apply anchor was not converted into a Form.                        |
| Entrepreneurs Roundtable Accelerator | `programs/entrepreneurs-roundtable-accelerator.json` | Winter 2027 deadline is the date 2026-11-02. Questions behind Apply Now were not opened.  |
| South Park Commons                   | `programs/south-park-commons.json`                   | Residency page read. Residency and funding forms were not opened.                         |
| Techstars                            | `programs/techstars.json`                            | Network page. Distinct from Techstars London. apply.techstars.com did not show questions. |
| gener8tor                            | `programs/gener8tor.json`                            | Investment-accelerator overview. City applications were not opened.                       |
| Google for Startups                  | `programs/google-for-startups.json`                  | Programs page read. Accelerator URL was navigation only.                                  |
| HF0                                  | `programs/hf0.json`                                  | First step is name, email, and phone. Later steps not opened. Batch dates have no year.   |
| StartX                               | `programs/startx.json`                               | Fellows date is Nov 1 with no year. No equity and no fees, as the homepage states.        |
| Dreamit                              | `programs/dreamit.json`                              | First page of a two-page pitch form, including a required deck file. Not imported.        |
| Boost VC                             | `programs/boost-vc.json`                             | Homepage says $500k checks. Fellowship page says $50k and Dec 1st with no year.           |

Not collected into these records: other Techstars cities, Antler per-location investment terms, the EF hub programs whose forms were not opened, Founder Institute chapters other than Washington DC - Philadelphia, and gener8tor's individual city accelerators. Plug and Play and Neo were fetched and skipped because the public HTML did not contain a program description. Seedcamp's homepage was portfolio news rather than program terms. Bethnal Green Ventures' fetched page was a newsletter gate.

## What was collected

On 2026-10-26 and 2026-10-27, anonymous HTTP GET requests were made to the official URLs cited in each record. No account was created, no terms were accepted, no application was submitted, and no portal credentials were stored. Visible page text was quoted into `sources`. Descriptions and target-applicant narratives are marked `interpretation: true` and use only those quotes. Conflicting official statements are left as conflicts. That includes speedrun's April 16 versus April 18, 2027 residency end; Antler's 30 versus 26 locations; 500 Global's October 11th close with no year beside an unlabeled November 30, 2026 - April 9, 2027 range; Founder Institute's Nov 10 close beside a Nov 17 6:00 pm final deadline; HF0's two batch starts and two demo days with no years; and Boost VC's $500k checks beside a $50k fellowship.

Logos are official marks rasterized to PNG under `apps/web/public/accelerators/logos/`. SVG wordmarks were rasterized because the catalogue image component does not serve SVG. White header marks were not recolored. HAX is the official black file from SOSV rather than the white-and-green header SVG, so the wordmark stays visible on a light panel. Founders Factory's published wordmark is white (`#FFFFFF`) and is faint on a light panel. The 500 Global page's lorem ipsum block and MassChallenge's "Short one liner description here" placeholders were not stored as facts.

## Validate and import

Run from the repository root. `DATABASE_URL` must be your own development database.

```sh
pnpm --filter @launchstack/web accelerators:import -- --validate \
  ../../fixtures/accelerators/programs/*.json

pnpm --filter @launchstack/web accelerators:import -- --installation local-accelerators \
  ../../fixtures/accelerators/programs/*.json
```

Run the import a second time. The second run should report the same identities unchanged rather than inserted again.

Then open `/employer/documents?feature=accelerators&at=/programs` and check logos, sources, dates, and Form state. None of the Forms added in this delivery can start an Application.
