# LaunchStack

LaunchStack organizes company knowledge and the user-authored context that steers AI assistance. Call Notes adds provider-captured call evidence without collapsing it into the user's own notes.

## Call Notes Language

**Call**:
One real provider-hosted conversation occurrence scoped to one LaunchStack company. Repeated use of the same provider meeting identifier creates separate Calls.
_Avoid_: Meeting (reserved for agent collaboration), call series, recurring call

**Capture**:
The single company-scoped acquisition of live call evidence for a Call, shared by that company's attending users.
_Avoid_: User recording, personal capture

**Capture Attempt**:
One continuous provider stream interval within a Capture, anchored to one Capture User. The attempt ends when that provider stream stops.
_Avoid_: New capture, retry job

**Capture User**:
An authorized conferencing-provider user whose active app session enables and exclusively controls a Capture Attempt. The Capture User anchors provider authorization and lifecycle but does not own the company Transcript; leaving ends the attempt, and the same user can start a later attempt after returning.
_Avoid_: Transcript owner, recorder, bot

**Participant**:
A person represented in a Call by the name and call-local identity supplied by the conferencing provider. Repeated names or reconnects are not assumed to be the same Participant.
_Avoid_: User, contact

**Transcript**:
The immutable, speaker-attributed textual evidence received for a Call and visible to every authorized user in that Call's LaunchStack company. It is not a user-editable note.
_Avoid_: Note, recording

**Bookmark**:
A company-visible marker that the Call Note owner attaches to an immutable Transcript segment, optionally with freeform guidance. Bookmarks do not alter transcript evidence and can guide generated outputs and Call Note enrichment.
_Avoid_: Private highlight, transcript edit

**Call Note**:
The one canonical editable note for a Call, owned by the first LaunchStack user whose capture start succeeds. It is company-visible by default but the owner can make it private; other users then see the Transcript without a note and cannot create another. Ownership does not transfer in the initial product.
_Avoid_: User Note, collaborative note, multiple notes per Call

**Enriched Note**:
An AI-proposed revision grounded in the Call's Transcript. It preserves existing owner steering and emphasis, may propose a complete Call Note when blank, and becomes the next canonical revision only after the owner accepts it.
_Avoid_: Call summary, transcript summary
