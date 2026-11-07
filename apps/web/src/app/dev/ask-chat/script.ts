import type { AIChatResponse, AIChatStreamEvent } from "~/app/employer/documents/hooks/useAIChat";

/**
 * Scripted answers for the /dev/ask-chat harness: the event sequence the chat
 * route sends, on sample text, timed like the real thing.
 *
 * - `hidden`: the production shape. The model thinks without sharing its
 *   reasoning, then sends the whole answer in a few chunks at once.
 * - `visible`: a model that streams its reasoning, then the answer token by token.
 * - `fast`: the fast route: barely any thinking, the answer streamed token by token.
 * - `fail`: the model call fails partway.
 */
export type PreviewMode = "hidden" | "visible" | "fast" | "fail";

export interface ScriptedEvent {
    /** Wait before sending this event, in ms. */
    delayMs: number;
    event: AIChatStreamEvent;
}

export interface PreviewRequest {
    searchScope?: string;
    documentId?: number;
    selectedDocumentIds?: number[];
    conversationHistory?: string;
}

export const PREVIEW_TITLES: Record<number, string> = {
    17: "Globex MSA 2026.pdf",
    16: "PickBot v3 field spec.docx",
    12: "Q3 customer interviews.m4a",
};

const CONTRACT_ANSWER = `**Either party can end the Globex MSA, but on different clocks.**

- **Renewal:** it renews automatically for successive 12-month terms unless either side gives notice at least 60 days before the term ends (p. 3).
- **Termination for convenience:** either party may terminate on ninety (90) days' written notice (p. 4).
- **Termination for cause:** a material breach that isn't cured within 30 days of notice ends it immediately (p. 4).

### What this means for you

If you want out at the end of this term, the notice has to go out by **November 1, 2026**. Fees already paid aren't refunded on a convenience termination, so time it to the renewal date.

| Clause | Notice | Page |
|---|---|---|
| Auto-renewal | 60 days before term end | 3 |
| Convenience | 90 days | 4 |
| Material breach | 30-day cure | 4 |`;

const CONTRACT_REASONING = `The question is about renewal and termination in the Globex MSA. The passages cover section 12 (Term and Renewal) on page 3 and section 13 (Termination) on page 4.

Section 12.2: the term renews for successive 12-month periods unless notice is given **60 days** before expiry. Section 13.1 allows termination for convenience on 90 days' notice; 13.2 covers material breach with a 30-day cure period.

The current term ends December 31, 2026, so the non-renewal deadline is November 1. Lead with the practical point, then the three clauses with page numbers, then a small table.`;

const GENERAL_ANSWER = `A **SAFE** (Simple Agreement for Future Equity) is an investment contract: an investor gives you cash now and receives equity later, usually at your next priced round.

- **No interest, no maturity date.** Unlike a convertible note, it isn't debt.
- **A valuation cap and/or discount** sets the price the investor converts at.
- **Post-money SAFEs**, the common standard since 2018, make dilution easier to calculate.

For an early round it's usually the fastest, cheapest paperwork. Watch how several SAFEs stack: each converts separately, so model the dilution before you sign the third one.`;

const GENERAL_REASONING = `No sources are attached, so this is general knowledge plus what the web search returned.

A SAFE is not debt: no interest and no maturity, which is the main contrast with a convertible note. The two economic terms are the valuation cap and the discount. The post-money version is now the common default.

The founder's practical risk is stacking several SAFEs and underestimating dilution, so end on that.`;

function pieces(text: string, size: number): string[] {
    const out: string[] = [];
    for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
    return out;
}

function plural(n: number, one: string, many = `${one}s`): string {
    return `${n} ${n === 1 ? one : many}`;
}

/** The events the chat route would send for this request, in order. */
export function previewScript(request: PreviewRequest, mode: PreviewMode): ScriptedEvent[] {
    const events: ScriptedEvent[] = [];
    const push = (delayMs: number, event: AIChatStreamEvent) => events.push({ delayMs, event });
    const ids =
        request.searchScope === "document" && request.documentId
            ? [request.documentId]
            : request.searchScope === "selected"
              ? (request.selectedDocumentIds ?? [])
              : [];
    const titles = ids.map(id => PREVIEW_TITLES[id] ?? `Document ${id}`);
    const grounded = titles.length > 0;

    if (request.conversationHistory?.trim())
        push(60, {
            type: "step",
            step: { id: "history", label: "Reviewed the conversation so far", state: "done" },
        });
    if (grounded) {
        push(80, {
            type: "step",
            step: {
                id: "search",
                label:
                    titles.length === 1
                        ? `Searching ${titles[0]}`
                        : `Searching ${plural(titles.length, "source")}`,
                state: "active",
            },
        });
        const passages = 5 + titles.length - 1;
        push(850, {
            type: "step",
            step: {
                id: "search",
                label: `Found ${plural(passages, "passage")} in ${plural(titles.length, "source")}`,
                state: "done",
                detail: titles.slice(0, 3).join(", "),
            },
        });
    } else {
        push(80, {
            type: "step",
            step: {
                id: "search",
                label: "No sources selected",
                state: "done",
                detail: "Answering from general knowledge",
            },
        });
        push(30, {
            type: "step",
            step: { id: "web", label: "Searching the web", state: "active" },
        });
        push(1300, {
            type: "step",
            step: {
                id: "web",
                label: "Read 4 web results",
                state: "done",
                detail: "ycombinator.com, sec.gov, carta.com",
            },
        });
    }

    push(40, { type: "status", status: "generating" });
    push(10, { type: "step", step: { id: "think", label: "Thinking", state: "active" } });
    const reasoning = grounded ? CONTRACT_REASONING : GENERAL_REASONING;
    const answer = grounded ? CONTRACT_ANSWER : GENERAL_ANSWER;

    if (mode === "fail") {
        push(1600, { type: "error", message: "The chat response failed. Please retry." });
        return events;
    }
    if (mode === "visible") {
        for (const delta of pieces(reasoning, 7)) push(28, { type: "reasoning", delta });
    }
    const firstWordAfter = mode === "visible" ? 250 : mode === "fast" ? 350 : 2800;
    const streamed = mode === "visible" || mode === "fast";
    const answerPieces = streamed
        ? pieces(answer, 5)
        : pieces(answer, Math.ceil(answer.length / 3));
    answerPieces.forEach((delta, i) => {
        if (i === 0) {
            push(firstWordAfter, {
                type: "step",
                step: { id: "think", label: "Thought it through", state: "done" },
            });
            push(0, {
                type: "step",
                step: { id: "write", label: "Writing the answer", state: "active" },
            });
        }
        push(i === 0 ? 0 : streamed ? 22 : 40, { type: "text", delta });
    });
    push(60, { type: "step", step: { id: "write", label: "Wrote the answer", state: "done" } });
    push(20, { type: "status", status: "finalizing" });

    const response: AIChatResponse = {
        success: true,
        summarizedAnswer: answer,
        references: grounded
            ? [
                  {
                      documentId: ids[0],
                      page: 3,
                      snippet:
                          "This Agreement renews automatically for successive twelve (12) month terms unless either party gives notice at least sixty (60) days before the end of the then-current term.",
                  },
                  {
                      documentId: ids[0],
                      page: 4,
                      snippet:
                          "Either party may terminate this Agreement for convenience on ninety (90) days' written notice.",
                  },
                  ...ids.slice(1, 2).map(id => ({
                      documentId: id,
                      page: 2,
                      snippet:
                          "Field units ship with a 12-month service term that follows the master agreement.",
                  })),
              ]
            : undefined,
        chunksAnalyzed: grounded ? 5 + titles.length - 1 : 0,
        tokenUsage: { inputTokens: 3412, outputTokens: 286, totalTokens: 3698 },
        searchScope: grounded ? (ids.length > 1 ? "selected" : "document") : "none",
    };
    push(30, { type: "result", response });
    return events;
}
