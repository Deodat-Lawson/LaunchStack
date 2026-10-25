import { z } from "zod";

const positiveInteger = (maximum: number) => z.number().int().positive().max(maximum);

const ConfigSchema = z
    .object({
        origin: z
            .string()
            .url()
            .transform((value, context) => {
                const url = new URL(value);
                if (
                    (url.protocol !== "https:" && url.protocol !== "http:") ||
                    url.username ||
                    url.password ||
                    url.pathname !== "/" ||
                    url.search ||
                    url.hash
                ) {
                    context.addIssue({
                        code: z.ZodIssueCode.custom,
                        message: "must be an HTTP(S) origin",
                    });
                    return z.NEVER;
                }
                return url.origin;
            }),
        deviceToken: z.string().regex(/^lsc_[A-Za-z0-9_-]{43}$/),
        appVersion: z
            .string()
            .max(32)
            .regex(
                /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
            ),
        systemAudioHelperPath: z.string().trim().min(1),
        language: z.string().trim().min(1).max(32).optional(),
        autoEnrich: z.boolean().default(false),
        silenceTimeoutMs: positiveInteger(86_400_000).default(240_000),
        audioFrameMs: positiveInteger(1_000).default(20),
        vadThreshold: z.number().min(0).max(1).default(0.015),
        vadActivationFrames: positiveInteger(10_000).default(3),
        vadReleaseFrames: positiveInteger(100_000).default(15),
        // The server accepts at most 2 MB of 16 kHz mono s16 WAV per utterance.
        utteranceMaxMs: positiveInteger(60_000).default(3_000),
        audioPreRollMs: z.number().int().min(0).max(60_000).default(200),
        audioReadyTimeoutMs: positiveInteger(120_000).default(10_000),
        stopDrainTimeoutMs: positiveInteger(300_000).default(30_000),
        transcriptionTimeoutMs: positiveInteger(300_000).default(20_000),
    })
    .strict()
    .superRefine((config, context) => {
        if (config.utteranceMaxMs < config.audioFrameMs) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["utteranceMaxMs"],
                message: "must cover at least one audio frame",
            });
        }
        if (
            (config.utteranceMaxMs + config.audioPreRollMs + config.audioFrameMs) * 32 + 44 >
            2_000_000
        ) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["utteranceMaxMs"],
                message: "utterance and pre-roll must fit the 2 MB WAV limit",
            });
        }
    });

export type CallWorkerConfig = z.infer<typeof ConfigSchema>;

export class CallWorkerConfigError extends Error {
    readonly exitCode = 64;

    constructor(message: string) {
        super(message);
        this.name = "CallWorkerConfigError";
    }
}

/** Parse exactly the app's first stdin line; never read credentials from argv or env. */
export function loadCallWorkerConfig(line: string): CallWorkerConfig {
    let input: unknown;
    try {
        input = JSON.parse(line) as unknown;
    } catch {
        throw new CallWorkerConfigError(
            "Startup configuration must be one JSON object on stdin line 1"
        );
    }
    const result = ConfigSchema.safeParse(input);
    if (!result.success) {
        // Do not include values or Zod's unrecognized-key details in diagnostics.
        const fields = [
            ...new Set(result.error.issues.map(issue => issue.path.join(".") || "config")),
        ];
        throw new CallWorkerConfigError(`Invalid startup configuration: ${fields.join(", ")}`);
    }
    return result.data;
}
