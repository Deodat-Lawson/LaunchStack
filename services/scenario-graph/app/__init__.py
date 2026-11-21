"""LaunchStack scenario graph service (Graphiti + Neo4j)."""

import os

# Graphiti phones home to PostHog unless told not to. This service handles
# private company documents, so telemetry is off unless an operator turns it
# back on explicitly. Set before any graphiti_core import.
os.environ.setdefault("GRAPHITI_TELEMETRY_ENABLED", "false")
