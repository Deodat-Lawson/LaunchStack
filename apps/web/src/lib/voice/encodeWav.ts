"use client";

/**
 * Converting recorded audio to WAV, in the browser.
 *
 * `MediaRecorder` produces WebM/Opus in Chromium and Firefox and MP4/AAC in
 * Safari. Gemini's audio input accepts wav, mp3, aiff, aac, ogg and flac —
 * WebM is not among them, so the most common recording in the most common
 * browser is exactly the one the transcription endpoint rejects.
 *
 * Rather than transcode on the server (an ffmpeg or WASM dependency in a
 * serverless route) or rebuild recording on top of an AudioWorklet, we let
 * `MediaRecorder` do what it does well and re-encode the result here.
 * `decodeAudioData` already understands every container the same browser can
 * record, so this is a decode to PCM followed by a 44-byte header.
 */

/** Gemini returns and accepts 16-bit PCM; 16 kHz is ample for speech. */
const TARGET_SAMPLE_RATE = 16_000;

function encodeWavFromChannel(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  const dataBytes = samples.length * bytesPerSample;
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true); // file size minus the first 8 bytes
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // audio format 1 = PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true); // byte rate
  view.setUint16(32, bytesPerSample, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(36, "data");
  view.setUint32(40, dataBytes, true);

  // Float [-1, 1] to signed 16-bit. Clamping first matters: samples can exceed
  // the nominal range after resampling, and wrapping would sound like clicks.
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += bytesPerSample;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

/** Average all channels down to one. Speech does not need stereo. */
function downmixToMono(audio: AudioBuffer): Float32Array {
  if (audio.numberOfChannels === 1) return audio.getChannelData(0);

  const mono = new Float32Array(audio.length);
  for (let channel = 0; channel < audio.numberOfChannels; channel++) {
    const data = audio.getChannelData(channel);
    for (let i = 0; i < data.length; i++) {
      mono[i] = mono[i]! + data[i]! / audio.numberOfChannels;
    }
  }
  return mono;
}

/**
 * Decode any browser-recorded blob and re-encode it as mono 16-bit WAV.
 *
 * Resampling goes through `OfflineAudioContext` so the browser's own
 * interpolation does the work; dropping samples by hand would alias.
 */
export async function blobToWav(blob: Blob): Promise<Blob> {
  const arrayBuffer = await blob.arrayBuffer();

  const AudioContextCtor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;

  if (!AudioContextCtor) {
    throw new Error("Web Audio is unavailable, so the recording cannot be converted.");
  }

  const decodeContext = new AudioContextCtor();
  let decoded: AudioBuffer;
  try {
    decoded = await decodeContext.decodeAudioData(arrayBuffer);
  } finally {
    void decodeContext.close();
  }

  const sampleRate = Math.min(TARGET_SAMPLE_RATE, decoded.sampleRate);

  if (sampleRate === decoded.sampleRate) {
    return encodeWavFromChannel(downmixToMono(decoded), decoded.sampleRate);
  }

  const frameCount = Math.ceil((decoded.length * sampleRate) / decoded.sampleRate);
  const offline = new OfflineAudioContext(1, frameCount, sampleRate);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();

  const resampled = await offline.startRendering();
  return encodeWavFromChannel(resampled.getChannelData(0), sampleRate);
}
