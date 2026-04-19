/**
 * Whisper.js — Local speech-to-text using sherpa-onnx-node
 *
 * Runs the Whisper ONNX model via native bindings (no Python needed).
 * Same model quality as the Python sidecar, with prebuilt binaries
 * for Mac, Linux, and Windows — no C++ compiler required.
 *
 * Model files must be downloaded to /models/sherpa-onnx-whisper-base.en/
 * Run: scripts/download-whisper-model.sh
 */

import { execFile } from "node:child_process";
import { writeFile, unlink, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { TranscriptSegment, TranscriptionResult } from "./transcription";

const MODEL_DIR = resolve(process.cwd(), "models", "sherpa-onnx-whisper-base.en");

let recognizerInstance: unknown | null = null;

async function getRecognizer() {
  if (recognizerInstance) return recognizerInstance;

  // Check model files exist
  const encoderPath = join(MODEL_DIR, "base.en-encoder.int8.onnx");
  const decoderPath = join(MODEL_DIR, "base.en-decoder.int8.onnx");
  const tokensPath = join(MODEL_DIR, "base.en-tokens.txt");

  try {
    await access(encoderPath);
    await access(decoderPath);
    await access(tokensPath);
  } catch {
    throw new Error(
      `Whisper model not found at ${MODEL_DIR}. ` +
      `Download it: cd models && curl -L -o model.tar.bz2 "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-base.en.tar.bz2" && tar -xjf model.tar.bz2 && rm model.tar.bz2`
    );
  }

  console.log(`[WhisperJS] Loading sherpa-onnx model from ${MODEL_DIR}...`);
  const startTime = Date.now();

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sherpa = require("sherpa-onnx-node") as typeof import("sherpa-onnx-node");

  const recognizer = new sherpa.OfflineRecognizer({
    modelConfig: {
      whisper: {
        encoder: encoderPath,
        decoder: decoderPath,
        language: "en",
        task: "transcribe",
      },
      tokens: tokensPath,
      numThreads: 2,
      provider: "cpu",
    },
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[WhisperJS] Model loaded in ${elapsed}s`);

  recognizerInstance = recognizer;
  return recognizer;
}

/**
 * Decode audio bytes to 16kHz mono Float32Array using ffmpeg.
 */
async function decodeAudioWithFFmpeg(audioBytes: Buffer | Uint8Array): Promise<Float32Array> {
  const id = randomUUID();
  const inputPath = join(tmpdir(), `whisper-input-${id}`);
  const outputPath = join(tmpdir(), `whisper-output-${id}.raw`);

  try {
    await writeFile(inputPath, audioBytes);

    await new Promise<void>((resolve, reject) => {
      execFile(
        "ffmpeg",
        [
          "-i", inputPath,
          "-ar", "16000",
          "-ac", "1",
          "-f", "f32le",
          "-y",
          outputPath,
        ],
        { timeout: 60_000 },
        (error, _stdout, stderr) => {
          if (error) {
            console.error(`[WhisperJS] ffmpeg error: ${stderr}`);
            reject(new Error(`ffmpeg failed: ${error.message}`));
          } else {
            resolve();
          }
        },
      );
    });

    const { readFile } = await import("node:fs/promises");
    const pcmBuffer = await readFile(outputPath);
    const float32 = new Float32Array(pcmBuffer.buffer, pcmBuffer.byteOffset, pcmBuffer.length / 4);

    console.log(`[WhisperJS] Decoded audio: ${float32.length} samples (${(float32.length / 16000).toFixed(1)}s)`);
    return float32;
  } finally {
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
  }
}

/**
 * Transcribe audio using sherpa-onnx (native Whisper, no Python needed).
 */
export async function transcribeWithWhisperJS(
  audioBytes: Buffer | Uint8Array,
  filename: string,
): Promise<TranscriptionResult> {
  console.log(`[WhisperJS] Transcribing: ${filename} (${audioBytes.length} bytes)`);
  const startTime = Date.now();

  const recognizer = await getRecognizer() as {
    createStream: () => {
      acceptWaveform: (opts: { sampleRate: number; samples: Float32Array }) => void;
    };
    decode: (stream: unknown) => void;
    getResult: (stream: unknown) => { text: string; timestamps?: number[]; tokens?: string[] };
  };

  const audioData = await decodeAudioWithFFmpeg(audioBytes);

  // Process in smaller chunks for more frequent timestamps
  const CHUNK_SIZE = 16000 * 5; // 5 seconds of audio
  const segments: TranscriptSegment[] = [];
  let fullText = "";

  for (let offset = 0; offset < audioData.length; offset += CHUNK_SIZE) {
    const end = Math.min(offset + CHUNK_SIZE, audioData.length);
    const chunk = audioData.subarray(offset, end);
    const chunkStartTime = offset / 16000;

    const stream = recognizer.createStream();
    stream.acceptWaveform({ sampleRate: 16000, samples: chunk });
    recognizer.decode(stream);

    const result = recognizer.getResult(stream);
    const text = result.text.trim();

    if (text) {
      fullText += (fullText ? " " : "") + text;
      segments.push({
        start: chunkStartTime,
        end: Math.min(chunkStartTime + (end - offset) / 16000, audioData.length / 16000),
        text,
      });
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(
    `[WhisperJS] Complete: ${filename} → ${fullText.length} chars, ${segments.length} segments (${elapsed}s)`,
  );

  return {
    text: fullText,
    language: "en",
    confidence: 0.0,
    filename,
    segments,
  };
}
