"use client";

import { useDialogFocus } from "../_lib/useDialogFocus";

import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "~/components/ui/dialog";
import { vantageApi, vantageErrorMessage, type VantageEvidenceRef } from "../api";
import { FormError } from "./Primitives";

export function SourceLinks({
    refs,
    onOpen,
}: {
    refs: VantageEvidenceRef[];
    onOpen: (ref: VantageEvidenceRef) => void;
}) {
    return (
        <div className="mt-2 flex flex-wrap gap-1.5">
            {refs.map(ref => (
                <Button
                    key={ref.ref}
                    variant="outline"
                    size="sm"
                    className="h-auto max-w-full whitespace-normal text-left text-xs"
                    onClick={() => onOpen(ref)}
                >
                    {ref.label || "View source"}
                    {ref.date ? ` · ${ref.date}` : ""}
                </Button>
            ))}
        </div>
    );
}

type Source = { title: string; body: string; date: string; url?: string | null };

export function SourceDialog({
    sourceRef,
    onClose,
}: {
    sourceRef: VantageEvidenceRef | null;
    onClose: () => void;
}) {
    const dialogFocus = useDialogFocus();
    const [source, setSource] = useState<Source | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [retry, setRetry] = useState(0);
    useEffect(() => {
        if (!sourceRef) return;
        let active = true;
        setSource(null);
        setError(null);
        const read = async (): Promise<Source> => {
            const colon = sourceRef.ref.indexOf(":");
            const kind = sourceRef.ref.slice(0, colon);
            const id = sourceRef.ref.slice(colon + 1);
            if (kind === "ev") {
                // Read the cited record by its opaque id. The list endpoint can
                // be filtered by visibility and is not a safe source resolver.
                const { evidence: item } = await vantageApi.evidenceById(id);
                if (item) {
                    return {
                        title: item.title,
                        body: item.body,
                        date: `Observed ${item.observedAt} · ${item.source ?? "Source not named"}`,
                        url: item.sourceUrl,
                    };
                }
            } else if (kind === "obs") {
                const { observation: item } = await vantageApi.observationById(id);
                if (item) {
                    return {
                        title: item.metricName,
                        body: `Value: ${item.value}\nSource: ${item.source ?? "Not named"}\n${item.note ?? ""}`,
                        date: `${item.periodStart} – ${item.periodEnd}`,
                    };
                }
            } else if (kind === "cm") {
                const { commitment: item } = await vantageApi.commitmentById(id);
                if (item)
                    return {
                        title: item.title,
                        body: `Owner: ${item.owner}\nStatus: ${item.status}\nTest: ${item.test ?? "Not recorded"}\nOutcome: ${item.outcome ?? "Not recorded"}`,
                        date: `Created ${item.createdAt} · Due ${item.dueOn}`,
                    };
            }
            throw new Error(
                "This reference is not available in the accessible source records. It cannot be verified here."
            );
        };
        void read()
            .then(value => {
                if (active) setSource(value);
            })
            .catch(e => {
                if (active)
                    setError(
                        e instanceof Error && !("status" in e) ? e.message : vantageErrorMessage(e)
                    );
            });
        return () => {
            active = false;
        };
    }, [sourceRef, retry]);
    const safeUrl = source?.url && /^https?:\/\//i.test(source.url) ? source.url : null;
    return (
        <Dialog open={sourceRef !== null} onOpenChange={open => !open && onClose()}>
            <DialogContent
                {...dialogFocus}
                className="max-h-[85dvh] overflow-y-auto sm:max-w-[640px]"
            >
                <DialogHeader>
                    <DialogTitle>{source?.title ?? "View source"}</DialogTitle>
                    <DialogDescription>{source?.date ?? sourceRef?.label}</DialogDescription>
                </DialogHeader>
                {!source && !error && (
                    <p role="status" className="text-ink-2 text-sm">
                        Loading source…
                    </p>
                )}
                <FormError message={error} />
                {error && (
                    <Button variant="outline" onClick={() => setRetry(n => n + 1)}>
                        Retry source
                    </Button>
                )}
                {source && (
                    <p className="text-ink whitespace-pre-wrap break-words text-sm leading-relaxed">
                        {source.body}
                    </p>
                )}
                {safeUrl && (
                    <Button variant="outline" asChild>
                        <a href={safeUrl} target="_blank" rel="noopener noreferrer">
                            Open original source
                        </a>
                    </Button>
                )}
                <p className="text-ink-3 text-xs">
                    A source must support the claim it accompanies. Its presence alone does not
                    verify the interpretation.
                </p>
            </DialogContent>
        </Dialog>
    );
}
