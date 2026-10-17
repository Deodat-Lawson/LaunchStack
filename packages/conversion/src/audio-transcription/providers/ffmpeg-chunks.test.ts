import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { cutAudio, ffmpegAvailable, splitAudio } from "./ffmpeg-chunks";

/** Real ffmpeg, when this machine has it (the app image does); skipped otherwise. */
const hasFfmpeg = (() => {
    try {
        execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
})();

describe.skipIf(!hasFfmpeg)("splitAudio (real ffmpeg)", () => {
    let dir = "";
    let m4a: Buffer;

    beforeAll(() => {
        dir = mkdtempSync(join(tmpdir(), "chunks-test-"));
        const file = join(dir, "tone.m4a");
        // 130 s of stereo AAC in MPEG-4, like a phone voice memo.
        execFileSync("ffmpeg", [
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=130",
            "-ac",
            "2",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            file,
        ]);
        m4a = readFileSync(file);
    });

    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it("cuts a recording into contiguous speech-quality MP3 chunks", async () => {
        expect(await ffmpegAvailable()).toBe(true);
        const result = await splitAudio(m4a, "memo.m4a", 60);

        expect(result).not.toBeNull();
        const { duration, chunks } = result!;
        expect(duration).toBeCloseTo(130, 0);
        expect(chunks).toHaveLength(3);
        expect(chunks[0]!.start).toBe(0);
        for (let i = 1; i < chunks.length; i++) {
            expect(chunks[i]!.start).toBeCloseTo(chunks[i - 1]!.end, 1);
        }
        expect(chunks.at(-1)!.end).toBeCloseTo(130, 0);
        // MP3 (ffmpeg leads with an ID3 tag), and far smaller than the 128 kbit/s stereo original.
        expect(chunks[0]!.bytes.subarray(0, 3).toString("latin1")).toBe("ID3");
        expect(chunks.reduce((n, c) => n + c.bytes.length, 0)).toBeLessThan(m4a.length / 3);
    });

    it("cuts part of a chunk into its own clip, timed from zero", async () => {
        const { chunks } = (await splitAudio(m4a, "memo.m4a", 60))!;
        const clip = await cutAudio(chunks[0]!.bytes, 10, 40);
        const dir2 = mkdtempSync(join(tmpdir(), "cut-test-"));
        try {
            const file = join(dir2, "clip.mp3");
            writeFileSync(file, clip);
            const seconds = Number(
                execFileSync("ffprobe", [
                    "-v",
                    "error",
                    "-show_entries",
                    "format=duration",
                    "-of",
                    "csv=p=0",
                    file,
                ])
                    .toString()
                    .trim()
            );
            expect(seconds).toBeGreaterThan(29);
            expect(seconds).toBeLessThan(31);
        } finally {
            rmSync(dir2, { recursive: true, force: true });
        }
    });

    it("throws on bytes ffmpeg cannot decode", async () => {
        await expect(splitAudio(Buffer.from("not audio"), "memo.m4a", 60)).rejects.toThrow();
    });
});
