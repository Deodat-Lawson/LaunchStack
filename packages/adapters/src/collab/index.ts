/**
 * Collaboration engine — Slack-shaped channels, multi-agent meetings that run
 * inside them, human takeover, and a signed HTTP protocol that lets the agents
 * live on different machines from the meeting.
 *
 * Everything here is framework-agnostic. The Next.js app wires it to Postgres,
 * Clerk, and the model registry in `apps/web/src/server/collab/`.
 */

export * from "./types";
export * from "./clock";
export * from "./store";
export * from "./agent";
export * from "./grounding";
export * from "./turn-policy";
export * from "./meeting";
export * from "./room";
export * from "./minutes";
export * from "./evals";
export {
  createMeeting,
  slugify,
  type CreateMeetingInput,
  type CreatedMeeting,
} from "./create-meeting";

export * from "./net/protocol";
export { MeetingHub, type MeetingHubOptions, type NodeSnapshot } from "./net/hub";
export { HubClient, HubRequestError, type HubClientOptions } from "./net/client";
export { AgentWorker, type AgentWorkerOptions } from "./net/worker";
export {
  createHubServer,
  startHubServer,
  type HubServerHandle,
  type HubServerOptions,
} from "./net/http-server";

export * from "./slack/client";
export * from "./slack/signature";
export * from "./slack/bridge";
