# Meridian Dispatch — Product Guide

**Document type:** Product guide
**Version:** 4.2
**Last reviewed:** 2026-03-02

## Scheduling engine

Meridian Dispatch produces a conflict-checked movement plan across a rolling 72-hour horizon.
The solver runs on every input change and typically returns a revised plan in under
nine seconds for a 400-mile network.

Manual dispatcher edits are treated as hard constraints. When the solver re-runs, it will
re-plan around a manual edit rather than overwrite it. This behaviour is the single most
requested feature from customers migrating off spreadsheet-based scheduling.

## Integrations

Meridian Dispatch integrates with:

- **Railinc TRAIN II** for interchange messaging
- **Trimble TMW** for crew and asset records
- **Generic CSV import** for railroads without a supported upstream system

We do not integrate with SAP, Oracle Transportation Management, or any WMS product. Requests
for those integrations are declined; there is no roadmap commitment.

## Reporting

The reporting module covers on-time interchange performance, crew utilisation and dwell time
by yard. Reports export to CSV and PDF. There is no real-time dashboard and no mobile
application — both are frequently requested and neither is built.

## Deployment

Meridian Dispatch is delivered as a single-tenant hosted service in AWS `us-east-2` or
`ca-central-1`. On-premise deployment is available only for customers above 200 seats and
carries a separate support agreement.

## Known limitations

- No support for networks above 400 route miles.
- No positive train control integration, and none planned.
- The solver degrades noticeably above roughly 1,200 daily car movements.
- Canadian French localisation covers the dispatcher interface but not the reporting module.
