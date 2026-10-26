# Accelerator Program collection

This note is the reproduction path for the records added on `accelerators/tony-catalogue`. It does not change the shared importer.

## Coverage in this delivery

The proposed starter sites already named in the design notes are Y Combinator, Techstars, a16z speedrun, Antler, and Entrepreneurs First. Kien's reference records already cover Y Combinator, Techstars London, and aboveA Startup Accelerator. This delivery adds the other three starter sites and does not add a further quota.

| Record                     | File                                | Form                                                                                                      |
| -------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Y Combinator               | existing reference                  | Unavailable. Login-gated. Not changed here.                                                               |
| Techstars London           | existing reference                  | Unconfirmed. Not changed here.                                                                            |
| aboveA Startup Accelerator | existing reference                  | Checked public Form. Not changed here.                                                                    |
| a16z speedrun              | `programs/a16z-speedrun.json`       | Public markup reviewed. Repeated co-founder structure. Start Application blocked.                         |
| Antler                     | `programs/antler.json`              | Public markup reviewed. Conditional city and Elevate branch. Start Application blocked.                   |
| Entrepreneurs First        | `programs/entrepreneurs-first.json` | Bangalore and Bridge first steps only. Remainder is behind email verification. Start Application blocked. |

Not collected into these records: other Techstars cities, Antler per-location investment terms, and the EF hub programs whose forms were not opened (XF2 London Fall 2026, London Spring 2027, and US funding and fellowships).

## What was collected

On 2026-10-26, anonymous HTTP GET requests were made to the official URLs cited in each record. No account was created, no terms were accepted, no application was submitted, and no portal credentials were stored. Visible page text and form markup were quoted into `sources`. Descriptions and target-applicant narratives are marked `interpretation: true` and use only those quotes. Conflicting official statements (speedrun's April 16 versus April 18, 2027 residency end; Antler's 30 versus 26 locations) are left as conflicts.

Logos:

- speedrun wordmark: `https://d1lamhf6l6yk6d.cloudfront.net/uploads/2026/01/sr-logo.svg` on `https://a16z.com/speedrun/`, rasterized to `apps/web/public/accelerators/logos/a16z-speedrun.png`.
- Antler header SVG on `https://www.antler.co/`, shown in the site's red (`#ed4746`), rasterized to `apps/web/public/accelerators/logos/antler.png`.
- Entrepreneurs First header wordmark: `https://www.joinef.com/wp-content/themes/joinef2023/img/framework/logo-new.svg`, rasterized to `apps/web/public/accelerators/logos/entrepreneurs-first.png`.

The catalogue image component serves local PNG files. The raster is the official mark, not a generated substitute.

## Validate and import

Run from the repository root. `DATABASE_URL` must be your own development database.

```sh
pnpm --filter @launchstack/web accelerators:import -- --validate \
  ../../fixtures/accelerators/programs/a16z-speedrun.json \
  ../../fixtures/accelerators/programs/antler.json \
  ../../fixtures/accelerators/programs/entrepreneurs-first.json

pnpm --filter @launchstack/web accelerators:import -- --installation local-accelerators \
  ../../fixtures/accelerators/programs/a16z-speedrun.json \
  ../../fixtures/accelerators/programs/antler.json \
  ../../fixtures/accelerators/programs/entrepreneurs-first.json
```

Run the import a second time. The second run should report the same identities unchanged rather than inserted again.

Then open `/employer/documents?feature=accelerators&at=/programs` and check each Program's logo, sources, dates, and Form state. None of these three Forms can start an Application.
