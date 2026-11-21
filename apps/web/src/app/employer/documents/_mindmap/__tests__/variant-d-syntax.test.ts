import {
    normalizeLabel,
    parseSteps,
    stepKindOf,
    stepOnLine,
    type StepsParse,
} from "../model/flowchart/syntax";

/**
 * Direction D's step language: one step per line, `?` for a decision,
 * indented `Label: step` branches, `-> Step` jumps, Start/End pills. Each rule
 * is pinned here, and so is what happens to everything that breaks one —
 * the parser must never throw and must never draw something surprising from a
 * half-typed line.
 */

/** Links as `from → to [label]`, by step label, sorted. */
function arrows(p: StepsParse): string[] {
    return p.links
        .map(l => {
            const from = p.steps[l.from]!.label;
            const to = p.steps[l.to]!.label;
            return `${from} → ${to}${l.label ? ` [${l.label}]` : ""}`;
        })
        .sort();
}

const kinds = (p: StepsParse) => p.steps.map(s => `${s.kind}:${s.label}`);

describe("step kinds", () => {
    it("reads Start and End, in any case and in Chinese, as pills", () => {
        expect(stepKindOf("Start")).toBe("start");
        expect(stepKindOf("  end ")).toBe("end");
        expect(stepKindOf("START")).toBe("start");
        expect(stepKindOf("开始")).toBe("start");
        expect(stepKindOf("结束")).toBe("end");
    });

    it("only when the line is exactly that word", () => {
        expect(stepKindOf("Start the timer")).toBe("step");
        expect(stepKindOf("The end")).toBe("step");
    });

    it("reads a trailing ? or ？ as a decision", () => {
        expect(stepKindOf("In stock?")).toBe("decision");
        expect(stepKindOf("有货吗？")).toBe("decision");
        expect(stepKindOf("Why? Because")).toBe("step");
    });

    it("compares labels without case, spacing or closing punctuation", () => {
        expect(normalizeLabel("  In   Stock? ")).toBe("in stock");
        expect(normalizeLabel("Ship it.")).toBe(normalizeLabel("ship IT"));
        expect(normalizeLabel("有货吗？")).toBe("有货吗");
    });
});

describe("one step per line", () => {
    it("joins consecutive lines in order", () => {
        const p = parseSteps("Take the order\nPack it\nShip it");
        expect(kinds(p)).toEqual(["step:Take the order", "step:Pack it", "step:Ship it"]);
        expect(arrows(p)).toEqual(["Pack it → Ship it", "Take the order → Pack it"]);
    });

    it("ignores blank lines, and joins across them", () => {
        const p = parseSteps("\nA\n\n   \nB\n\n");
        expect(kinds(p)).toEqual(["step:A", "step:B"]);
        expect(arrows(p)).toEqual(["A → B"]);
        expect(p.steps.map(s => s.line)).toEqual([1, 4]);
    });

    it("reads Windows line endings", () => {
        expect(arrows(parseSteps("A\r\nB\r\n"))).toEqual(["A → B"]);
    });

    it("never joins out of End", () => {
        const p = parseSteps("Start\nWork\nEnd\nStart\nMore\nEnd");
        expect(kinds(p).filter(k => k.startsWith("end"))).toHaveLength(2);
        expect(arrows(p)).toEqual(["More → End", "Start → More", "Start → Work", "Work → End"]);
    });

    it("draws an empty text as nothing", () => {
        const p = parseSteps("");
        expect(p.steps).toEqual([]);
        expect(p.links).toEqual([]);
        expect(p.notes).toEqual([]);
    });
});

describe("decisions and branches", () => {
    const text = [
        "Start",
        "Receive the order",
        "In stock?",
        "  Yes: Pick and pack",
        "  No: Reorder from supplier -> Receive the order",
        "Ship it",
        "End",
    ].join("\n");

    it("draws the example: one decision, two branches, a loop back", () => {
        const p = parseSteps(text);
        expect(kinds(p)).toEqual([
            "start:Start",
            "step:Receive the order",
            "decision:In stock?",
            "step:Pick and pack",
            "step:Reorder from supplier",
            "step:Ship it",
            "end:End",
        ]);
        expect(arrows(p)).toEqual([
            "In stock? → Pick and pack [Yes]",
            "In stock? → Reorder from supplier [No]",
            "Pick and pack → Ship it",
            "Receive the order → In stock?",
            "Reorder from supplier → Receive the order",
            "Ship it → End",
            "Start → Receive the order",
        ]);
        expect(p.notes).toEqual([]);
    });

    it("files branch steps under their decision", () => {
        const p = parseSteps(text);
        const decision = p.steps.findIndex(s => s.kind === "decision");
        expect(p.steps.filter(s => s.branchOf === decision).map(s => s.label)).toEqual([
            "Pick and pack",
            "Reorder from supplier",
        ]);
        expect(p.lines[3]!.branch).toBe(true);
        expect(p.lines[3]!.branchLabel).toBe("Yes");
    });

    it("accepts a tab as the indent, and full-width colons", () => {
        const p = parseSteps("有货吗？\n\t有：打包\n  没有：补货\n发货");
        expect(arrows(p)).toEqual([
            "打包 → 发货",
            "有货吗？ → 打包 [有]",
            "有货吗？ → 补货 [没有]",
            "补货 → 发货",
        ]);
    });

    it("does not join a decision with branches straight to the next line", () => {
        const p = parseSteps("Paid?\n  Yes: Ship\nDone");
        expect(arrows(p)).not.toContain("Paid? → Done");
    });

    it("joins a decision with no branches yet to the next line, as a step", () => {
        expect(arrows(parseSteps("Paid?\nDone"))).toEqual(["Paid? → Done"]);
    });

    it("reads a bare `Label: -> Step` as an arrow from the decision", () => {
        const p = parseSteps("Start\nPaid?\n  Yes: Ship\n  No: -> Start\nEnd");
        expect(arrows(p)).toContain("Paid? → Start [No]");
        expect(p.steps.map(s => s.label)).not.toContain("");
        expect(stepOnLine(p, 3)).toBe(1); // the bare arrow belongs to the decision
    });

    it("reads a bare `Label:` as a labelled arrow to the next top-level line", () => {
        const p = parseSteps("Paid?\n  No: Ask again -> Paid?\n  Yes:\nShip");
        expect(arrows(p)).toEqual([
            "Ask again → Paid?",
            "Paid? → Ask again [No]",
            "Paid? → Ship [Yes]",
        ]);
    });

    it("lets an unlabelled branch line be a branch too", () => {
        const p = parseSteps("Paid?\n  Ship\nDone");
        expect(arrows(p)).toEqual(["Paid? → Ship", "Ship → Done"]);
    });

    it("ends a branch at End", () => {
        const p = parseSteps("Paid?\n  No: End\n  Yes: Ship\nThank them");
        expect(arrows(p)).toEqual(["Paid? → End [No]", "Paid? → Ship [Yes]", "Ship → Thank them"]);
    });

    it("reads a colon after a long phrase as part of the step, not a label", () => {
        const p = parseSteps("Paid?\n  Call the customer and explain the problem: then wait\nDone");
        expect(p.steps[1]!.label).toBe("Call the customer and explain the problem: then wait");
        expect(p.lines[1]!.branchLabel).toBeNull();
    });

    it("lets a branch end the text without dangling", () => {
        const p = parseSteps("Paid?\n  Yes: Ship\n  No: Cancel");
        expect(arrows(p)).toEqual(["Paid? → Cancel [No]", "Paid? → Ship [Yes]"]);
    });

    it("keeps a top-level line's colon in its words", () => {
        expect(parseSteps("Note: call first").steps[0]!.label).toBe("Note: call first");
    });
});

describe("arrows written out", () => {
    it("sends a top-level step somewhere other than the next line", () => {
        const p = parseSteps("A\nB -> D\nC\nD");
        expect(arrows(p)).toEqual(["A → B", "B → D", "C → D"]);
    });

    it("finds the target without case, spacing or its question mark", () => {
        const p = parseSteps("In stock?\n  No: Wait -> in  STOCK\nShip");
        expect(arrows(p)).toContain("Wait → In stock?");
        expect(p.lines[1]!.targetStep).toBe(0);
    });

    it("reads → and long arrows as arrows", () => {
        expect(arrows(parseSteps("A → C\nB\nC"))).toContain("A → C");
        expect(arrows(parseSteps("A ---> C\nB\nC"))).toContain("A → C");
    });

    it("adds a bare `-> X` under a step as another arrow out of it", () => {
        const p = parseSteps("Notify\n-> Email\n-> Slack\nEmail\nSlack");
        expect(arrows(p)).toEqual(["Email → Slack", "Notify → Email", "Notify → Slack"]);
        expect(stepOnLine(p, 1)).toBe(0);
    });

    it("reads a bare `-> X` under a decision as an unlabelled branch", () => {
        const p = parseSteps("Paid?\n  Yes: Ship\n-> Paid?\nDone");
        expect(arrows(p)).toContain("Paid? → Paid?");
    });

    it("takes `A ->` with nothing after it yet as the step A", () => {
        const p = parseSteps("A ->\nB");
        expect(kinds(p)).toEqual(["step:A", "step:B"]);
        expect(arrows(p)).toEqual(["A → B"]);
        expect(p.notes).toEqual([]);
    });

    it("draws the same jump once", () => {
        const p = parseSteps("A -> C\n-> C\nB\nC");
        expect(arrows(p).filter(a => a === "A → C")).toHaveLength(1);
    });

    it("jumps to the first of two steps with the same words", () => {
        const p = parseSteps("Check\nFix\nCheck\nRetry -> Check");
        expect(p.lines[3]!.targetStep).toBe(0);
    });

    it("lets a step jump to itself", () => {
        expect(arrows(parseSteps("Wait -> Wait\nGo"))).toEqual(["Wait → Wait"]);
    });
});

describe("what cannot be read becomes a note, never an error", () => {
    it("notes an arrow to words no step has, and draws no arrow for it", () => {
        const p = parseSteps("A -> Nowhere\nB");
        expect(p.notes).toEqual([{ line: 0, kind: "missingTarget", target: "Nowhere" }]);
        // A step that jumps does not also flow on, even while the target is mistyped.
        expect(arrows(p)).toEqual([]);
        expect(p.lines[0]!.targetStep).toBeNull();
    });

    it("notes a branch indented under a plain step and draws it as a step", () => {
        const p = parseSteps("A\n  Yes: B\nC");
        expect(p.notes).toEqual([{ line: 1, kind: "notUnderQuestion" }]);
        expect(kinds(p)).toEqual(["step:A", "step:Yes: B", "step:C"]);
        expect(arrows(p)).toEqual(["A → Yes: B", "Yes: B → C"]);
    });

    it("notes an indented first line", () => {
        const p = parseSteps("  Yes: B");
        expect(p.notes[0]!.kind).toBe("notUnderQuestion");
        expect(p.steps).toHaveLength(1);
    });

    it("notes an arrow with no step above it", () => {
        const p = parseSteps("-> A\nA");
        expect(p.notes).toEqual([{ line: 0, kind: "arrowWithoutStep" }]);
        expect(p.links).toEqual([]);
    });

    it("treats a lone colon under a decision as blank", () => {
        const p = parseSteps("Paid?\n  :\nShip");
        expect(p.lines[1]!.blank).toBe(true);
        expect(arrows(p)).toEqual(["Paid? → Ship"]);
    });

    it("survives anything thrown at it", () => {
        const junk = [
            "->",
            "-> -> ->",
            "?",
            "  ?",
            ":",
            "\t\t:->",
            "Yes: -> ",
            "→→",
            "A -> A -> A",
            "   \t ",
            "x".repeat(2000),
            "🙂 -> 🙂",
        ].join("\n");
        expect(() => parseSteps(junk)).not.toThrow();
        const p = parseSteps(junk);
        for (const l of p.links) {
            expect(p.steps[l.from]).toBeDefined();
            expect(p.steps[l.to]).toBeDefined();
        }
    });

    it("keeps ranges that point at the words as written", () => {
        const p = parseSteps("  Yes:  Pick it  ->  Start ");
        // No decision above: read as a step, with a note.
        expect(p.notes[0]!.kind).toBe("notUnderQuestion");
        const q = parseSteps("Paid?\n  Yes:  Pick it  ->  Start \nStart");
        const l = q.lines[1]!;
        expect(l.text.slice(...l.labelRange!)).toBe("Pick it");
        expect(l.text.slice(...l.targetRange!)).toBe("Start");
        expect(l.text.slice(...l.branchLabelRange!)).toBe("Yes");
    });
});
