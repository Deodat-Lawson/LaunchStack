/**
 * Politeness towards the free OpenStreetMap services: one request at a time
 * per host, with a pause after each before the next may start. Photon,
 * Nominatim and the OSM API are community servers that ask for about one
 * request a second; a place sweep sends dozens, so the pause is enforced
 * here, for every caller in the process, instead of being left to each loop.
 */

/**
 * Pause after a request to a host, in milliseconds. A host not listed is not
 * held back. Overpass is left out on purpose: a run sends it one request per
 * area and each can take a minute, so queueing them behind one another would
 * spend a request's time limit on waiting for someone else's.
 */
export const DEFAULT_HOST_GAPS_MS: Readonly<Record<string, number>> = {
    "photon.komoot.io": 1_100,
    "api.openstreetmap.org": 1_500,
    "nominatim.openstreetmap.org": 1_100,
};

export interface HostThrottleOptions {
    /** Pause per hostname; defaults to DEFAULT_HOST_GAPS_MS. */
    gapMs?: Readonly<Record<string, number>>;
    /** Injectable clock and sleep, for tests. */
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
}

/** Runs `task` when it is the host's turn. */
export type HostThrottle = <T>(host: string, task: () => Promise<T>) => Promise<T>;

const realSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export function createHostThrottle(options: HostThrottleOptions = {}): HostThrottle {
    const gaps = options.gapMs ?? DEFAULT_HOST_GAPS_MS;
    const now = options.now ?? Date.now;
    const sleep = options.sleep ?? realSleep;
    /** Tail of each host's queue, so two requests to a host never overlap. */
    const tails = new Map<string, Promise<void>>();
    const lastEndedAt = new Map<string, number>();
    return async <T>(host: string, task: () => Promise<T>): Promise<T> => {
        const gap = gaps[host];
        if (gap === undefined) return task();
        const previous = tails.get(host) ?? Promise.resolve();
        let release!: () => void;
        tails.set(
            host,
            new Promise<void>(resolve => {
                release = resolve;
            })
        );
        await previous;
        try {
            const ended = lastEndedAt.get(host);
            const wait = ended === undefined ? 0 : ended + gap - now();
            if (wait > 0) await sleep(wait);
            return await task();
        } finally {
            lastEndedAt.set(host, now());
            release();
        }
    };
}

/** The process-wide throttle: every keyless run in this process shares the hosts' queues. */
export const sharedHostThrottle: HostThrottle = createHostThrottle();

function hostOf(input: Parameters<typeof fetch>[0]): string | null {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    try {
        return new URL(url).hostname;
    } catch {
        return null;
    }
}

/** A `fetch` whose requests wait their host's turn. */
export function throttledFetch(fetchImpl: typeof fetch, throttle: HostThrottle): typeof fetch {
    return (input, init) => {
        const host = hostOf(input);
        return host === null
            ? fetchImpl(input, init)
            : throttle(host, () => fetchImpl(input, init));
    };
}
