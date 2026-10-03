"use client";

import { useEffect, useState } from "react";
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
import { Switch } from "~/components/ui/switch";
import { Textarea } from "~/components/ui/textarea";

import { vantageApi, type TopicDto, type TopicInput, type VantageFact } from "../api";
import { addDaysIso, todayIso } from "../_lib/format";
import { Field, FormError } from "./Primitives";

/**
 * Add or edit a topic. Facts are one per line; a fact the founder types
 * has no source on file and is shown that way, so the honest option is
 * to add the evidence first and let the next draft cite it.
 */
export function TopicDialog({
    open,
    onOpenChange,
    agendaId,
    initial,
    onSaved,
}: {
    open: boolean;
    onOpenChange: (o: boolean) => void;
    agendaId: string;
    initial: TopicDto | null;
    onSaved: (topic: TopicDto) => void;
}) {
    const [title, setTitle] = useState("");
    const [factsText, setFactsText] = useState("");
    const [why, setWhy] = useState("");
    const [decision, setDecision] = useState("");
    const [next, setNext] = useState("");
    const [owner, setOwner] = useState("");
    const [due, setDue] = useState("");
    const [help, setHelp] = useState("");
    const [unknowns, setUnknowns] = useState("");
    const [shared, setShared] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        setTitle(initial?.title ?? "");
        setFactsText(initial?.facts.map(f => f.text).join("\n") ?? "");
        setWhy(initial?.whyItMatters ?? "");
        setDecision(initial?.decisionQuestion ?? "");
        setNext(initial?.proposedNextStep ?? "");
        setOwner(initial?.proposedOwner ?? "");
        setDue(initial?.proposedDue ?? "");
        setHelp(initial?.helpRequested ?? "");
        setUnknowns(initial?.unknowns.join("\n") ?? "");
        setShared(initial?.shared ?? false);
        setError(null);
    }, [open, initial]);

    const save = async () => {
        setBusy(true);
        setError(null);
        try {
            // Keep the sources of facts whose text is unchanged; a rewritten
            // or new line has none until the next draft cites it.
            const previous = new Map((initial?.facts ?? []).map(f => [f.text, f]));
            const facts: VantageFact[] = factsText
                .split("\n")
                .map(l => l.trim())
                .filter(Boolean)
                .map(text => previous.get(text) ?? { text, refs: [], unsupported: true });
            const input: TopicInput = {
                title,
                facts,
                whyItMatters: why,
                decisionQuestion: decision,
                proposedNextStep: next,
                proposedOwner: owner || null,
                proposedDue: due || null,
                helpRequested: help || null,
                unknowns: unknowns
                    .split("\n")
                    .map(l => l.trim())
                    .filter(Boolean),
                shared,
            };
            const { topic } = initial
                ? await vantageApi.patchTopic(initial.id, input)
                : await vantageApi.addTopic(agendaId, input);
            toast(initial ? "Topic saved" : "Topic added");
            onSaved(topic);
            onOpenChange(false);
        } catch (e) {
            setError(e instanceof Error ? e.message : "That did not save");
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-[640px]">
                <DialogHeader>
                    <DialogTitle>{initial ? "Edit topic" : "Add a topic"}</DialogTitle>
                    <DialogDescription>
                        A topic is a decision with its evidence. If there is no decision to make, it
                        is an update, not a topic.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-3.5">
                    <Field label="Title" htmlFor="t-title">
                        <Input
                            id="t-title"
                            value={title}
                            onChange={e => setTitle(e.target.value)}
                            autoFocus
                            placeholder="Onboarding drop-off"
                        />
                    </Field>
                    <Field
                        label="What happened"
                        htmlFor="t-facts"
                        hint="One fact per line. A line you write here has no source on file until evidence is added and the draft cites it."
                    >
                        <Textarea
                            id="t-facts"
                            value={factsText}
                            onChange={e => setFactsText(e.target.value)}
                            rows={3}
                            placeholder="40 people signed up; 6 finished onboarding."
                        />
                    </Field>
                    <Field
                        label="Why it merits discussion"
                        htmlFor="t-why"
                        hint="A change, a contradiction, a missed target, or an important unknown"
                    >
                        <Textarea
                            id="t-why"
                            value={why}
                            onChange={e => setWhy(e.target.value)}
                            rows={2}
                        />
                    </Field>
                    <Field
                        label="The decision"
                        htmlFor="t-decision"
                        hint="Phrase it as the choice: this, or that?"
                    >
                        <Input
                            id="t-decision"
                            value={decision}
                            onChange={e => setDecision(e.target.value)}
                            placeholder="Improve onboarding, or spend next week on another acquisition channel?"
                        />
                    </Field>
                    <Field label="Proposed next step" htmlFor="t-next">
                        <Input
                            id="t-next"
                            value={next}
                            onChange={e => setNext(e.target.value)}
                            placeholder="Cut onboarding to three screens and re-measure for one week"
                        />
                    </Field>
                    <div className="grid gap-3.5 sm:grid-cols-2">
                        <Field label="Owner" htmlFor="t-owner">
                            <Input
                                id="t-owner"
                                value={owner}
                                onChange={e => setOwner(e.target.value)}
                                placeholder="Dana"
                            />
                        </Field>
                        <Field label="Due" htmlFor="t-due">
                            <Input
                                id="t-due"
                                type="date"
                                value={due}
                                onChange={e => setDue(e.target.value)}
                            />
                        </Field>
                    </div>
                    <Field
                        label="Help requested"
                        htmlFor="t-help"
                        hint="What a mentor or administrator could unblock; visible to them only if the topic is shared"
                    >
                        <Input
                            id="t-help"
                            value={help}
                            onChange={e => setHelp(e.target.value)}
                            placeholder="Optional"
                        />
                    </Field>
                    <Field
                        label="Unknowns"
                        htmlFor="t-unknowns"
                        hint="One per line: what the data does not say"
                    >
                        <Textarea
                            id="t-unknowns"
                            value={unknowns}
                            onChange={e => setUnknowns(e.target.value)}
                            rows={2}
                        />
                    </Field>
                    <div className="border-line-2 flex items-center justify-between gap-3 border-t pt-3">
                        <div>
                            <div className="text-ink text-[13px] font-medium">
                                Share with a mentor or administrator
                            </div>
                            <div className="text-ink-3 text-[11.5px]">
                                Shared topics appear in the program triage view and the weekly
                                update.
                            </div>
                        </div>
                        <Switch checked={shared} onCheckedChange={setShared} aria-label="Shared" />
                    </div>
                    <FormError message={error} />
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                        Cancel
                    </Button>
                    <Button onClick={() => void save()} disabled={busy || !title.trim()}>
                        {initial ? "Save" : "Add topic"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

/**
 * After the meeting: what was decided, and the commitment that will be
 * checked next week. The commitment is on by default and prefilled from
 * the proposed next step — a decision without follow-through is the
 * failure this product exists to stop, so opting out takes a click.
 */
export function DecisionDialog({
    open,
    onOpenChange,
    topic,
    onSaved,
}: {
    open: boolean;
    onOpenChange: (o: boolean) => void;
    topic: TopicDto | null;
    onSaved: (topic: TopicDto) => void;
}) {
    const [decision, setDecision] = useState("");
    const [withCommitment, setWithCommitment] = useState(true);
    const [title, setTitle] = useState("");
    const [owner, setOwner] = useState("");
    const [due, setDue] = useState("");
    const [test, setTest] = useState("");
    const [shared, setShared] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open || !topic) return;
        setDecision(topic.decision ?? "");
        setWithCommitment(!topic.commitmentId);
        setTitle(topic.proposedNextStep || topic.title);
        setOwner(topic.proposedOwner ?? "");
        setDue(topic.proposedDue ?? addDaysIso(todayIso(), 7));
        setTest("");
        setShared(topic.shared);
        setError(null);
    }, [open, topic]);

    const save = async () => {
        if (!topic) return;
        setBusy(true);
        setError(null);
        try {
            const { topic: saved } = await vantageApi.decide(topic.id, {
                decision,
                commitment: withCommitment
                    ? { title, owner, dueOn: due, test: test || null, shared }
                    : null,
            });
            toast(withCommitment ? "Decision recorded and commitment opened" : "Decision recorded");
            onSaved(saved);
            onOpenChange(false);
        } catch (e) {
            setError(e instanceof Error ? e.message : "That did not save");
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[560px]">
                <DialogHeader>
                    <DialogTitle>Record the decision</DialogTitle>
                    <DialogDescription>
                        {topic?.decisionQuestion === "" ? topic?.title : topic?.decisionQuestion}
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-3.5">
                    <Field label="What was decided" htmlFor="d-decision">
                        <Textarea
                            id="d-decision"
                            value={decision}
                            onChange={e => setDecision(e.target.value)}
                            rows={3}
                            autoFocus
                            placeholder="We fix onboarding first; the channel test waits a week."
                        />
                    </Field>
                    <div className="border-line-2 flex items-center justify-between gap-3 border-t pt-3">
                        <div>
                            <div className="text-ink text-[13px] font-medium">
                                Open a commitment
                            </div>
                            <div className="text-ink-3 text-[11.5px]">
                                Next week&apos;s agenda checks whether it happened.
                            </div>
                        </div>
                        <Switch
                            checked={withCommitment}
                            onCheckedChange={setWithCommitment}
                            aria-label="Open a commitment"
                        />
                    </div>
                    {withCommitment && (
                        <>
                            <Field label="Action" htmlFor="d-title">
                                <Input
                                    id="d-title"
                                    value={title}
                                    onChange={e => setTitle(e.target.value)}
                                />
                            </Field>
                            <div className="grid gap-3.5 sm:grid-cols-2">
                                <Field label="Owner" htmlFor="d-owner">
                                    <Input
                                        id="d-owner"
                                        value={owner}
                                        onChange={e => setOwner(e.target.value)}
                                        placeholder="Who"
                                    />
                                </Field>
                                <Field label="Due" htmlFor="d-due">
                                    <Input
                                        id="d-due"
                                        type="date"
                                        value={due}
                                        onChange={e => setDue(e.target.value)}
                                    />
                                </Field>
                            </div>
                            <Field
                                label="The test"
                                htmlFor="d-test"
                                hint="What result would settle the uncertainty"
                            >
                                <Input
                                    id="d-test"
                                    value={test}
                                    onChange={e => setTest(e.target.value)}
                                    placeholder="Activation above 30% for the week"
                                />
                            </Field>
                            <div className="flex items-center justify-between gap-3">
                                <div className="text-ink-2 text-[12.5px]">
                                    Visible to the program
                                </div>
                                <Switch
                                    checked={shared}
                                    onCheckedChange={setShared}
                                    aria-label="Share the commitment"
                                />
                            </div>
                        </>
                    )}
                    <FormError message={error} />
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                        Cancel
                    </Button>
                    <Button
                        onClick={() => void save()}
                        disabled={
                            busy ||
                            !decision.trim() ||
                            (withCommitment && (!title.trim() || !owner.trim() || !due))
                        }
                    >
                        Record
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
