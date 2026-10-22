"use client";

import { useDialogFocus } from "../_lib/useDialogFocus";

import { useEffect, useRef, useState } from "react";
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

import {
    vantageApi,
    vantageErrorMessage,
    VantageApiError,
    type DecisionInput,
    type TopicDto,
    type TopicV1Dto,
    type TopicInput,
    type VantageFact,
} from "../api";
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
    initial: (TopicDto | TopicV1Dto) | null;
    onSaved: (topic: TopicDto) => void;
}) {
    const dialogFocus = useDialogFocus();
    const [title, setTitle] = useState("");
    const [factsText, setFactsText] = useState("");
    const [why, setWhy] = useState("");
    const [decision, setDecision] = useState("");
    const [next, setNext] = useState("");
    const [owner, setOwner] = useState("");
    const [due, setDue] = useState("");
    const [help, setHelp] = useState("");
    const [unknowns, setUnknowns] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [conflict, setConflict] = useState<TopicV1Dto | null>(null);
    const [baseContentVersion, setBaseContentVersion] = useState(1);
    const [baseFacts, setBaseFacts] = useState<VantageFact[]>([]);

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
        setBaseFacts(initial?.facts ?? []);
        setError(null);
        setConflict(null);
        setBaseContentVersion(initial && "contentVersion" in initial ? initial.contentVersion : 1);
    }, [open, initial]);

    const loadTopicIntoForm = (topic: TopicDto) => {
        setTitle(topic.title);
        setFactsText(topic.facts.map(f => f.text).join("\n"));
        setBaseFacts(topic.facts);
        setWhy(topic.whyItMatters ?? "");
        setDecision(topic.decisionQuestion ?? "");
        setNext(topic.proposedNextStep ?? "");
        setOwner(topic.proposedOwner ?? "");
        setDue(topic.proposedDue ?? "");
        setHelp(topic.helpRequested ?? "");
        setUnknowns(topic.unknowns.join("\n"));
    };

    const saving = useRef(false);
    const save = async () => {
        if (saving.current) return;
        saving.current = true;
        setBusy(true);
        setError(null);
        try {
            // Keep the sources of facts whose text is unchanged; a rewritten
            // or new line has none until the next draft cites it.
            const previous = new Map((conflict?.facts ?? baseFacts).map(f => [f.text, f]));
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
                shared: false,
            };
            const expectedContentVersion = conflict?.contentVersion ?? baseContentVersion;
            const { topic } = initial
                ? await vantageApi.patchTopic(initial.id, input, expectedContentVersion)
                : await vantageApi.addTopic(agendaId, input);
            setConflict(null);
            setBaseFacts(facts);
            if ("contentVersion" in topic) setBaseContentVersion(topic.contentVersion);
            toast(initial ? "Topic saved" : "Topic added");
            onSaved(topic);
            onOpenChange(false);
        } catch (e) {
            if (initial && e instanceof VantageApiError && e.status === 409) {
                try {
                    const { agenda } = await vantageApi.agenda(agendaId);
                    const latest = agenda.topics.find(topic => topic.id === initial.id);
                    if (latest) {
                        setConflict(latest);
                        setError(
                            `This topic changed in another tab. Compare the saved version below, then load it or deliberately reapply your edits.`
                        );
                        return;
                    }
                } catch {
                    // Keep the original conflict message when the comparison read is unavailable.
                }
            }
            setError(vantageErrorMessage(e));
        } finally {
            saving.current = false;
            setBusy(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={value => !busy && onOpenChange(value)}>
            <DialogContent
                {...dialogFocus}
                className="max-h-[90dvh] overflow-y-auto sm:max-w-[640px]"
            >
                <DialogHeader>
                    <DialogTitle>{initial ? "Edit topic" : "Add a topic"}</DialogTitle>
                    <DialogDescription>
                        A topic is a decision with its evidence. If there is no decision to make, it
                        is an update, not a topic.
                    </DialogDescription>
                </DialogHeader>
                <fieldset disabled={busy} className="grid min-w-0 gap-3.5">
                    <Field label="Title" htmlFor="t-title">
                        <Input
                            id="t-title"
                            maxLength={300}
                            value={title}
                            onChange={e => setTitle(e.target.value)}
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
                            maxLength={2000}
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
                            maxLength={1000}
                            value={decision}
                            onChange={e => setDecision(e.target.value)}
                            placeholder="Improve onboarding, or spend next week on another acquisition channel?"
                        />
                    </Field>
                    <Field label="Proposed next step" htmlFor="t-next">
                        <Input
                            id="t-next"
                            maxLength={1000}
                            value={next}
                            onChange={e => setNext(e.target.value)}
                            placeholder="Cut onboarding to three screens and re-measure for one week"
                        />
                    </Field>
                    <div className="grid gap-3.5 sm:grid-cols-2">
                        <Field label="Owner" htmlFor="t-owner">
                            <Input
                                id="t-owner"
                                maxLength={200}
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
                        hint="What would help resolve this topic"
                    >
                        <Input
                            id="t-help"
                            maxLength={1000}
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
                    <p className="text-ink-3 text-xs">
                        This topic stays private in the test workspace.
                    </p>
                    <FormError message={error} />
                </fieldset>
                {conflict && (
                    <section
                        aria-label="Topic conflict comparison"
                        className="border-danger/30 bg-danger/5 text-ink-2 grid gap-2 rounded-lg border p-3 text-sm"
                    >
                        <p className="text-danger font-medium">
                            Saved version {conflict.contentVersion} is newer than the version you
                            edited.
                        </p>
                        <p>
                            Latest saved title: <strong>{conflict.title}</strong>
                        </p>
                        <dl className="grid gap-1 text-xs">
                            <div>
                                <dt className="inline font-medium">Facts: </dt>
                                <dd className="inline">
                                    {conflict.facts.map(fact => fact.text).join("; ") || "None"}
                                </dd>
                            </div>
                            <div>
                                <dt className="inline font-medium">Decision: </dt>
                                <dd className="inline">{conflict.decisionQuestion || "None"}</dd>
                            </div>
                            <div>
                                <dt className="inline font-medium">Why it matters: </dt>
                                <dd className="inline">{conflict.whyItMatters || "None"}</dd>
                            </div>
                            <div>
                                <dt className="inline font-medium">Next step: </dt>
                                <dd className="inline">{conflict.proposedNextStep || "None"}</dd>
                            </div>
                            <div>
                                <dt className="inline font-medium">Owner / due: </dt>
                                <dd className="inline">
                                    {conflict.proposedOwner ?? "Unassigned"} /{" "}
                                    {conflict.proposedDue ?? "No due date"}
                                </dd>
                            </div>
                            <div>
                                <dt className="inline font-medium">Help requested: </dt>
                                <dd className="inline">{conflict.helpRequested ?? "None"}</dd>
                            </div>
                            <div>
                                <dt className="inline font-medium">Unknowns: </dt>
                                <dd className="inline">{conflict.unknowns.join("; ") || "None"}</dd>
                            </div>
                        </dl>
                        <div className="flex flex-wrap gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => {
                                    loadTopicIntoForm(conflict);
                                    setBaseContentVersion(conflict.contentVersion);
                                    setConflict(null);
                                    setError(null);
                                }}
                            >
                                Load latest version
                            </Button>
                            <Button
                                type="button"
                                onClick={() => {
                                    setError(null);
                                    void save();
                                }}
                            >
                                Reapply my edits
                            </Button>
                        </div>
                    </section>
                )}
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                        Cancel
                    </Button>
                    <Button
                        onClick={() => void save()}
                        disabled={busy || !title.trim() || Boolean(conflict)}
                    >
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
    const dialogFocus = useDialogFocus();
    const [title, setTitle] = useState("");
    const [owner, setOwner] = useState("");
    const [due, setDue] = useState("");
    const [test, setTest] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const saving = useRef(false);
    const uncertain = useRef(new Map<string, DecisionInput>());
    const [retrying, setRetrying] = useState(false);

    useEffect(() => {
        if (!open || !topic) return;
        setDecision(topic.decision ?? "");
        setWithCommitment(!topic.commitmentId);
        setTitle(topic.proposedNextStep || topic.title);
        setOwner(topic.proposedOwner ?? "");
        setDue(topic.proposedDue ?? addDaysIso(todayIso(), 7));
        setTest("");
        const pending = uncertain.current.get(topic.id);
        setRetrying(Boolean(pending));
        if (pending) {
            setDecision(pending.decision);
            setWithCommitment(Boolean(pending.commitment));
            setTitle(pending.commitment?.title ?? "");
            setOwner(pending.commitment?.owner ?? "");
            setDue(pending.commitment?.dueOn ?? "");
            setTest(pending.commitment?.test ?? "");
        }
        setError(
            pending
                ? "The previous submission was not confirmed. Retry it unchanged to safely retrieve the saved result."
                : null
        );
    }, [open, topic]);

    const save = async () => {
        if (!topic || saving.current) return;
        const payload: DecisionInput = uncertain.current.get(topic.id) ?? {
            decision,
            commitment:
                withCommitment && !topic.commitmentId
                    ? { title, owner, dueOn: due, test: test.trim(), shared: false }
                    : null,
        };
        saving.current = true;
        setBusy(true);
        setError(null);
        try {
            const { topic: saved } = await vantageApi.decide(topic.id, payload);
            uncertain.current.delete(topic.id);
            setRetrying(false);
            toast(payload.commitment ? "Decision and primary action saved" : "Decision saved");
            onSaved(saved);
            onOpenChange(false);
        } catch (e) {
            // A lost response may follow a committed transaction. Freeze the exact
            // payload until its retry confirms the result; keep its existing key.
            if (!(e instanceof VantageApiError) || e.status >= 500) {
                uncertain.current.set(topic.id, payload);
                setRetrying(true);
            }
            setError(vantageErrorMessage(e));
        } finally {
            saving.current = false;
            setBusy(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={value => !busy && onOpenChange(value)}>
            <DialogContent {...dialogFocus} className="sm:max-w-[560px]">
                <DialogHeader>
                    <DialogTitle>Save Decision</DialogTitle>
                    <DialogDescription>
                        {topic?.decisionQuestion === "" ? topic?.title : topic?.decisionQuestion}
                    </DialogDescription>
                </DialogHeader>
                <fieldset disabled={busy || retrying} className="grid min-w-0 gap-3.5">
                    <Field label="What was decided" htmlFor="d-decision">
                        <Textarea
                            id="d-decision"
                            maxLength={2000}
                            value={decision}
                            onChange={e => setDecision(e.target.value)}
                            rows={3}
                            placeholder="We fix onboarding first; the channel test waits a week."
                        />
                    </Field>
                    <div className="border-line-2 flex items-center justify-between gap-3 border-t pt-3">
                        <div>
                            <div className="text-ink text-[13px] font-medium">Create action</div>
                            <div className="text-ink-3 text-[11.5px]">
                                {topic?.commitmentId
                                    ? "An action is already linked. This submission keeps it; edit it from Weekly Actions."
                                    : "One primary action per topic, with an owner, due date and success test."}
                            </div>
                        </div>
                        <Switch
                            disabled={Boolean(topic?.commitmentId)}
                            checked={withCommitment}
                            onCheckedChange={setWithCommitment}
                            aria-label="Create action"
                        />
                    </div>
                    {withCommitment && (
                        <>
                            <Field label="Action" htmlFor="d-title">
                                <Input
                                    id="d-title"
                                    maxLength={300}
                                    value={title}
                                    onChange={e => setTitle(e.target.value)}
                                />
                            </Field>
                            <div className="grid gap-3.5 sm:grid-cols-2">
                                <Field label="Owner" htmlFor="d-owner">
                                    <Input
                                        id="d-owner"
                                        maxLength={200}
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
                                    maxLength={1000}
                                    value={test}
                                    onChange={e => setTest(e.target.value)}
                                    placeholder="Activation above 30% for the week"
                                />
                            </Field>
                        </>
                    )}
                </fieldset>
                <FormError message={error} />
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                        Cancel
                    </Button>
                    <Button
                        onClick={() => void save()}
                        disabled={
                            busy ||
                            !decision.trim() ||
                            (withCommitment &&
                                (!title.trim() || !owner.trim() || !due || !test.trim()))
                        }
                    >
                        {busy
                            ? "Saving…"
                            : retrying
                              ? "Retry unchanged submission"
                              : "Save Decision"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
