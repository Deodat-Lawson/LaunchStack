"use client";

import { useDialogFocus } from "../_lib/useDialogFocus";

import { useEffect, useRef, useState } from "react";
import { useToolNav } from "~/components/tool-app/nav";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { SkeletonRows } from "~/components/tools/SkeletonRows";
import { useResource } from "~/lib/tools/useResource";
import { vantageApi, vantageErrorMessage, type CommitmentDto } from "../api";
import { CheckInRow } from "../_components/CheckInRow";
import { Field, FormError } from "../_components/Primitives";
import { addDaysIso, todayIso } from "../_lib/format";

export function CommitmentsScreen({ actionId }: { actionId?: string | null }) {
    const { navigate } = useToolNav();
    const res = useResource("vantage:commitments", async () => {
        try {
            return await vantageApi.commitments();
        } catch (error) {
            throw new Error(vantageErrorMessage(error));
        }
    });
    const [view, setView] = useState(actionId ? "all" : "open");
    const [editing, setEditing] = useState<CommitmentDto | "new" | null>(null);
    const all = res.data?.commitments ?? [];
    const shown = all.filter(
        c =>
            (!actionId || c.id === actionId) &&
            (view === "all" || (view === "open" ? c.status === "open" : c.status !== "open"))
    );
    return (
        <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-5">
            <header className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="display text-ink text-2xl">Weekly Actions</h1>
                    <p className="text-ink-2 mt-1 text-sm">
                        An action, an owner, a date, and a result to learn from.
                    </p>
                </div>
                <Button size="sm" onClick={() => setEditing("new")}>
                    Add an action
                </Button>
            </header>
            {actionId && (
                <div className="flex items-center justify-between gap-3">
                    <p className="text-ink-2 text-sm">Linked action</p>
                    <Button variant="outline" size="sm" onClick={() => navigate("/commitments")}>
                        Show all actions
                    </Button>
                </div>
            )}
            <div role="group" aria-label="Filter actions" className="flex gap-2">
                {["open", "resolved", "all"].map(value => (
                    <Button
                        key={value}
                        size="sm"
                        variant={view === value ? "default" : "outline"}
                        aria-pressed={view === value}
                        onClick={() => setView(value)}
                    >
                        {value.charAt(0).toUpperCase() + value.slice(1)}
                    </Button>
                ))}
            </div>
            <FormError message={res.error} />
            {res.error && (
                <Button variant="outline" onClick={() => void res.reload()}>
                    Reload actions
                </Button>
            )}
            {res.loading ? (
                <SkeletonRows rows={3} height={60} />
            ) : shown.length ? (
                <div className="border-line bg-panel rounded-xl border">
                    {shown.map(item => (
                        <CheckInRow
                            key={item.id}
                            commitment={item}
                            onChange={() => void res.reload()}
                            onEdit={() => setEditing(item)}
                        />
                    ))}
                </div>
            ) : (
                !res.error && (
                    <p className="text-ink-3 border-line rounded-xl border border-dashed p-8 text-center text-sm">
                        {actionId && !all.some(c => c.id === actionId)
                            ? "This linked action is unavailable or you no longer have access to it."
                            : "No actions in this view."}
                    </p>
                )
            )}
            <CommitmentDialog
                open={editing !== null}
                initial={editing === "new" ? null : editing}
                onOpenChange={open => !open && setEditing(null)}
                onSaved={() => void res.reload()}
            />
        </div>
    );
}

function CommitmentDialog({
    open,
    onOpenChange,
    onSaved,
    initial,
}: {
    initial: CommitmentDto | null;
    open: boolean;
    onOpenChange: (o: boolean) => void;
    onSaved: (c: CommitmentDto) => void;
}) {
    const dialogFocus = useDialogFocus();
    const [title, setTitle] = useState("");
    const [owner, setOwner] = useState("");
    const [dueOn, setDueOn] = useState(addDaysIso(todayIso(), 7));
    const [test, setTest] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        if (!open) return;
        setTitle(initial?.title ?? "");
        setOwner(initial?.owner ?? "");
        setDueOn(initial?.dueOn ?? addDaysIso(todayIso(), 7));
        setTest(initial?.test ?? "");
        setError(null);
    }, [open, initial]);
    const saving = useRef(false);
    const save = async () => {
        if (saving.current) return;
        saving.current = true;
        setBusy(true);
        setError(null);
        try {
            const input = {
                title,
                owner,
                dueOn,
                test: test || null,
                shared: false,
            };
            const { commitment } = initial
                ? await vantageApi.patchCommitment(initial.id, input)
                : await vantageApi.addCommitment(input);
            toast(initial ? "Action updated" : "Action added");
            onSaved(commitment);
            onOpenChange(false);
        } catch (e) {
            setError(vantageErrorMessage(e));
        } finally {
            saving.current = false;
            setBusy(false);
        }
    };
    return (
        <Dialog open={open} onOpenChange={value => !busy && onOpenChange(value)}>
            <DialogContent {...dialogFocus} className="sm:max-w-[520px]">
                <DialogHeader>
                    <DialogTitle>{initial ? "Edit action" : "Add an action"}</DialogTitle>
                    <DialogDescription>
                        Keep the owner, due date and success test clear. Existing action links and
                        outcomes are preserved.
                    </DialogDescription>
                </DialogHeader>
                <fieldset disabled={busy} className="grid min-w-0 gap-3.5">
                    <Field label="Action" htmlFor="c-title">
                        <Input
                            id="c-title"
                            maxLength={300}
                            value={title}
                            onChange={e => setTitle(e.target.value)}
                            placeholder="Ship the shorter onboarding"
                        />
                    </Field>
                    <div className="grid gap-3.5 sm:grid-cols-2">
                        <Field label="Owner" htmlFor="c-owner">
                            <Input
                                id="c-owner"
                                maxLength={200}
                                value={owner}
                                onChange={e => setOwner(e.target.value)}
                                placeholder="Dana"
                            />
                        </Field>
                        <Field label="Due" htmlFor="c-due">
                            <Input
                                id="c-due"
                                type="date"
                                value={dueOn}
                                onChange={e => setDueOn(e.target.value)}
                            />
                        </Field>
                    </div>
                    <Field label="The test" htmlFor="c-test" hint="What result would settle it">
                        <Input
                            id="c-test"
                            maxLength={1000}
                            value={test}
                            onChange={e => setTest(e.target.value)}
                            placeholder="Activation above 30% for the week"
                        />
                    </Field>
                    <p className="text-ink-3 text-xs">Private to this test workspace.</p>
                    <FormError message={error} />
                </fieldset>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                        Cancel
                    </Button>
                    <Button
                        onClick={() => void save()}
                        disabled={busy || !title.trim() || !owner.trim() || !dueOn || !test.trim()}
                    >
                        {initial ? "Save action" : "Add"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
