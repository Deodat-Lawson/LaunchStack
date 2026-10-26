"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "~/components/ui/dialog";
import { DemoApiError, vantageDemoApi, demoSourceName } from "../demo-api";
import type { DemoSource, DemoSourceRef } from "../demo-contract";
import { useDialogFocus } from "../_lib/useDialogFocus";

export function ContextSourceDialog({
    reportId,
    sourceRef,
    onClose,
    onUnavailable,
}: {
    reportId: string;
    sourceRef: DemoSourceRef | null;
    onClose: () => void;
    onUnavailable?: () => void;
}) {
    const focus = useDialogFocus();
    const [source, setSource] = useState<DemoSource | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [retry, setRetry] = useState(0);
    const unavailable = useRef(onUnavailable);
    unavailable.current = onUnavailable;
    useEffect(() => {
        setSource(null);
        setError(null);
        if (!sourceRef) return;
        const controller = new AbortController();
        let active = true;
        void vantageDemoApi
            .source(reportId, sourceRef, controller.signal)
            .then(value => {
                if (active) setSource(value);
            })
            .catch(reason => {
                if (active) {
                    setError(
                        reason instanceof Error
                            ? reason.message
                            : "This exact source is unavailable with your current access."
                    );
                    if (
                        reason instanceof DemoApiError &&
                        [401, 403, 404, 409].includes(reason.status)
                    )
                        unavailable.current?.();
                }
            });
        return () => {
            active = false;
            controller.abort();
        };
    }, [reportId, sourceRef, retry]);
    return (
        <Dialog open={sourceRef !== null} onOpenChange={open => !open && onClose()}>
            <DialogContent {...focus} className="max-h-[85dvh] overflow-y-auto sm:max-w-[720px]">
                <DialogHeader>
                    <DialogTitle>{source?.title ?? "View exact source"}</DialogTitle>
                    <DialogDescription className="break-all font-mono text-[11px]">
                        {sourceRef ? demoSourceName(sourceRef) : "Exact saved source reference"}
                    </DialogDescription>
                </DialogHeader>
                {!source && !error && (
                    <p role="status" className="text-ink-3 text-sm">
                        Checking current access to this exact version…
                    </p>
                )}
                {error && (
                    <div role="alert" className="text-danger space-y-3 text-sm">
                        <p>{error}</p>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setRetry(value => value + 1)}
                        >
                            Retry source
                        </Button>
                    </div>
                )}
                {source && (
                    <>
                        <div className="text-ink-3 flex flex-wrap items-center gap-2 text-xs">
                            <Badge
                                variant="outline"
                                className="max-w-full whitespace-normal break-all text-left"
                            >
                                Exact version {source.source.version}
                            </Badge>
                            {source.reviewState && (
                                <Badge variant="warn">{source.reviewState}</Badge>
                            )}
                            {source.sourceDate && <span>{source.sourceDate.slice(0, 10)}</span>}
                        </div>
                        <SourceContent source={source} />
                        <p className="text-ink-3 border-line border-t pt-3 text-xs leading-relaxed">
                            {source.authority}
                        </p>
                        <details className="text-ink-3 text-xs">
                            <summary className="cursor-pointer">Content provenance</summary>
                            <p className="mt-2 break-all font-mono">SHA-256 {source.contentHash}</p>
                        </details>
                    </>
                )}
                <p className="text-ink-3 text-xs">
                    A source reference identifies the supplied content. It does not by itself verify
                    the report’s interpretation.
                </p>
            </DialogContent>
        </Dialog>
    );
}

function SourceContent({ source }: { source: DemoSource }) {
    if (source.source.kind === "company") {
        try {
            const payload = JSON.parse(source.body) as {
                facts?: { label?: unknown; value?: unknown }[];
                unknowns?: { code?: unknown }[];
            };
            if (Array.isArray(payload.facts))
                return (
                    <div className="space-y-4">
                        <dl className="space-y-3">
                            {payload.facts.map((fact, index) => (
                                <div key={index}>
                                    <dt className="text-ink-3 text-xs font-medium">
                                        {typeof fact.label === "string"
                                            ? fact.label
                                            : "Reported context"}
                                    </dt>
                                    <dd className="text-ink mt-1 break-words text-sm leading-relaxed">
                                        {typeof fact.value === "string"
                                            ? fact.value
                                            : JSON.stringify(fact.value)}
                                    </dd>
                                </div>
                            ))}
                        </dl>
                        {Array.isArray(payload.unknowns) && payload.unknowns.length > 0 && (
                            <div className="text-ink-3 text-xs">
                                <p className="mb-1 font-medium">Explicit unknowns</p>
                                <ul className="list-disc space-y-1 pl-4">
                                    {payload.unknowns.map((item, index) => (
                                        <li key={index}>
                                            {typeof item.code === "string"
                                                ? item.code.replaceAll("_", " ")
                                                : "Unspecified context"}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        <details className="text-ink-3 text-xs">
                            <summary className="cursor-pointer">
                                Exact source content and original provenance
                            </summary>
                            <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[11px]">
                                {JSON.stringify(payload, null, 2)}
                            </pre>
                        </details>
                    </div>
                );
        } catch {
            /* Preserve the exact supplied body when it is not the profile projection format. */
        }
    }
    return (
        <p className="text-ink whitespace-pre-wrap break-words text-sm leading-relaxed">
            {source.body}
        </p>
    );
}
