/**
 * Chips in a chat message, as the composer writes them and as the model
 * should read them (lib/source-mentions.ts).
 */
import {
    MENTION_NAME_CHARS,
    folderMentionText,
    mentionedSourceRefs,
    mentionsAsLabels,
    parseMentions,
    quoteName,
    renderMentions,
    renderUploadLinks,
    sourceMentionText,
    threadMentionText,
    unavailableMentionText,
    renderMentionsFor,
    stripMentions,
} from "~/lib/source-mentions";

const SOURCE = "[Source: Q3 board deck](#launchstack-source-d12)";
const FOLDER = "[Folder: Board](#launchstack-folder-Board%2F2026)";
const THREAD = "[Conversation: Pricing call](#launchstack-thread-s_9)";

describe("parsing chips", () => {
    it("reads every chip form with its label and decoded ref, in order", () => {
        const text = `Compare ${SOURCE} with ${FOLDER}, as in ${THREAD}.`;
        expect(parseMentions(text)).toEqual([
            expect.objectContaining({ kind: "source", label: "Q3 board deck", ref: "d12" }),
            expect.objectContaining({ kind: "folder", label: "Board", ref: "Board/2026" }),
            expect.objectContaining({ kind: "thread", label: "Pricing call", ref: "s_9" }),
        ]);
        const [first] = parseMentions(text);
        expect(text.slice(first!.start, first!.end)).toBe(SOURCE);
    });

    it("unescapes the brackets the composer escapes in a label", () => {
        const [mention] = parseMentions(
            String.raw`[Source: Notes \[draft\] \\ final](#launchstack-source-d7)`
        );
        expect(mention).toMatchObject({ label: String.raw`Notes [draft] \ final`, ref: "d7" });
    });

    it("trusts the hash, not the word before the colon, for what a chip points at", () => {
        expect(parseMentions("[Source: x](#launchstack-thread-t1)")[0]).toMatchObject({
            kind: "thread",
            ref: "t1",
        });
    });

    it("lists the source refs once each, and leaves other chips out", () => {
        expect(
            mentionedSourceRefs(
                `${SOURCE} ${FOLDER} ${SOURCE} [Source: Other](#launchstack-source-m3)`
            )
        ).toEqual(["d12", "m3"]);
    });

    it("sees no chip in ordinary text, links or the transcript's quote marker", () => {
        expect(
            parseMentions(
                "Plain words with [a link](https://example.test) and [Source message](#chat-message-abc)"
            )
        ).toEqual([]);
        expect(parseMentions("[Source: unterminated](#launchstack-source-d1")).toEqual([]);
    });
});

describe("rendering chips", () => {
    it("replaces each chip with what the renderer returns and keeps the rest", () => {
        const out = renderMentions(`Compare ${SOURCE} with ${FOLDER}.`, mention =>
            mention.kind === "source"
                ? sourceMentionText("Q3 board deck", "d12")
                : folderMentionText(mention.label)
        );
        expect(out).toBe('Compare "Q3 board deck" (d12) with the folder "Board".');
    });

    it("keeps the label when the renderer has nothing to say", () => {
        expect(renderMentions(`See ${SOURCE}`, () => null)).toBe("See Q3 board deck");
        expect(mentionsAsLabels(`See ${SOURCE} and ${THREAD}`)).toBe(
            "See Q3 board deck and Pricing call"
        );
    });

    it("returns text without chips unchanged, the quote marker included", () => {
        const text = "Why? [Source message](#chat-message-abc)";
        expect(renderMentions(text, () => "X")).toBe(text);
    });

    it("quotes a name on one line, with inner double quotes made single and a long one cut", () => {
        expect(quoteName('Say "hi"\n  twice')).toBe("\"Say 'hi' twice\"");
        const long = quoteName("x".repeat(400));
        expect(long).toHaveLength(MENTION_NAME_CHARS + 2);
        expect(long.endsWith('…"')).toBe(true);
    });

    it("names each kind of chip the way the tools and the transcript do", () => {
        expect(sourceMentionText("Q3 board deck", "d12")).toBe('"Q3 board deck" (d12)');
        expect(unavailableMentionText("Old deck")).toBe('"Old deck" (unavailable)');
        expect(folderMentionText("Board")).toBe('the folder "Board"');
        expect(threadMentionText("Pricing call")).toBe('the conversation "Pricing call"');
    });

    it("turns an upload's link into its name and leaves other links alone", () => {
        const url = "https://files.test/u/abc";
        const text = `Read [notes.txt](${url}) and [the site](https://example.test).`;
        expect(renderUploadLinks(text, [{ name: "notes.txt", url }])).toBe(
            'Read "notes.txt" (attached) and [the site](https://example.test).'
        );
        expect(renderUploadLinks(text, [])).toBe(text);
    });
});

describe("what the person typed, apart from the chips", () => {
    const url = "https://files.test/u/abc";

    it("removes every chip and the given uploads' links, leaving the words", () => {
        expect(
            stripMentions(`Compare ${SOURCE} with ${FOLDER} and [notes.txt](${url}) please`, [url])
        ).toBe("Compare  with  and  please");
        expect(stripMentions(`${SOURCE} ${THREAD}`).trim()).toBe("");
        expect(stripMentions(`See [the site](https://example.test)`, [url])).toBe(
            "See [the site](https://example.test)"
        );
    });
});

describe("rendering for the client, which knows the sources", () => {
    const render = renderMentionsFor([
        { id: "d12", title: "Q3 board deck", documentId: 12 },
        { id: "s1", title: "Staged upload" },
    ]);

    it("names a source by its title and document id, a staged one by its title, an unknown one by its label", () => {
        expect(
            render(
                `${SOURCE}, [Source: Upload](#launchstack-source-s1), [Source: Gone](#launchstack-source-d99), ${FOLDER}`
            )
        ).toBe('"Q3 board deck" (d12), "Staged upload", "Gone", the folder "Board"');
    });
});
