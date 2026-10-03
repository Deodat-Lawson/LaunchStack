import type { ComposerSend } from "./types";
import {
    isComposerDraft,
    readComposerStorage,
    writeComposerStorage,
    type PromptStash,
} from "./composerState";

/** Save recovery before removing transcript turns; the independent draft stays intact. */
export function backupChatEdit(draftKey: string, send: ComposerSend): string | undefined {
    const key = `launchstack:composer:${draftKey}:stashes`;
    const stored = readComposerStorage<unknown>(key, []);
    const stashes = Array.isArray(stored)
        ? stored.filter(
              (value): value is PromptStash =>
                  isComposerDraft(value) && typeof (value as PromptStash).id === "string"
          )
        : [];
    const backup: PromptStash = {
        ...send,
        id: crypto.randomUUID(),
        savedAt: Date.now(),
        failedSend: true,
    };
    return writeComposerStorage(key, [backup, ...stashes]) ? backup.id : undefined;
}

export function removeChatEditBackup(draftKey: string, id: string): void {
    const key = `launchstack:composer:${draftKey}:stashes`;
    const stored = readComposerStorage<unknown>(key, []);
    if (Array.isArray(stored))
        writeComposerStorage(
            key,
            stored.filter(
                (value: unknown) => !(value && typeof value === "object" && "id" in value && value.id === id)
            )
        );
}
