// Pure question/document lexical ranking shared with the offline evaluator.
export const LEXICAL_SPEC = Object.freeze({
    version: "question-bm25-counterfactual/1",
    k1: 1.2,
    b: 0.75,
    titleWeight: 3,
    minTokenCharacters: 3,
    stopwords:
        "the and for with from that this what which when where who how does are was were can could would should have has had its their they them into about between than then also any all each you your",
    tieBreak: "upstream pathname ascending",
    topicOfferCap: 50,
    baselineCandidateCap: 64,
    evidence:
        "Counterfactual document offer coverage only. No exploration, freeze or passage recovery is executed.",
});
const stopwords = new Set(LEXICAL_SPEC.stopwords.split(" "));
/** @param {string} text @returns {string[]} */
function tokens(text) {
    return (text.toLocaleLowerCase("en-US").match(/[\p{L}\p{N}]+/gu) ?? []).filter(
        token => token.length >= 3 && !stopwords.has(token)
    );
}
/** @typedef {{filename: string, sourcePath?: string, path?: string}} LexicalIdentity */
/** @param {LexicalIdentity} doc */
const sourcePath = doc => doc.sourcePath ?? doc.path ?? doc.filename;
/** @param {LexicalIdentity} a @param {LexicalIdentity} b */
const orderByPath = (a, b) =>
    sourcePath(a) < sourcePath(b) ? -1 : sourcePath(a) > sourcePath(b) ? 1 : 0;

/**
 * @template {{text: string, filename: string, sourcePath?: string, path?: string}} T
 * @param {string} question
 * @param {T[]} documents
 * @returns {(T & {lexicalScore: number})[]}
 */
export function rankQuestion(question, documents) {
    const query = [...new Set(tokens(question))];
    const indexed = documents.map(document => {
        /** @type {Map<string, number>} */
        const frequencies = new Map();
        for (const token of tokens(document.text))
            frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
        for (const token of tokens(document.filename))
            frequencies.set(token, (frequencies.get(token) ?? 0) + LEXICAL_SPEC.titleWeight);
        return {
            document,
            frequencies,
            length: [...frequencies.values()].reduce((sum, count) => sum + count, 0),
        };
    });
    const average =
        indexed.reduce((sum, document) => sum + document.length, 0) / (indexed.length || 1) || 1;
    const frequency = new Map(
        query.map(token => [
            token,
            indexed.filter(document => document.frequencies.has(token)).length,
        ])
    );
    return indexed
        .map(document => {
            let score = 0;
            for (const token of query) {
                const count = document.frequencies.get(token) ?? 0;
                const df = frequency.get(token) ?? 0;
                const idf = Math.log(1 + (documents.length - df + 0.5) / (df + 0.5));
                score +=
                    (idf * count * (LEXICAL_SPEC.k1 + 1)) /
                    (count +
                        LEXICAL_SPEC.k1 *
                            (1 - LEXICAL_SPEC.b + (LEXICAL_SPEC.b * document.length) / average));
            }
            return { ...document.document, lexicalScore: score };
        })
        .sort((a, b) => b.lexicalScore - a.lexicalScore || orderByPath(a, b));
}
