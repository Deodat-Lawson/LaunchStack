# ADR-013: One agent harness for meetings and chat

**Status:** Accepted (2026-09-23)

## Context

Agents existed in Launchstack only as meeting seats: a `collab_agent_persona`
row (handle, name, role, system prompt, route, autonomy) that the Meetings
pane copied into a room. The chat had its own, unrelated notion of a "custom
prompt" — a response style plus a fixed list of `aiPersona` modes — and no way
to answer as one of the meeting agents. Meetings themselves opened on a bare
channel list, so the feature read as "a chat I did not start".

Meanwhile the coding harnesses (Hermes, OpenCode, T3 Code, Claude Code) had
converged on one shape for an agent: a markdown file with front matter —
description, mode, model, tools, permission level — and a body that is the
system prompt, usable both as the agent a conversation is held with and as a
subagent summoned with `@handle`.

## Decision

1. **One definition, three surfaces.** The persona row grows into a full
   definition (`~/lib/agents/definition`): `description`, `mode`
   (`primary` | `subagent` | `all`), a **tool list** drawn from a registry
   (`~/lib/agents/tools`: workspace retrieval, web search, extended
   reasoning, attachments — `null` means every tool, a list means exactly
   those), a response `style`, a picture (`avatarUrl`), plus the fields it
   already had. The same row seats in a meeting, is picked in the chat
   composer, is summoned with `@handle`, and is tried out on the Agents app.
   Autonomy remains the permission dial. Adding a tool is one registry entry
   plus the route that honours it; every editor, badge, file and resolver
   reads the registry.
2. **The agent is a file.** `~/lib/agents/agent-file` reads and writes the
   markdown-with-front-matter shape the coding harnesses use, with a
   dependency-free parser so the browser and the API run the same parse.
   Export, import (with an explicit replace on handle conflict) and reset to
   the shipped starter are API routes.
3. **Ten starter agents** (`~/lib/agents/starter-agents`) seed every
   workspace idempotently by handle; the original four handles are kept so
   stored transcripts resolve. Each carries a `basis` — the named method its
   instructions follow (DACI, superforecasting habits, MetaGPT's Architect,
   ISO 31000, WBR input/output metrics, Working Backwards + Cagan's four
   risks, Dunford positioning, MEDDIC + Challenger, the Mom Test + JTBD
   forces, Schwenk's devil's-advocacy meta-analysis) with sources, shown on
   the Agents page. Pictures are public-domain artworks from Wikimedia
   Commons (`apps/web/public/agents/CREDITS.md`).
   3a. **Response style is an agent setting.** The chat's old per-request
   `style` was not exposed anywhere in the UI. An agent now carries its own
   style; the only chat-level style left is `chat.responseStyle`, a registry
   setting (workspace or member scope) that governs the default assistant
   when no agent is picked — so a style never competes with an agent's
   instructions.
4. **Meeting phases in the engine.** `@launchstack/collab` gains
   `MeetingPhase[]` on the config: each phase has a goal, a turn budget and an
   optional speaker subset. Phase position is a pure function of the turn
   index, so a meeting replays from its log; the orchestrator narrows the
   room per phase, restarts the rotation at each phase, announces the change
   as a system message and injects the phase into every turn's prompt.
   Workflow templates (`~/lib/agents/meeting-workflows`) are recipes that
   produce a phase plan for whoever is in the room. Every phased recipe is a
   method teams already run, named with its origin and where it is used
   (DACI, Six Thinking Hats, Lightning Decision Jam, Klein's pre-mortem,
   Working Backwards PR/FAQ, Sequoia's business-plan outline, the 4Ls
   retrospective, Mom Test + JTBD synthesis, Amazon's WBR, OKRs). There is
   deliberately no workflow builder.
5. **Chat resolution at the route.** The query route resolves the agent
   (`@handle` in the question wins over the composer's pick), applies its tool
   policy to the person's toggles, puts its instructions above the style
   prompt, honours its route and temperature, and echoes the agent back so
   the transcript attributes the turn. Sessions store the agent on the chat
   and on each turn.

## Consequences

- Editing an agent changes what it does next time, never what it said: meeting
  participants stay frozen copies; stored chat turns keep only the handle and
  resolve the name against the live roster.
- A phase plan is a promise about the transcript's shape, so the API refuses
  one the engine could not keep (a phase whose speakers are all absent).
- The mention path never pays for a roster read unless the question contains
  something shaped like a mention, and a roster that cannot be read means no
  mention matched — a chat turn never fails because of the roster.
- Migration `20260923042425_agent_harness_and_meeting_workflows` is additive
  (nullable columns, one boolean default); nothing existing changes meaning.
- Agents are searchable from the command palette: "Ask Dana" picks her in
  the composer; "Open Dana in Agents" selects her in the Agents app.
- Not in scope: streaming answers from agents (the streamed route is not on
  `main`), agent-to-agent delegation as a tool call inside chat (meetings are
  where agents talk to each other), per-agent model ids beyond the four
  configured routes, and a workflow builder.
