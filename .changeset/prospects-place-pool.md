---
"@launchstack/pipelines": minor
---

The no-key place search of the distribution pipeline
(`createKeylessPorts().searchPlaces`) returns every place of a segment's
OpenStreetMap kinds in a territory instead of the first 40 the map servers
return. It asks Overpass first where one request covers the territory
(`gatherPlacePool`), sweeps Photon letter by letter with box splitting when
Overpass does not answer and for the large countries (`runSweep`,
`readPlaceTags`), and keeps what it asked in a `PlacePoolStore`, so a later
run carries on where the last one stopped and a complete pool costs no
request. `createDbPlacePoolStore()` keeps pools in the new table
`distribution_place_pools`; a host that passes no `placePools` gets a store
that lasts as long as the process.

New options on `createKeylessPorts`: `placePools`, `sweepRequestsPerRun` (the
most Photon requests one run may send; default
`PROSPECTS_PLACE_SWEEP_REQUESTS`, else 64; 0 asks Photon nothing),
`placesPerTerritory` (default 2,000), `throttle`, `placeLimits` and
`overpassUrls`. Photon, the OSM API and Nominatim are asked one request at a
time per host with a pause (`createHostThrottle`).

`gather` reports a place source whose search knows it has not seen everything
yet as `degraded` with the detail `MORE_PLACES_DETAIL` ("more places on the
next run"); a search marks such results with `moreOnNextRun`.
