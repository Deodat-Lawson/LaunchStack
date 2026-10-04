# LaunchStack

LaunchStack organizes company knowledge and user-authored context that steers AI assistance. Call Notes preserves local audio evidence alongside notes while making clear which local channel supplied each transcript segment and what that evidence cannot establish.

## Call Notes Language

**Call**:
One real conversation occurrence scoped to one LaunchStack company. Each occurrence is represented as its own Call, even when the conversation belongs to a recurring series.
_Avoid_: Meeting (reserved for agent collaboration), call series, recurring call

**Capture**:
The single company-scoped acquisition of live call evidence for a Call, shared by that company's attending users. This release can use two independent local channels: the Capture User's microphone and the computer's combined system output. It preserves Audio Channel provenance but does not establish speaker identity, complete coverage, or a raw recording; no meeting bot joins the Call.
_Avoid_: User recording, personal capture, complete recording

**Capture Attempt**:
One continuous interval within a Capture, anchored to one Capture User. A later interval is a new attempt, and an attempt can end because of silence across the captured channels, user action, or source shutdown.
_Avoid_: New capture, retry job, continuous stream

**Capture User**:
The authenticated same-company user who starts and controls a Capture Attempt. The Capture User controls capture lifecycle but does not own the company Transcript; the first successful starter owns the Call Note.
_Avoid_: Transcript owner, recorder, bot, external-account user

**Audio Channel**:
The provenance of a Transcript segment: **microphone** is the Capture User's local microphone signal, and **system** is the computer's combined system output. Channel provenance describes the supplied audio path, not a person or speaker. The Calls surface may use the fallback labels **Me** and **Meeting** while leaving Participant unset.
_Avoid_: Speaker, participant attribution, diarization, per-app audio

**Computer Audio**:
The computer's combined system output available while a Capture is active. It can include meeting sound and other system output, including when routed to headphones; it is not a per-app feed and does not identify a speaker.
_Avoid_: Remote-party feed, app recording, meeting bot

**Voice Activity**:
Speech-like acoustic activity detected independently in a captured Audio Channel. It indicates activity in supplied audio, not a person or a speaker turn; silence in one channel does not by itself establish that the Call has ended.
_Avoid_: Speaker detection, diarization, remote-audio detection

**Local Capture Worker**:
The runtime responsible for acquiring a Capture User's local microphone and Computer Audio evidence and coordinating their transcription for Call Notes. It does not join the conversation as a participant or turn local audio evidence into a complete recording or speaker-attributed account.
_Avoid_: Meeting bot, conferencing connector, recorder

**Audio Utterance**:
A bounded span of captured audio from one Audio Channel associated with Voice Activity and used as one unit of transcription evidence. It is not necessarily a complete statement and carries no guaranteed speaker identity.
_Avoid_: Speaker turn, participant recording

**Transcription Model**:
A model that turns an Audio Utterance into textual evidence and optional language information. Its output can only reflect the supplied channel audio; it cannot reconstruct missing audio or guarantee speaker attribution.
_Avoid_: Summarizer, diarization model, complete transcript

**Participant**:
A person represented in a Call when available context supports that representation. Local audio and Audio Channel provenance do not by themselves establish participant identity, remote-party presence, or which person spoke each word.
_Avoid_: User, contact, speaker

**Transcript**:
Immutable textual evidence derived from the audio supplied for a Call and visible to every authorized user in that Call's LaunchStack company. Each segment carries Audio Channel provenance while Participant may remain unset. It is not a user-editable note or a retained recording, and local evidence may be incomplete and unattributed.
_Avoid_: Note, recording, complete transcript

**Call Note**:
The one canonical editable note for a Call, owned by the first LaunchStack user whose capture start succeeds and treated as an application-managed file for indexing and permission-scoped AI retrieval. The owner can make this company-visible file private; other users then see the Transcript without a note and cannot create another, while unaccepted enrichment proposals and raw Transcript evidence remain distinct from the canonical file.
_Avoid_: User Note, collaborative note, multiple notes per Call, duplicate exported note, separately opted-in knowledge publication

**Calls Folder**:
The workspace collection of Call Note files. Call history is another view of those same files, not a separate collection of notes.
_Avoid_: Recording archive, separate call-history store, host filesystem directory

**Enriched Note**:
An explicit post-call AI-proposed revision grounded in the finalized Transcript. Transcript chronology and substantive-topic coverage shape the proposal; the owner's existing note controls emphasis and intent, including visibly labelled owner context that the Transcript cannot support. The proposal remains separate and editable until the owner accepts it, at which point it becomes the next canonical Call Note revision.
_Avoid_: Call summary, transcript summary, automatic overwrite, unaccepted knowledge
