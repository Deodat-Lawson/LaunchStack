import { AGENT_TOOLS, AGENT_TOOL_IDS, agentTool } from "~/lib/agents/tools";

describe("tool registry", () => {
    it("has unique, mention-safe ids with a label and a description", () => {
        expect(new Set(AGENT_TOOL_IDS).size).toBe(AGENT_TOOLS.length);
        for (const tool of AGENT_TOOLS) {
            expect(tool.id).toMatch(/^[a-z][a-z0-9_]*$/);
            expect(tool.label.length).toBeGreaterThan(2);
            expect(tool.description.length).toBeGreaterThan(10);
            expect(tool.surfaces.length).toBeGreaterThan(0);
        }
    });

    it("keeps the four chat capabilities the route honours", () => {
        for (const id of ["retrieval", "web", "reasoning", "attachments"]) {
            expect(agentTool(id)?.surfaces).toContain("chat");
        }
        expect(agentTool("nope")).toBeUndefined();
    });
});
