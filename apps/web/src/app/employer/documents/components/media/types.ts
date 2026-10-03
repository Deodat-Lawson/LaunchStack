/**
 * What the transcript asks of whichever player is showing: a stored file in
 * `<audio>`/`<video>`, or a platform's framed player.
 */
export interface PlayerHandle {
    /**
     * Move the playhead. `play` starts playback too — a click on a transcript
     * line means "play from here"; a citation only cues the moment up.
     */
    seek(seconds: number, options?: { play?: boolean }): void;
}

/** Rates offered in the speed menu. */
export const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;

/** How far the skip buttons jump, in seconds. */
export const SKIP_SECONDS = 10;
