/**
 * Loading recorded worlds for a replay.
 *
 * The recordings are not in git, so on a fresh checkout there are none. A
 * replay that skipped a missing recording would go on to overwrite the
 * committed results with a partial (or empty) benchmark and exit 0. So a
 * replay asks for every world it needs before it computes or writes anything.
 *
 * A world also carries the format its recorder wrote. A world from an older
 * recorder can hold a request that got no answer stored as an empty one, with
 * nothing to tell the two apart, so a replay refuses it rather than produce
 * numbers that silently differ from the committed ones.
 */

/** Thrown when a replay is asked to run without one or more of its recorded worlds. */
export class MissingRecordingsError extends Error {
    constructor(
        experiment: string,
        readonly missing: readonly string[]
    ) {
        super(
            `${experiment}: no recording for ${missing.join(", ")}. Nothing was written, so the results file is as it was. ` +
                "The recordings are not in git: record them first (see the README), or point COMPANY_SEARCH_BENCH_CACHE at a copy."
        );
        this.name = "MissingRecordingsError";
    }
}

/** Thrown when a recorded world was written by an older recorder. */
export class StaleRecordingsError extends Error {
    constructor(
        experiment: string,
        readonly stale: readonly string[],
        rebuild: string
    ) {
        super(
            `${experiment}: the recorded world of ${stale.join(", ")} was written by an older recorder, which stored a request that got no answer as an empty one. ` +
                `Nothing was written, so the results file is as it was. Rebuild the world from the recorded requests (offline, nothing is sent): ${rebuild}`
        );
        this.name = "StaleRecordingsError";
    }
}

export interface FormatCheck<World> {
    /** True when the world was written by the current recorder. */
    isCurrent(world: World): boolean;
    /** The command that rebuilds stale worlds, shown in the error. */
    rebuild: string;
}

/**
 * Every segment's recorded world, in segment order. Throws, naming them, if
 * any is absent or (with `format`) was written by an older recorder.
 */
export function requireWorlds<Segment extends { id: string }, World>(
    experiment: string,
    segments: readonly Segment[],
    load: (segmentId: string) => World | null,
    format?: FormatCheck<World>
): World[] {
    const worlds: World[] = [];
    const missing: string[] = [];
    const stale: string[] = [];
    for (const segment of segments) {
        const world = load(segment.id);
        if (world === null) missing.push(segment.id);
        else if (format && !format.isCurrent(world)) stale.push(segment.id);
        else worlds.push(world);
    }
    if (missing.length > 0) throw new MissingRecordingsError(experiment, missing);
    if (stale.length > 0) throw new StaleRecordingsError(experiment, stale, format!.rebuild);
    return worlds;
}

/** Runs a replay's `main`; a missing or stale recording prints its message and exits 1, anything else keeps its trace. */
export function runReplay(main: () => void | Promise<void>): void {
    const stop = (error: unknown): void => {
        if (error instanceof MissingRecordingsError || error instanceof StaleRecordingsError) {
            console.error(error.message);
            process.exitCode = 1;
            return;
        }
        throw error;
    };
    try {
        const result = main();
        if (result instanceof Promise) result.catch(stop);
    } catch (error) {
        stop(error);
    }
}
