import { simulateHref } from "~/app/employer/tools/growth/prospects/_lib/simulate";
import { scenariosScreenFor } from "~/app/employer/tools/scenarios/_lib/screens";
import { parseToolHref } from "~/lib/tool-app/locations";

describe("simulateHref", () => {
    it("opens the Scenarios form with the situation, the segment and the companies picked", () => {
        const href = simulateHref({
            segmentId: "seg-1",
            companyIds: ["d1", "d2"],
            subject: "How would cafés respond?",
        });
        const url = new URL(href, "https://app.example");
        expect(url.searchParams.get("feature")).toBe("scenarios");
        const at = url.searchParams.get("at")!;
        expect(scenariosScreenFor(at)).toEqual({ kind: "new" });
        const query = new URLSearchParams(parseToolHref(at).search);
        expect(query.get("subject")).toBe("How would cafés respond?");
        expect(query.get("segment")).toBe("seg-1");
        expect(query.get("prospects")).toBe("d1,d2");
    });

    it("leaves out what was not given", () => {
        const at = new URL(
            simulateHref({ segmentId: null }),
            "https://app.example"
        ).searchParams.get("at");
        expect(at).toBe("/new");
    });
});
