import { toolTabHref } from "~/lib/tool-app/locations";

/**
 * Where "Simulate" opens Scenarios: its form, prefilled with the situation and
 * aimed at a segment's prospects, or at the companies picked here. The form
 * reads `subject`, `segment` and `prospects` (comma-separated deal ids).
 */
export function simulateHref(args: {
    segmentId: string | null;
    companyIds?: readonly string[];
    subject?: string;
}): string {
    const query = new URLSearchParams();
    if (args.subject) query.set("subject", args.subject);
    if (args.segmentId) query.set("segment", args.segmentId);
    if (args.companyIds?.length) query.set("prospects", args.companyIds.join(","));
    const qs = query.toString();
    return toolTabHref("scenarios", `/new${qs ? `?${qs}` : ""}`);
}
