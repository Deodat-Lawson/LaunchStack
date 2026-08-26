# @launchstack/features/mcp

Stub — MCP (Model Context Protocol) server scaffolding will land here.

Planned surface: a factory that takes an `Engine` and returns an MCP server
exposing tools (search, ingest, answer, diff) against the host's Launchstack
deployment. Tooling will be defined in core (so third-party MCP surfaces can
wrap the same engine), while this package carries the actual transport +
resource plumbing.
