import { redirect } from "next/navigation";

/**
 * Coding sessions are imported from Add a source → Coding sessions, which
 * holds the whole browser. An old link lands there.
 */
export default function AgentSessionsRedirect() {
    redirect("/employer/documents?add=1&tab=agent-sessions");
}
