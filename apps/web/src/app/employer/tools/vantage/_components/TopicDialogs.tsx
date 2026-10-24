"use client";

import { useTranslations } from "next-intl";
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
    const t = useTranslations("vantage.topicDialog");
    const tc = useTranslations("common");
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
            toast(initial ? t("saved") : t("added"));
            onSaved(topic);
            onOpenChange(false);
        } catch (e) {
            setError(e instanceof Error ? e.message : t("saveError"));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-[640px]">
                <DialogHeader>
                    <DialogTitle>{initial ? t("editTitle") : t("addTitle")}</DialogTitle>
                    <DialogDescription>{t("description")}</DialogDescription>
                </DialogHeader>
                <div className="grid gap-3.5">
                    <Field label={tc("fields.title")} htmlFor="t-title">
                        <Input
                            id="t-title"
                            value={title}
                            onChange={e => setTitle(e.target.value)}
                            autoFocus
                            placeholder={t("titlePlaceholder")}
                        />
                    </Field>
                    <Field label={t("facts")} htmlFor="t-facts" hint={t("factsHint")}>
                        <Textarea
                            id="t-facts"
                            value={factsText}
                            onChange={e => setFactsText(e.target.value)}
                            rows={3}
                            placeholder={t("factsPlaceholder")}
                        />
                    </Field>
                    <Field label={t("why")} htmlFor="t-why" hint={t("whyHint")}>
                        <Textarea
                            id="t-why"
                            value={why}
                            onChange={e => setWhy(e.target.value)}
                            rows={2}
                        />
                    </Field>
                    <Field label={t("decision")} htmlFor="t-decision" hint={t("decisionHint")}>
                        <Input
                            id="t-decision"
                            value={decision}
                            onChange={e => setDecision(e.target.value)}
                            placeholder={t("decisionPlaceholder")}
                        />
                    </Field>
                    <Field label={t("next")} htmlFor="t-next">
                        <Input
                            id="t-next"
                            value={next}
                            onChange={e => setNext(e.target.value)}
                            placeholder={t("nextPlaceholder")}
                        />
                    </Field>
                    <div className="grid gap-3.5 sm:grid-cols-2">
                        <Field label={t("owner")} htmlFor="t-owner">
                            <Input
                                id="t-owner"
                                value={owner}
                                onChange={e => setOwner(e.target.value)}
                                placeholder={t("ownerPlaceholder")}
                            />
                        </Field>
                        <Field label={t("due")} htmlFor="t-due">
                            <Input
                                id="t-due"
                                type="date"
                                value={due}
                                onChange={e => setDue(e.target.value)}
                            />
                        </Field>
                    </div>
                    <Field label={t("help")} htmlFor="t-help" hint={t("helpHint")}>
                        <Input
                            id="t-help"
                            value={help}
                            onChange={e => setHelp(e.target.value)}
                            placeholder={tc("status.optional")}
                        />
                    </Field>
                    <Field label={t("unknowns")} htmlFor="t-unknowns" hint={t("unknownsHint")}>
                        <Textarea
                            id="t-unknowns"
                            value={unknowns}
                            onChange={e => setUnknowns(e.target.value)}
                            rows={2}
                        />
                    </Field>
                    <div className="border-line-2 flex items-center justify-between gap-3 border-t pt-3">
                        <div>
                            <div className="text-ink text-[13px] font-medium">{t("share")}</div>
                            <div className="text-ink-3 text-[11.5px]">{t("shareHint")}</div>
                        </div>
                        <Switch
                            checked={shared}
                            onCheckedChange={setShared}
                            aria-label={t("sharedAria")}
                        />
                    </div>
                    <FormError message={error} />
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                        {tc("actions.cancel")}
                    </Button>
                    <Button onClick={() => void save()} disabled={busy || !title.trim()}>
                        {initial ? tc("actions.save") : t("submit")}
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
    const t = useTranslations("vantage.decisionDialog");
    const tt = useTranslations("vantage.topicDialog");
    const tc = useTranslations("common");
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
            toast(withCommitment ? t("recordedWithCommitment") : t("recorded"));
            onSaved(saved);
            onOpenChange(false);
        } catch (e) {
            setError(e instanceof Error ? e.message : tt("saveError"));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[560px]">
                <DialogHeader>
                    <DialogTitle>{t("title")}</DialogTitle>
                    <DialogDescription>
                        {topic?.decisionQuestion === "" ? topic?.title : topic?.decisionQuestion}
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-3.5">
                    <Field label={t("decision")} htmlFor="d-decision">
                        <Textarea
                            id="d-decision"
                            value={decision}
                            onChange={e => setDecision(e.target.value)}
                            rows={3}
                            autoFocus
                            placeholder={t("decisionPlaceholder")}
                        />
                    </Field>
                    <div className="border-line-2 flex items-center justify-between gap-3 border-t pt-3">
                        <div>
                            <div className="text-ink text-[13px] font-medium">
                                {t("openCommitment")}
                            </div>
                            <div className="text-ink-3 text-[11.5px]">
                                {t("openCommitmentHint")}
                            </div>
                        </div>
                        <Switch
                            checked={withCommitment}
                            onCheckedChange={setWithCommitment}
                            aria-label={t("openCommitment")}
                        />
                    </div>
                    {withCommitment && (
                        <>
                            <Field label={t("action")} htmlFor="d-title">
                                <Input
                                    id="d-title"
                                    value={title}
                                    onChange={e => setTitle(e.target.value)}
                                />
                            </Field>
                            <div className="grid gap-3.5 sm:grid-cols-2">
                                <Field label={tt("owner")} htmlFor="d-owner">
                                    <Input
                                        id="d-owner"
                                        value={owner}
                                        onChange={e => setOwner(e.target.value)}
                                        placeholder={t("ownerPlaceholder")}
                                    />
                                </Field>
                                <Field label={tt("due")} htmlFor="d-due">
                                    <Input
                                        id="d-due"
                                        type="date"
                                        value={due}
                                        onChange={e => setDue(e.target.value)}
                                    />
                                </Field>
                            </div>
                            <Field label={t("test")} htmlFor="d-test" hint={t("testHint")}>
                                <Input
                                    id="d-test"
                                    value={test}
                                    onChange={e => setTest(e.target.value)}
                                    placeholder={t("testPlaceholder")}
                                />
                            </Field>
                            <div className="flex items-center justify-between gap-3">
                                <div className="text-ink-2 text-[12.5px]">{t("visible")}</div>
                                <Switch
                                    checked={shared}
                                    onCheckedChange={setShared}
                                    aria-label={t("shareAria")}
                                />
                            </div>
                        </>
                    )}
                    <FormError message={error} />
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                        {tc("actions.cancel")}
                    </Button>
                    <Button
                        onClick={() => void save()}
                        disabled={
                            busy ||
                            !decision.trim() ||
                            (withCommitment && (!title.trim() || !owner.trim() || !due))
                        }
                    >
                        {t("submit")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
