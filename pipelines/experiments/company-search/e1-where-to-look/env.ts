/**
 * The recorded Photon world as a discovery environment: a search word's
 * requests are the boxes of its quadtree, widest first; a box that came back
 * full puts its four quarters in the queue.
 */
import type { DiscoveryEnv, ResultItem, TermCursor } from "../lib/discovery";
import type { Bbox } from "./segments";
import { PHOTON_CAP, answerFor, childBboxes, nameTokens, type World } from "./world";

/** Boxes are not split below this depth (as in the recording). */
export const MAX_DEPTH = 8;

export function createEnv(world: World, onRequest?: (line: string) => void): DiscoveryEnv {
    const withWebsite = new Set(world.withWebsite);
    const items = (ids: readonly string[]): ResultItem[] =>
        ids.map(id => ({ id, name: world.places[id]!.name, target: true }));
    const open = (term: string): TermCursor => {
        const queue: Array<{ id: string; bbox: Bbox; depth: number }> = [
            { id: "r", bbox: world.segment.bbox, depth: 0 },
        ];
        // A full box at the depth limit may hide places for good.
        let cutOff = false;
        return {
            pending: () => queue.length,
            peek: () => {
                const node = queue[0];
                if (!node) return null;
                const answer = answerFor(world, term, node.id, node.bbox);
                return answer ? items(answer.places) : [];
            },
            next: () => {
                const node = queue.shift()!;
                const answer = answerFor(world, term, node.id, node.bbox);
                if (!answer) return [];
                if (answer.capped) {
                    if (node.depth < MAX_DEPTH) {
                        for (const [i, bbox] of childBboxes(node.bbox).entries())
                            queue.push({ id: `${node.id}.${i}`, bbox, depth: node.depth + 1 });
                    } else cutOff = true;
                }
                onRequest?.(
                    `${term}@${node.id}:${answer.places.length}${answer.capped ? "*" : ""}`
                );
                return items(answer.places);
            },
            complete: () => queue.length === 0 && !cutOff,
        };
    };
    return {
        cap: PHOTON_CAP,
        planTerms: world.terms.plan,
        letterTerms: world.terms.letters,
        allTerms: () => Object.keys(world.sweeps),
        hasTerm: term => world.sweeps[term] !== undefined,
        open,
        tokens: nameTokens,
        // Photon answers to the start of a name word.
        wordMatches: (nameWord, queryWord) => nameWord.startsWith(queryWord),
        keysOf: nameWord =>
            Array.from({ length: nameWord.length }, (_, i) => nameWord.slice(0, i + 1)),
        isBonus: id => withWebsite.has(id),
    };
}
