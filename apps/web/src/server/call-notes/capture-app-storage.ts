import "server-only";

import { Readable } from "node:stream";
import { BlobServiceClient, type ContainerClient } from "@azure/storage-blob";
import { z } from "zod";

import { env } from "~/env";
import { isCaptureVersion } from "~/server/call-notes/capture-version";

const CaptureAppReleaseSchema = z
    .object({
        version: z.string().refine(isCaptureVersion),
        dmg: z.string(),
    })
    .refine(({ version, dmg }) => dmg === releasePath(version, "dmg"));

type CaptureAppRelease = z.infer<typeof CaptureAppReleaseSchema>;

let container: ContainerClient | undefined;

function getContainer(): ContainerClient | null {
    const connectionString = env.server.CALL_NOTES_CAPTURE_APP_STORAGE_CONNECTION_STRING;
    if (!connectionString) return null;
    container ??= BlobServiceClient.fromConnectionString(connectionString).getContainerClient(
        env.server.CALL_NOTES_CAPTURE_APP_CONTAINER
    );
    return container;
}

function releasePath(version: string, extension: "dmg" | "zip"): string {
    return `releases/${version}/LaunchStack-Capture-${version}-arm64.${extension}`;
}

async function downloadBlob(path: string): Promise<ReadableStream<Uint8Array> | null> {
    const client = getContainer();
    if (!client) return null;
    try {
        const { readableStreamBody } = await client.getBlobClient(path).download(0);
        if (!readableStreamBody) throw new Error("Capture release blob has no response stream");
        return Readable.toWeb(readableStreamBody as Readable) as ReadableStream<Uint8Array>;
    } catch (error) {
        if (
            typeof error === "object" &&
            error !== null &&
            "statusCode" in error &&
            error.statusCode === 404
        ) {
            return null;
        }
        throw error;
    }
}

export async function getLatestCaptureRelease(): Promise<CaptureAppRelease | null> {
    const stream = await downloadBlob("latest.json");
    if (!stream) return null;
    let manifest: unknown;
    try {
        manifest = JSON.parse(await new Response(stream).text());
    } catch (error) {
        if (error instanceof SyntaxError) return null;
        throw error;
    }
    const parsed = CaptureAppReleaseSchema.safeParse(manifest);
    return parsed.success ? parsed.data : null;
}

export async function downloadLatestCaptureApp(): Promise<ReadableStream<Uint8Array> | null> {
    const release = await getLatestCaptureRelease();
    return release ? downloadBlob(release.dmg) : null;
}

export async function readCaptureAppcast(): Promise<string | null> {
    const stream = await downloadBlob("appcast.xml");
    return stream ? new Response(stream).text() : null;
}

export async function downloadCaptureUpdate(
    file: string
): Promise<ReadableStream<Uint8Array> | null> {
    const version = /^LaunchStack-Capture-(.+)-arm64\.zip$/.exec(file)?.[1];
    if (
        !version ||
        !isCaptureVersion(version) ||
        file !== `LaunchStack-Capture-${version}-arm64.zip`
    ) {
        return null;
    }
    return downloadBlob(releasePath(version, "zip"));
}
