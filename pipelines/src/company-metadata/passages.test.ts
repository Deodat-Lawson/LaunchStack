/**
 * The passage filter: what it removes before a model reads a chunk, what it
 * must never remove, and the verbatim-quote check the builder grounds facts
 * with. Fixtures are short synthetic strings shaped like the real noise —
 * a PDF's flowed bibliography, result tables and chart residue, the
 * chunker's overlap, and an empty mindmap.
 */
import { describe, expect, it } from "vitest";

import {
    stripInlineMarkdown,
    DROP_REASONS,
    cleanPassages,
    explainPassages,
    normalizeForMatch,
    quoteAppearsIn,
    type RawChunk,
} from "./passages";

let nextId = 1;
function chunk(content: string, page: number | null = 1): RawChunk {
    return { id: nextId++, content, page, semanticType: "narrative" };
}

function clean(contents: string[], title = "Acme overview") {
    return cleanPassages(
        contents.map(content => chunk(content)),
        { title }
    );
}

/** The one passage a single-chunk document produced (fails the test if dropped). */
function keptText(content: string, title = "Acme overview"): string {
    const result = clean([content], title);
    expect(result.kept).toBe(1);
    return result.passages[0]?.text ?? "";
}

function droppedAs(content: string, title = "Acme overview") {
    const [verdict] = explainPassages([chunk(content)], { title });
    expect(verdict?.passage).toBeNull();
    return verdict?.reason;
}

const occurrences = (text: string, needle: string) => text.split(needle).length - 1;

const PROSE =
    "LaunchStack is an open-source startup operating system for founders. " +
    "It turns a team's documents into a searchable workspace with cited answers.";

// ---------------------------------------------------------------------------

describe("cleanPassages — shape", () => {
    it("reports totals that add up and keeps chunk ids and pages", () => {
        const chunks = [chunk(PROSE, 3), chunk("- (untitled)\n  - (untitled)", null)];
        const result = cleanPassages(chunks, { title: "Acme overview" });

        expect(result.total).toBe(2);
        expect(result.kept).toBe(1);
        expect(result.passages).toEqual([{ chunkId: chunks[0]!.id, page: 3, text: PROSE }]);
        expect(Object.keys(result.dropped).sort()).toEqual([...DROP_REASONS].sort());
        const droppedTotal = DROP_REASONS.reduce((sum, r) => sum + result.dropped[r], 0);
        expect(result.kept + droppedTotal).toBe(result.total);
    });

    it("handles an empty document", () => {
        const result = cleanPassages([], { title: "Empty" });
        expect(result).toMatchObject({ passages: [], total: 0, kept: 0 });
    });

    it("strips the stored breadcrumb header", () => {
        const text = keptText(`Acme handbook › Company › Mission\n\n${PROSE}`);
        expect(text).toBe(PROSE);
    });

    it("strips a leading repeat of the document title (PDF file name)", () => {
        const text = keptText(`2312.06648v3.pdf\n\n${PROSE}`, "2312.06648v3.pdf");
        expect(text).toBe(PROSE);
        // A title-only header (mindmap root) goes too.
        const outline = keptText(
            "Launch plan\n\n- Ship the Gmail connector to every workspace\n- Hire a founding designer",
            "Launch plan"
        );
        expect(outline.startsWith("- Ship")).toBe(true);
    });
});

describe("cleanPassages — keeps company facts", () => {
    const onePager = [
        "Acme one-pager › About",
        "",
        "LaunchStack is an open-source startup operating system for founders.",
        "Founded in 2024 · Headquarters: Baltimore, MD",
        "Jane Doe — CEO, jane@acme.com",
        "Starter: $29/month for 3 seats",
        "Our mission is to give every founder a chief of staff that never forgets.",
        "Products:",
        "- Workspace Search",
        "- Prospects",
        "- Brand Studio",
        "ARR grew from $0.4M to $1.2M in 2025, with 140 paying teams across 12 countries.",
    ].join("\n");

    it("keeps every first-party line verbatim", () => {
        const result = clean([onePager]);
        expect(result.kept).toBe(1);
        const text = result.passages[0]!.text;
        for (const line of onePager.split("\n").slice(2)) expect(text).toContain(line);
        expect(DROP_REASONS.every(r => result.dropped[r] === 0)).toBe(true);
    });

    it("removes nothing from the one-pager", () => {
        const [verdict] = explainPassages([chunk(onePager)], { title: "Acme one-pager" });
        expect(DROP_REASONS.every(r => verdict!.removed[r] === 0)).toBe(true);
    });

    it("keeps a company sentence that names a conference", () => {
        const text = keptText(
            `${PROSE} Our CEO spoke at the International Conference on Machine Learning in 2024.`
        );
        expect(text).toContain("International Conference on Machine Learning");
    });

    it("keeps a team list that is not next to any citation", () => {
        const text = keptText(`${PROSE}\nFounders: Jane Doe, John Roe, and Ana Lopez.`);
        expect(text).toContain("Founders: Jane Doe, John Roe, and Ana Lopez.");
    });

    it("keeps a customer 'References' section that has no citations in it", () => {
        const text = keptText(
            [
                PROSE,
                "References",
                "- Northwind Dental: cut onboarding from two weeks to three days.",
                "- Globex Clinics: rolled out to 40 locations in 2025.",
            ].join("\n")
        );
        expect(text).toContain("Northwind Dental");
        expect(text).toContain("Globex Clinics");
    });
});

describe("cleanPassages — references", () => {
    const entries =
        "Zeynep Akkalyoncu Yilmaz, Wei Yang, Haotian Zhang, and Jimmy Lin. 2019. Cross-domain " +
        "modeling of sentence-level evidence for document retrieval. In Proceedings of the 2019 " +
        "Conference on Empirical Methods in Natural Language Processing, pages 3490– 3496, Hong " +
        "Kong, China. Association for Computa- tional Linguistics. Jonathan Berant, Andrew Chou, " +
        "Roy Frostig, and Percy Liang. 2013. Semantic parsing on freebase from question-answer " +
        "pairs. In Proceedings of the 2013 conference on empirical methods in natural language " +
        "processing , pages 1533–1544. Luyu Gao and Jamie Callan. 2022. Unsupervised corpus aware " +
        "language model pre-training for dense passage retrieval. In Proceedings of the 60th " +
        "Annual Meeting of the Association for Computational Linguistics, pages 2843–2853, " +
        "Dublin, Ireland. Association for Computational Linguistics. Tianyu Gao, Xingcheng Yao, " +
        "and Danqi Chen. 2021. Simcse: Simple contrastive learning of sentence embeddings. arXiv " +
        "preprint arXiv:2104.08821 .";

    it("drops a chunk that is all bibliography", () => {
        expect(droppedAs(`2312.06648v3.pdf\n\n${entries}`, "2312.06648v3.pdf")).toBe("references");
    });

    it("keeps the narrative before a References heading and drops what follows", () => {
        const narrative =
            "We thank the reviewers for helpful discussions and comments on an earlier draft of " +
            "this paper. Dense retrieval has become a prominent method to obtain relevant context.";
        const text = keptText(`${narrative}  References  ${entries}`);
        expect(text).toContain("Dense retrieval has become a prominent method");
        expect(text).not.toContain("References");
        // The cities that once became the company's "geography".
        expect(text).not.toContain("Hong Kong");
        expect(text).not.toContain("Dublin");
        expect(text).not.toContain("Proceedings");
    });

    it("drops entries that run straight into narrative and keeps the narrative", () => {
        const appendix =
            "A   Retrieval Corpus Processing  The English Wikipedia dump used in this study, " +
            "released by Bohnet et al., 2022, was selected because it is organized into " +
            "paragraphs. We divide only at the end of sentences to keep passages whole.";
        const text = keptText(`${entries} ${appendix}`);
        expect(text).toContain("The English Wikipedia dump used in this study");
        expect(text).not.toContain("Jimmy Lin");
        expect(text).not.toContain("Semantic parsing on freebase");
    });

    it("drops APA-style entries listed one per line", () => {
        const apa = [
            "Smith, J., & Doe, A. (2020). Deep learning for clinics. Journal of Health Systems, 12(3), 45–67.",
            "Lee, K. (2019). Scheduling under uncertainty. Operations Research Letters, 47(2), 101–109.",
            "Park, S., & Kim, H. (2021). Patient no-shows. Journal of Medical Systems, 45(1), 1–12. https://doi.org/10.1000/jms.2021",
        ].join("\n");
        expect(droppedAs(apa)).toBe("references");
    });

    it("never kills a sentence for an inline citation", () => {
        const narrative =
            "Dense retrievers are a popular class of techniques for accessing external " +
            "information sources (Karpukhin et al., 2020). Following Chen et al. (2023b), we " +
            "train the model with a two-step distillation process (Chen et al., 2023; Lee et " +
            "al., 2021a). Natural Questions (NQ, Kwiatkowski et al., 2019) is one of five datasets.";
        expect(keptText(narrative)).toBe(narrative);
    });
});

describe("cleanPassages — tables and figures", () => {
    const tableRows =
        "Retriever   Granularity   NQ   TQA   WebQ   SQuAD   EQ   Avg. R@5   R@20   R@5   R@20 " +
        "  R@5   R@20 Unsupervised Dense Retrievers SimCSE   Passage   28.8   44.3   44.9   59.4 " +
        "  39.8   56.0   29.5   45.5 Sentence   35.5   53.1   50.5   64.3   45.3   64.1   37.1 " +
        "  52.3  Proposition   41.1   58.9   52.4   66.5   50.0   66.8   38.7   53.9";
    const figureResidue =
        "0   200   400  #Words  20  30  40  50  Recall (%)  Contriever / NQ  0   200   400  " +
        "#Words  40  50  60  70  Recall (%)  Contriever / TQA  0   200   400  #Words  20  30  " +
        "40  50  Recall (%)  Contriever / WebQ  Passage   Sentence   Proposition";

    it("drops a chunk that is a numeric result table", () => {
        expect(droppedAs(tableRows)).toBe("table");
    });

    it("drops a chunk that is chart axis and legend residue", () => {
        expect(droppedAs(figureResidue)).toBe("figure");
    });

    it("drops a chunk left with only the table's caption", () => {
        expect(
            droppedAs(`${tableRows}  Table 3: Passage retrieval performance on five datasets.`)
        ).toBe("table");
    });

    it("cuts a table out of the prose around it", () => {
        const before =
            "Within each proposition, necessary context from the passage is incorporated so " +
            "that its meaning can be interpreted independently.";
        const after =
            "We expect each proposition to describe exactly one atomic fact, and so it works " +
            "well as a retrieval unit for information-seeking questions.";
        const text = keptText(
            `${before} # units   Avg. # words Passages   41,393,528   58.5 Sentences   ` +
                `114,219,127   21.0 Propositions   256,885,003   11.2  Table 1: Statistics of ` +
                `text units in the English Wikipedia. ${after}`
        );
        expect(text).toContain(before);
        expect(text).toContain("Table 1: Statistics of text units in the English Wikipedia.");
        expect(text).toContain(after);
        expect(text).not.toMatch(/41,393,528|256,885,003/);
    });

    it("cuts figure residue and its legend but keeps the caption and prose", () => {
        const text = keptText(
            `We prompt the model with four-shot demonstrations for each test case. ${figureResidue} ` +
                "Figure 4: Recall of the gold answer in the retrieved text limited to the first k " +
                "words. The motivation of our work echoes multi-vector retrieval."
        );
        expect(text).toContain("We prompt the model with four-shot demonstrations");
        expect(text).toContain("Figure 4: Recall of the gold answer");
        expect(text).toContain("The motivation of our work echoes multi-vector retrieval.");
        expect(text).not.toMatch(/#Words|Contriever \/ NQ|0 200 400/);
    });

    it("keeps sentences that merely quote a few numbers", () => {
        const prose =
            "With the unsupervised retrievers we see an averaged Recall@5 improvement of +12.0 " +
            "and +9.3 (35.0% and 22.5% relative improvement) on five datasets. The AdamW " +
            "optimizer was used with a batch size of 64, learning rate of 1e-4, weight decay of " +
            "1e-4, and 3 epochs. Our 2023 revenue was 1.2, 2024 was 3.4, and 2025 is 7.9 ($M).";
        expect(keptText(prose)).toBe(prose);
    });

    it("keeps comma-separated number lists and phone numbers", () => {
        const prose =
            "We offer 10, 20, 50, 100, 250, 500 and 1000 seat plans to clinics of every size.\n" +
            "Phone: +1 410 555 0100 · Fax: +1 410 555 0101";
        expect(keptText(prose)).toBe(prose);
    });

    it("drops a markdown table rule but keeps a pricing table's cells", () => {
        const text = keptText(
            [
                "Pricing, billed annually:",
                "| Plan | Price | Seats |",
                "|---|---|---|",
                "| Starter | $29/month | 3 |",
                "| Team | $99/month | 10 |",
                "| Business | $299/month | 50 |",
            ].join("\n")
        );
        expect(text).toContain("| Starter | $29/month | 3 |");
        expect(text).not.toContain("|---|");
    });
});

describe("cleanPassages — duplicates", () => {
    const first =
        "Acme builds scheduling software for dental clinics across the United States and " +
        "Canada. Clinics use it to fill cancelled appointments within minutes, which recovers " +
        "revenue that would otherwise be lost to empty chairs every single week of the year.";
    // The chunker's overlap: the next piece re-opens ~150 characters back, mid-word.
    const cut = first.indexOf("ancelled");
    const overlap = first.slice(cut);
    const next =
        " The company was founded in 2024 in Baltimore and now serves more than four hundred " +
        "practices.";

    it("removes the overlap repeated between two pieces of one chunk and rejoins the word", () => {
        const text = keptText(`${first}\n${overlap}${next}`);
        expect(occurrences(text, "every single week of the year")).toBe(1);
        expect(text).toContain("The company was founded in 2024 in Baltimore");
        expect(text).not.toMatch(/\bancelled\b/);
    });

    it("removes the overlap a chunk repeats from the previous chunk", () => {
        const result = clean([first, `${overlap}${next}`]);
        expect(result.kept).toBe(2);
        const second = result.passages[1]!.text;
        expect(second).not.toContain("every single week of the year");
        expect(second.startsWith("The company was founded")).toBe(true);
    });

    it("drops the second copy of a passage the document already holds", () => {
        const result = clean([PROSE, PROSE]);
        expect(result.kept).toBe(1);
        expect(result.dropped.duplicate).toBe(1);
    });

    it("drops a repeated long sentence, keeping the rest of the chunk", () => {
        const notice =
            "The gray text is the context of propositions and is for illustration purposes only.";
        const other =
            "Table 7 lists further examples where every retrieval granularity fails to answer.";
        const result = clean([`${PROSE} ${notice}`, `${other} ${notice}`]);
        const second = result.passages[1]?.text ?? "";
        expect(result.passages[0]!.text).toContain(notice);
        expect(second).toBe(other);
    });

    it("does not treat short repeated outline lines as overlap", () => {
        const text = keptText(
            "- Hiring plan for the platform team\n  - Two senior engineers\n" +
                "- Hiring plan for the platform team\n  - One designer"
        );
        expect(occurrences(text, "Hiring plan for the platform team")).toBe(2);
    });
});

describe("cleanPassages — boilerplate", () => {
    it("drops notices, page numbers and contents lines but keeps the prose", () => {
        const text = keptText(
            [
                "Table of contents",
                "Introduction ........................ 3",
                PROSE,
                "© 2025 Acme Inc. All rights reserved.",
                "Confidential — do not distribute.",
                "Page 3 of 12",
                "12",
            ].join("\n")
        );
        expect(text).toBe(`Introduction\n${PROSE}`);
    });

    it("drops a chunk that is only boilerplate", () => {
        expect(
            droppedAs(
                "© 2025 Acme Inc. All rights reserved.\n" +
                    "This document is confidential and intended only for the named recipient.\n" +
                    "Page 4 of 12"
            )
        ).toBe("boilerplate");
    });

    it("strips the arXiv margin stamp and the page number of a flowed PDF line", () => {
        const flowed =
            "Dense retrievers are a popular class of techniques for accessing external " +
            "information sources for open-domain tasks, and an often-overlooked design choice " +
            "is the retrieval unit in which the corpus is indexed. We investigate whether " +
            "fine-grained units can replace passages in downstream question answering tasks 1  " +
            "arXiv:2312.06648v3 [cs.CL] 4 Oct 2024";
        const text = keptText(flowed);
        expect(text).not.toContain("arXiv");
        expect(text.endsWith("question answering tasks")).toBe(true);
    });
});

describe("cleanPassages — mindmaps", () => {
    it("drops a mindmap that is only placeholders", () => {
        expect(droppedAs("Untitled mindmap › (untitled)\n\n- (untitled)\n  - (untitled)\n-")).toBe(
            "placeholder"
        );
    });

    it("drops placeholder nodes and keeps the named ones in outline form", () => {
        const text = keptText(
            [
                "Go-to-market › (untitled)",
                "",
                "- Channels",
                "  - (untitled)",
                "  - Dental service organisations in the mid-Atlantic",
                "- Pricing",
                "  - Starter: $29/month for 3 seats",
                "  -",
            ].join("\n"),
            "Go-to-market"
        );
        expect(text).toBe(
            [
                "- Channels",
                "  - Dental service organisations in the mid-Atlantic",
                "- Pricing",
                "  - Starter: $29/month for 3 seats",
            ].join("\n")
        );
    });

    it("drops a mindmap with too little text as too_short", () => {
        expect(droppedAs("Cause and effect\n\n- Problem", "Cause and effect")).toBe("too_short");
    });
});

// ---------------------------------------------------------------------------

describe("normalizeForMatch", () => {
    it("unifies quotes and dashes, folds case and whitespace", () => {
        expect(normalizeForMatch("  “Acme’s”   Plan —\tStarter  ")).toBe(`"acme's" plan - starter`);
    });

    it("joins words split by a line-break hyphen, and only those", () => {
        expect(normalizeForMatch("doc- ument")).toBe("document");
        expect(normalizeForMatch("pre-\ntrained")).toBe("pretrained");
        expect(normalizeForMatch("state-of-the-art")).toBe("state-of-the-art");
    });

    it("applies NFKC and drops soft hyphens", () => {
        expect(normalizeForMatch("ﬁnancial of\u00ADfice")).toBe("financial office");
    });

    it("closes the space PDF text puts before punctuation", () => {
        expect(normalizeForMatch("a novel unit , proposition , for retrieval .")).toBe(
            "a novel unit, proposition, for retrieval."
        );
    });
});

describe("quoteAppearsIn", () => {
    const passage =
        "Propositions are defined as atomic expressions within text, each encapsulating a " +
        "distinct factoid and pre- sented in a concise, self-contained natural lan- guage " +
        "format. Acme’s “Starter” plan costs $29/month — billed annually. We use an open- source " +
        "retriever.";

    it("accepts a verbatim quote", () => {
        expect(quoteAppearsIn("atomic expressions within text", passage)).toBe(true);
    });

    it("accepts a quote that differs only in case, spacing, hyphenation or quote marks", () => {
        expect(quoteAppearsIn("Each encapsulating a distinct   factoid", passage)).toBe(true);
        expect(
            quoteAppearsIn(
                "presented in a concise, self-contained natural language format",
                passage
            )
        ).toBe(true);
        expect(
            quoteAppearsIn(`Acme's "Starter" plan costs $29/month - billed annually`, passage)
        ).toBe(true);
        expect(quoteAppearsIn("We use an open-source retriever.", passage)).toBe(true);
    });

    it("accepts a quote the model wrapped in quote marks or trailed with an ellipsis", () => {
        expect(quoteAppearsIn("“atomic expressions within text…”", passage)).toBe(true);
    });

    it("rejects paraphrases and changed words", () => {
        expect(quoteAppearsIn("propositions are atomic statements in text", passage)).toBe(false);
        expect(quoteAppearsIn("Acme's Starter plan costs $39/month", passage)).toBe(false);
        expect(
            quoteAppearsIn("expressions within text, each encapsulating two factoids", passage)
        ).toBe(false);
    });

    it("rejects quotes under twelve characters", () => {
        expect(quoteAppearsIn("atomic", passage)).toBe(false);
        expect(quoteAppearsIn("   “$29”   ", passage)).toBe(false);
    });

    it("rejects a quote that spans text the filter removed", () => {
        const text = keptText(
            "Clinics use Acme to fill cancelled appointments within minutes.\n" +
                "© 2025 Acme Inc. All rights reserved.\n" +
                "The company was founded in 2024 in Baltimore."
        );
        expect(quoteAppearsIn("within minutes. © 2025 Acme Inc.", text)).toBe(false);
        expect(quoteAppearsIn("The company was founded in 2024 in Baltimore", text)).toBe(true);
    });
});

describe("stripInlineMarkdown", () => {
    it("keeps the words of bold, code, links, images and headings", () => {
        expect(
            stripInlineMarkdown(
                "## Status\n**A TypeScript engine** for `@launchstack/protocol` — see [the guide](docs/x.md) ![CI](b.svg)"
            )
        ).toBe("Status\nA TypeScript engine for @launchstack/protocol — see the guide CI");
    });

    it("lets a quote copied without the markup match the marked-up text", () => {
        const text =
            "**A TypeScript engine for AI-native applications.** Ingestion, OCR, RAG, and `background jobs`.";
        expect(
            quoteAppearsIn(
                "A TypeScript engine for AI-native applications. Ingestion, OCR, RAG",
                text
            )
        ).toBe(true);
        expect(quoteAppearsIn("Ingestion, OCR, RAG, and background jobs", text)).toBe(true);
    });

    it("leaves snake_case and arithmetic alone", () => {
        expect(stripInlineMarkdown("set MAX_RETRIES to 2 * 3 * 4")).toBe(
            "set MAX_RETRIES to 2 * 3 * 4"
        );
    });
});
