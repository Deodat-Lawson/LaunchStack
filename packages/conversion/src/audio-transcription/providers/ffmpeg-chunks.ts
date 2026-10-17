/**
 * Cut a recording into small speech-quality chunks with ffmpeg, so each
 * transcription call carries only its own minutes.
 *
 * Without this, a long recording is transcribed as prompts over time ranges of
 * the whole stored file, and Gemini bills (and rate-limits) every one of those
 * calls for the whole file's audio: an 82-minute meeting is 157k input tokens
 * per call. Chunked, the same meeting is three calls of ~58k — inside a free-tier
 * project's per-minute token budget — and the upload is a fraction of the size,
 * because Gemini downsamples to 16 kHz mono anyway.
 *
 * ffmpeg is an optional runtime dependency: the app image installs it, and a
 * host without it falls back to whole-file windows (see gemini-native.ts).
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Mono 16 kHz MP3 at 32 kbit/s: ~14 MB an hour, plenty for speech recognition. */
const CHUNK_ARGS = ["-vn", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "32k"];
const FFMPEG_TIMEOUT_MS = 5 * 60_000;

export interface AudioChunk {
    /** Seconds from the start of the recording. */
    start: number;
    end: number;
    bytes: Buffer;
}

let available: Promise<boolean> | null = null;

/** Whether ffmpeg and ffprobe can be run here. Checked once per process. */
export function ffmpegAvailable(): Promise<boolean> {
    available ??= Promise.all([
        run("ffmpeg", ["-version"], { timeout: 10_000 }),
        run("ffprobe", ["-version"], { timeout: 10_000 }),
    ]).then(
        () => true,
        () => false
    );
    return available;
}

/** Test seam: forget the cached probe. */
export function resetFfmpegProbe(): void {
    available = null;
}

/**
 * Split `audio` into chunks of about `chunkSeconds`, or null when ffmpeg is
 * not installed. Throws when ffmpeg is present but cannot decode the file.
 */
export async function splitAudio(
    audio: Buffer,
    filename: string,
    chunkSeconds: number
): Promise<{ duration: number; chunks: AudioChunk[] } | null> {
    if (!(await ffmpegAvailable())) return null;

    const dir = await mkdtemp(join(tmpdir(), "transcribe-"));
    try {
        const ext = /\.[a-z0-9]{1,5}$/i.exec(filename)?.[0] ?? "";
        const input = join(dir, `input${ext}`);
        await writeFile(input, audio);

        const probe = await run(
            "ffprobe",
            ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", input],
            { timeout: FFMPEG_TIMEOUT_MS }
        );
        const duration = Number.parseFloat(probe.stdout.trim());
        if (!Number.isFinite(duration) || duration <= 0) {
            throw new Error(`ffprobe reported no duration for ${filename}`);
        }

        const list = join(dir, "chunks.csv");
        await run(
            "ffmpeg",
            [
                "-v",
                "error",
                "-i",
                input,
                ...CHUNK_ARGS,
                "-f",
                "segment",
                "-segment_time",
                String(chunkSeconds),
                "-segment_list",
                list,
                "-segment_list_type",
                "csv",
                "-reset_timestamps",
                "1",
                join(dir, "chunk%04d.mp3"),
            ],
            { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }
        );

        // One row per chunk: "chunk0000.mp3,0.000000,1800.024000".
        const rows = (await readFile(list, "utf8"))
            .split("\n")
            .map(line => line.trim().split(","))
            .filter(cols => cols.length >= 3);
        const files = new Set(await readdir(dir));
        const chunks: AudioChunk[] = [];
        for (const [name, start, end] of rows) {
            if (!name || !files.has(name)) continue;
            chunks.push({
                start: Number.parseFloat(start!),
                end: Math.min(Number.parseFloat(end!), duration),
                bytes: await readFile(join(dir, name)),
            });
        }
        if (chunks.length === 0) throw new Error(`ffmpeg produced no chunks for ${filename}`);
        return { duration, chunks };
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

/**
 * The stretch [start, end) seconds of an ffmpeg chunk, as its own MP3. Used to
 * ask again for part of a chunk: a fresh clip timed from zero, because a
 * prompt naming a time range is not reliably obeyed (flash-lite transcribed
 * minute 2 when asked for 30:00–60:00 of a long file).
 */
export async function cutAudio(chunk: Buffer, start: number, end: number): Promise<Buffer> {
    const dir = await mkdtemp(join(tmpdir(), "transcribe-cut-"));
    try {
        const input = join(dir, "chunk.mp3");
        const output = join(dir, "cut.mp3");
        await writeFile(input, chunk);
        await run(
            "ffmpeg",
            [
                "-v",
                "error",
                "-ss",
                String(Math.max(0, start)),
                "-t",
                String(Math.max(0.1, end - start)),
                "-i",
                input,
                ...CHUNK_ARGS,
                output,
            ],
            { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }
        );
        return await readFile(output);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}
