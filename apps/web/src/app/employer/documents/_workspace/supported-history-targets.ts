import type { HistoryEntry } from "~/lib/workspace-history";
import { toolTargetFromHref } from "~/lib/tool-app/locations";
import { vantageScreenFor } from "~/app/employer/tools/vantage/_lib/screens";

/** Keep recorded work visible while only opening screens the current client supports. */
export function withSupportedHistoryTarget(entry: HistoryEntry): HistoryEntry {
    if (entry.kind !== "vantage" || !entry.href) return entry;
    const target = toolTargetFromHref(entry.href);
    return target?.toolId === "vantage" && vantageScreenFor(target.at).kind === "not-found"
        ? { ...entry, href: undefined }
        : entry;
}
