---
id: MN-WF-003
title: Prototype the Call Notes Interaction Shape
parent: MN-WF-000
status: open
assignee: Main
labels:
  - wayfinder:prototype
blocked_by: []
---

# Prototype the Call Notes Interaction Shape

## Question

What minimal interaction shape makes live attributed transcript, a contemporaneous Call Note, capture state, and post-call AI enrichment feel like one LaunchStack feature without turning it into a live copilot—and what concrete rough prototype best exposes the architecture-affecting states, controls, and failure cases for human review?

## Decisions so far

- Capture starts manually. While any LaunchStack tab is open, LaunchStack offers a global best-effort suggestion when Zoom exposes an eligible call, without promising universal detection or background push.
- If Zoom does not expose a candidate, the user can paste a Zoom join URL or meeting ID and explicitly start capture.
- The long-running worker owns capture. Closing the Calls page does not stop it; capture ends only through Zoom/provider lifecycle, while Pause and Resume remain available in the web UI.
- The live workspace is notes-first: a large owner-editable Call Note beside a narrower company-visible Transcript.
- The transcript follows new attributed segments until the user scrolls away, then offers **Jump to live**.
- The first release exposes Start, Pause, and Resume through Zoom's participant RTMS status API, but deliberately omits Stop. Pause preserves the Capture Attempt and records a known `user_paused` gap that makes the Transcript `partial`; nothing resumes automatically.
- Review and enrichment remain on the same Call page after capture.
- The Calls library initially shows Live and Recent Calls only.
- A global **Call live** pill remains visible across the workspace and opens the active Call; Pause and Resume remain on the Call page.
- Calls is a first-class workspace feature at `?feature=calls`.
- The Calls page uses one compact **Start capture** dialog for a detected candidate or pasted Zoom link/meeting ID. A detected-call notification is an additional Start surface, but both entry points use the same validation and start action.
- After Start, LaunchStack immediately opens the Call in `Connecting` state so note-taking can begin before RTMS is ready.
- A detected-call notification is a persistent actionable ping showing the Zoom topic plus **Start** and **Dismiss**. It remains until acted on or the occurrence ends; dismissing suppresses only that occurrence.
- The Call Note continuously autosaves through LaunchStack's existing rich-note model and displays Saving/Saved state without a Save button.
- If RTMS fails to start, the Call workspace and Call Note remain available, the exact failure is shown, and the user can Retry through the same capture flow.
- The Call Note is shared read-only with the company by default. Only its initiating owner can edit or accept AI revisions, and a **Shared with company** toggle can make it private during or after the Call; other users then see Transcript only.
- Transcript segments are immutable and visible to all authorized company users. Only the Call Note owner can add a company-visible Bookmark with an optional freeform comment; AI infers whether that comment requests verbatim reuse or thematic focus.
- The live editor is a blank rich Call Note using existing formatting and autosave, without templates or live-AI prompts.
- After transcript finalization, AI automatically prepares an owner-only enrichment proposal and shows the owner a Ready badge and same-page banner without interrupting or navigating them. If the Call Note is blank, the proposal may generate a complete note from Transcript evidence. Review is side by side: the current note remains read-only beside an editable proposal; Accept creates the next canonical revision with the Call Note's current visibility and Reject preserves the current note.
- Failed Calls remain in Recent even when empty. Empty failed attempts expose an explicit Delete action so the user can clean them up.
- Calls uses a list/detail split: a compact Live/Recent rail remains beside the selected Call and collapses on narrow screens.
- Enrichment review gives the current note and editable proposal two columns; citations open the relevant immutable Transcript segment in a collapsible evidence drawer.
- Every known missing interval, including a user pause, appears as an immutable inline gap marker at the correct timeline position and in the Call's `partial` status with reason and duration.
- Enrichment shows visible speaker-and-timestamp citations only for passages derived from Bookmarks; other AI-added prose has no visible inline citation.
- Concurrent starts for the same company and Zoom occurrence converge on one Call and Capture. The first successful starter owns the Call Note; later users see **Call already live** and open it without creating another RTMS stream.
- Call Note ownership does not transfer in the first release.
- A Call defaults to its Zoom topic or **Untitled call**; the Call Note owner can rename the LaunchStack title without altering provider evidence.
- Only the Call Note owner can delete an empty failed Call from Recent.
- The global **Call live** pill appears only for the current user's active capture; other company Calls remain discoverable in the Calls rail.
- Only the Capture User who started the current Attempt can Pause or Resume it; company viewers have no RTMS controls.
- When the Call Note is shared, authorized company viewers see owner edits update during the live Call and afterward, but remain read-only.
- Authorized company users can watch the immutable Transcript stream live, regardless of Call Note visibility.
