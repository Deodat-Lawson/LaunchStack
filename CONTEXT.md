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
The one canonical editable note for a Call, owned by the first LaunchStack user whose capture start succeeds. It is company-visible by default but the owner can make it private; other users then see the Transcript without a note and cannot create another. Ownership does not transfer in the initial product. After the Call, the owner can explicitly and reversibly include a company-visible canonical revision in company knowledge; Capture completion alone never indexes it, and private Call Notes are excluded.
_Avoid_: User Note, collaborative note, multiple notes per Call, automatically indexed note

**Enriched Note**:
An explicit post-call AI-proposed revision grounded in the finalized Transcript. Transcript chronology and substantive-topic coverage shape the proposal; the owner's existing note controls emphasis and intent, including visibly labelled owner context that the Transcript cannot support. The proposal remains separate and editable until the owner accepts it, at which point it becomes the next canonical Call Note revision.
_Avoid_: Call summary, transcript summary, automatic overwrite, unaccepted knowledge
