---
id: MN-WF-013
title: Confirm RTMS Access in the Target Zoom Account
parent: MN-WF-000
status: open
assignee: null
labels:
  - wayfinder:task
blocked_by: []
---

# Confirm RTMS Access in the Target Zoom Account

## Question

Can the actual Zoom account intended for the internal pilot create a user-managed General App, purchase or activate Developer Pack credits, expose the required RTMS scopes and events, add the private app to an intended user, show the current transcript-enabled rate and concurrency entitlement, and complete one disclosed single-user test stream without undocumented support enablement? The test must include native Pause and Resume, observe whether the media connection and RTMS billing continue while paused, then have the user leave and return and verify that LaunchStack can append the restarted RTMS session as a new Capture Attempt under the same logical Capture while accurately preserving every gap.

## Observed evidence

Evidence was collected against the actual internal-pilot Zoom account from
2026-08-17 through 2026-08-19. The runtime test used Zoom's official
`zoom/rtms-quickstart-js` and `@zoom/rtms` 1.1.0 on Node 24 behind temporary
public HTTPS tunnels. It did not use or modify the LaunchStack prototype. All
identifiers below are redacted references; no app secret, OAuth code, token, raw
meeting identifier, or temporary endpoint is recorded.

### Account and app

- On 2026-08-17 the account owner created `LaunchstackCall` as a Development
  **General App** with **User-managed app** selected. The Marketplace creation
  record attributed the app to the account owner.
- The account activated **Zoom Developer Pack | Free Trial**, showing 20 total
  credits, 0 used, and a trial period from 2026-08-17 through 2027-08-17. The
  entitlement card explicitly listed **RTMS with Transcriptions**.
- Zoom's account-visible rate table on 2026-08-18 showed **RTMS with
  Transcriptions: $0.02 per Meeting Streaming Minute** and **RTMS without
  Transcriptions: $0.01 per Meeting Streaming Minute**.
- The app has the non-optional transcript-only media scope
  `meeting:read:meeting_transcript`. No audio, video, or screen-share media scope
  was selected. During the meeting, however, Zoom's Active App Notifier disclosed
  `Accesses: Audio, Transcript`; this is observed Zoom UI behavior and must not be
  reinterpreted as proof that the receiver obtained raw audio.
- The Development Event Subscription validated successfully over public HTTPS.
  It subscribed to `meeting.rtms_started`, `meeting.rtms_stopped`,
  `meeting.rtms_interrupted`, `rtms.concurrency_near_limit`, and
  `rtms.concurrency_limited`. Zoom auto-selected the corresponding event scopes.
- The owner/pilot user directly enabled **Share realtime meeting content with
  apps**, privately added and authorized the Local Test app, and selected
  `LaunchstackCall` as that user's auto-start app. Runtime auto-start proves the
  setting and assignment were effective.
- The Local Test OAuth callback returned an authorization code and no error, but
  did not include a `state` parameter. This records Local Test behavior only;
  production OAuth must supply and verify its own state.

### Runtime on 2026-08-19

One disclosed meeting used the owner/pilot as the sole RTMS app user and a silent
control participant. The control participant kept the meeting occurrence open
but did not speak. Zoom displayed the Active App Notifier for
`LaunchstackCall`.

| UTC observation | Evidence |
| --- | --- |
| `13:53:14.016` | `meeting.rtms_started`; redacted meeting ref `fff23737b888`, stream ref `070b0e912d46`; first Attempt in the temporary evidence harness |
| `13:53:16.294` | SDK join confirmed with reason `0` |
| `13:53:16.548` | One attributed participant session added; session ref `d130289889d8` |
| `13:54:12.119` onward | Speaker-attributed Transcript packets carried participant identity plus provider start/end timestamps. Zoom transcribed the deliberately disclosed marker `MN-WF-013 transcript evidence, alpha bravo` with normal recognition variation. |
| `13:58:13.896` | Native Zoom Pause produced session operation `3` and status `3` on the existing stream/session |
| `14:01:05.938` | Native Zoom Resume produced operation `4` and status `4` on the same stream/session |
| `14:01:28.403` | Attributed Transcript delivery resumed after the visible Pause Gap |
| `14:03:20.929` | `meeting.rtms_stopped` on the same refs with reason `6`, documented as `STOP_BC_MEETING_ENDED` |

The Pause interval was 172.042 seconds. No Transcript packet, RTMS stop, SDK
leave, or interruption event arrived during that interval, including after a
spoken pause marker. The receiver process retained two established TLS
connections to the same Zoom endpoints and ports before Pause, immediately
after Pause, and after the interval. Resume required no new SDK join and retained
the same stream and session references. This proves that native Pause suppresses
Transcript delivery while the signaling/media connections and provider
stream/session remain allocated.

The installed SDK reported `isActive: false` and `isPaused: false` for both the
Pause and Resume callbacks even though their operation/status values were
respectively `3/3` and `4/4`. LaunchStack must treat the documented operation and
status transitions as evidence; these SDK booleans were inconsistent in the
observed 1.1.0 runtime.

The provider stream lasted 606.913 seconds (about 10.115 minutes), of which about
7.248 minutes were not paused. At the observed $0.02 rate, expected usage is
about $0.202 if Pause is billable and $0.145 if it is excluded. Immediately after
the meeting, Zoom still displayed `0 of 20 credits` and exposed no fractional
service line. The low-volume rounded balance cannot distinguish those cases.

### Unproven acceptance items and exact blockers

This issue remains open.

- **Concurrency entitlement:** no `rtms.concurrency_near_limit` or
  `rtms.concurrency_limited` event was emitted at one active stream, and the
  account UI exposed no numeric concurrent-stream entitlement. The value requires
  an account-specific Zoom support answer or an observed near-limit payload;
  Developer Pack credits are not a safe proxy.
- **Paused-time billing:** Zoom had not posted a detailed RTMS service line after
  the low-volume meeting. Reconcile a later detailed usage report or run a
  deliberately long, bounded Pause interval that produces measurable fractional
  usage. This was placed on the backlog on 2026-08-19.
- **Leave and return:** the operator declined leave/rejoin testing in this
  meeting. No second provider stream was observed, so a new Capture Attempt,
  `capture_user_absent` Gap, automatic same-user continuation, and the
  same-occurrence identity correlation remain unproven.
- **Paused return:** because leave/rejoin was declined, it is unknown whether
  Zoom auto-start would restart this configured app after the paused user
  returns. LaunchStack's requirement to keep desired mode paused therefore
  remains an implementation gate, not an observed provider fact.
- **Transport reconnect:** no controlled signaling or media interruption was
  introduced before the meeting ended. Reconnect-versus-new-Attempt behavior,
  timing, and any `transport_interruption` Gap remain unobserved.

### Post-test account state

Cleanup completed on 2026-08-19:

- All temporary receiver, callback, and tunnel processes were stopped, and the
  temporary directory containing the development credentials was deleted and
  verified absent.
- The temporary Event Subscription was removed after its HTTPS endpoint expired.
  Production-development must recreate the five-event subscription above against
  its persistent public endpoint.
- The temporary OAuth Redirect URL and OAuth Allow List entry were removed.
  Production-development must supply its persistent callback before Local Test
  can authorize again.
- The owner intentionally retained the General App, Developer Pack, transcript
  scope, private authorization, user-level realtime-content setting, and pilot
  auto-start assignment. Until a persistent receiver is configured, ordinary
  meetings on the pilot identity may auto-start RTMS without a consumer and must
  be avoided; billing behavior in that failure mode was not tested.

### Official contract used

- [Add RTMS features](https://developers.zoom.us/docs/rtms/meetings/add-features/)
- [Work with streams](https://developers.zoom.us/docs/rtms/meetings/work-with-streams/)
- [Host and admin controls](https://developers.zoom.us/docs/rtms/meetings/ux-host-admin-tools-ctrls/)
- [Participant experience](https://developers.zoom.us/docs/rtms/meetings/ux-participant/)
- [RTMS event reference](https://developers.zoom.us/docs/api/rtms/events/)
- [RTMS data types](https://developers.zoom.us/docs/rtms/data-types/)
- [Official Node SDK](https://github.com/zoom/rtms)
- [Official Node quickstart](https://github.com/zoom/rtms-quickstart-js)
