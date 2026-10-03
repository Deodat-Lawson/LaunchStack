"use client";

import { Pencil } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { Cite, type CiteEvidence } from "~/components/tools/Cite";
import { cn } from "~/lib/utils";

/**
 * One line of the profile: a label (a fact's name, a person, a product), the
 * value with the numbers of the excerpts that prove it, and — for someone
 * who may edit — a pencil that turns the value into a text box. Facts,
 * people, services and projects all draw this row, so they read as one list.
 */
export function ProfileRow({
    label,
    value,
    cites,
    evidence,
    edited,
    onSave,
    onReset,
    clearHint,
    prominent = false,
}: {
    label: string;
    value: string | null;
    cites: number[];
    evidence: CiteEvidence[];
    /** Someone set this by hand rather than a document saying it. */
    edited: boolean;
    /** Present when the viewer may edit; resolves once saved, rejects to keep the editor open. */
    onSave?: (value: string) => Promise<void>;
    /** Present on an edited value: drop the edit and show what the sources say again. */
    onReset?: () => Promise<void>;
    /** What clearing the text does, under the editor. */
    clearHint: string;
    /** People and products lead with their name; facts lead with a quiet label. */
    prominent?: boolean;
}) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(value ?? "");
    const [busy, setBusy] = useState(false);
    useEffect(() => setDraft(value ?? ""), [value]);

    // Closing the editor puts focus back on the pencil that opened it, so a
    // keyboard user is not dropped at the top of the page.
    const pencil = useRef<HTMLButtonElement>(null);
    const wasEditing = useRef(false);
    useEffect(() => {
        if (wasEditing.current && !editing) pencil.current?.focus();
        wasEditing.current = editing;
    }, [editing]);

    const cancel = () => {
        setDraft(value ?? "");
        setEditing(false);
    };
    const run = async (action: () => Promise<void>) => {
        setBusy(true);
        try {
            await action();
            setEditing(false);
        } catch {
            // The caller already said what went wrong; keep the text so nothing is lost.
        } finally {
            setBusy(false);
        }
    };
    const save = async () => {
        if (onSave) await run(() => onSave(draft));
    };

    return (
        <div className="border-line-2 @max-md:grid-cols-[minmax(0,1fr)_auto] @max-md:gap-y-1 grid grid-cols-[180px_minmax(0,1fr)_auto] gap-x-4 border-t px-4 py-3 first:border-t-0">
            <div
                className={cn(
                    "@max-md:pt-0 col-start-1 row-start-1 min-w-0 pt-0.5",
                    prominent ? "text-ink text-[13px] font-medium" : "text-ink-3 text-xs"
                )}
            >
                {label}
                {/* No value to hang them on: the excerpts prove the name itself. */}
                {!value && cites.map(n => <Cite key={n} n={n} evidence={evidence} />)}
                {edited && <span className="text-ink-3 ml-1 text-xs font-normal">· edited</span>}
            </div>
            {editing ? (
                <form
                    className="@max-md:col-span-2 @max-md:col-start-1 @max-md:row-start-2 col-start-2 row-start-1 grid gap-2"
                    onSubmit={e => {
                        e.preventDefault();
                        void save();
                    }}
                >
                    <Textarea
                        value={draft}
                        onChange={e => setDraft(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === "Escape") {
                                e.preventDefault();
                                cancel();
                            }
                            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                                e.preventDefault();
                                void save();
                            }
                        }}
                        rows={3}
                        className="text-[13px]"
                        aria-label={`Edit ${label}`}
                        autoFocus
                    />
                    <div className="flex flex-wrap items-center gap-2">
                        <Button size="sm" type="submit" disabled={busy}>
                            Save
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            type="button"
                            onClick={cancel}
                            disabled={busy}
                        >
                            Cancel
                        </Button>
                        {edited && onReset && (
                            <Button
                                size="sm"
                                variant="ghost"
                                type="button"
                                onClick={() => void run(onReset)}
                                disabled={busy}
                            >
                                Use what the sources say
                            </Button>
                        )}
                        <span className="text-ink-3 text-xs">{clearHint}</span>
                    </div>
                </form>
            ) : (
                <p className="text-ink @max-md:col-span-2 @max-md:col-start-1 @max-md:row-start-2 col-start-2 row-start-1 min-w-0 text-[13.5px] leading-relaxed">
                    {value}
                    {value && cites.map(n => <Cite key={n} n={n} evidence={evidence} />)}
                </p>
            )}
            {onSave && !editing && (
                <Button
                    variant="ghost"
                    size="icon"
                    ref={pencil}
                    className="@max-md:col-start-2 col-start-3 row-start-1 size-7 justify-self-end"
                    aria-label={`Edit ${label}`}
                    onClick={() => setEditing(true)}
                >
                    <Pencil className="size-3.5" />
                </Button>
            )}
        </div>
    );
}
