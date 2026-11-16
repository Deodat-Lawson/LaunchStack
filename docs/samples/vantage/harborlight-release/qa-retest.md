# Atlas focused retest notes
Fictional Harborlight Analytics document. Author: Priya Shah, quality engineer.
Recorded: November 13, 2026, 15:20 UTC. Build: atlas-pilot.186.

## Defect AT-214: export link authorization
On build 181, a copied export URL remained accessible to another pilot user after the owner's share grant was removed. Build 186 now checks the current share grant before returning the file. Retest: 12 of 12 grant-removal cases returned 403; six same-tenant valid-grant cases returned 200. Two cross-tenant cases returned 404. No production customer records were used in these checks.

## Remaining defect AT-219
The date chip renders one day early for Pacific-time viewers when a saved view was created near midnight UTC. This is reproducible in two of six timezone cases. The underlying warehouse timestamp is unchanged. There is no accepted fix or retest date yet.

## Coverage boundary
These are focused authorization and rendering checks, not a full regression run or a load test. Mobile layout and screen-reader behavior were not exercised. Release coordination requested these notes as supporting evidence; no request for a mandatory full QA report was made.
