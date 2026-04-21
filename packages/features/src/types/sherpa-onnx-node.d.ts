declare module "sherpa-onnx-node" {
  interface OfflineRecognizerWhisperConfig {
    encoder: string;
    decoder: string;
    language?: string;
    task?: "transcribe" | "translate";
    tailPaddings?: number;
  }

  interface OfflineRecognizerModelConfig {
    whisper?: OfflineRecognizerWhisperConfig;
    tokens?: string;
    numThreads?: number;
    debug?: boolean;
    provider?: string;
    modelType?: string;
  }

  interface OfflineRecognizerConfig {
    modelConfig: OfflineRecognizerModelConfig;
    featConfig?: unknown;
    decodingMethod?: string;
  }

  interface OfflineStream {
    acceptWaveform(input: { sampleRate: number; samples: Float32Array }): void;
  }

  interface RecognitionResult {
    text: string;
    timestamps?: number[];
    tokens?: string[];
  }

  export class OfflineRecognizer {
    constructor(config: OfflineRecognizerConfig);
    createStream(): OfflineStream;
    decode(stream: OfflineStream): void;
    getResult(stream: OfflineStream): RecognitionResult;
  }
}
