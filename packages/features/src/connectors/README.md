# @launchstack/features/connectors

Stub — third-party data connectors (Nango-backed) will live here.

Intent: a small set of first-class integrations (Google Drive, SharePoint,
Notion, Slack, …) that register as ingestion sources. Authentication goes
through Nango; the connector owns the polling / webhook → StoragePort +
JobDispatcherPort plumbing so ingestion is unified.
