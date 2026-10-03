"use client";

import { Pencil, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";

import { EmptyState, InlineError } from "~/components/tools/EmptyState";
import { PageHeader, SectionHeading } from "~/components/tools/PageHeader";
import { SkeletonBlock, SkeletonRows } from "~/components/tools/SkeletonRows";
import { plural, relativeTime } from "~/lib/tools/format";
import { useResource } from "~/lib/tools/useResource";
import { Cite, EvidenceRows } from "../_components/Cite";
import { useProposals } from "../_lib/context";
import { proposalsApi, type ProfileDto, type ProfileFactDto } from "../api";

const APPLICANT_WORD: Record<string, string> = {
    nonprofit: "Nonprofit",
    small_business: "Small business",
    for_profit: "Company",
    individual: "Individual",
    any: "Not stated",
};

function Chip({ children }: { children: React.ReactNode }) {
    return (
        <span className="border-line text-ink-2 inline-flex h-[22px] items-center rounded-full border px-2.5 text-[11.5px]">
            {children}
        </span>
    );
}

function FactRow({
    fact,
    evidence,
    onSave,
}: {
    fact: ProfileFactDto;
    evidence: ProfileDto["evidence"];
    onSave: (value: string) => Promise<void>;
}) {
    const [editing, setEditing] = useState(false);
    const [value, setValue] = useState(fact.value);
    const [busy, setBusy] = useState(false);
    useEffect(() => setValue(fact.value), [fact.value]);
    const save = async () => {
        setBusy(true);
        try {
            await onSave(value);
            setEditing(false);
        } finally {
            setBusy(false);
        }
    };
    return (
        <div className="border-line-2 @max-md:grid-cols-1 @max-md:gap-y-1 grid grid-cols-[180px_minmax(0,1fr)_auto] gap-x-4 gap-y-4 border-t px-4 py-3 first:border-t-0">
            <div className="text-ink-3 @max-md:pt-0 pt-0.5 text-xs">
                {fact.label}
                {fact.source === "manual" && <span className="ml-1">· edited</span>}
            </div>
            {editing ? (
                <div className="grid gap-2">
                    <Textarea
                        value={value}
                        onChange={e => setValue(e.target.value)}
                        rows={3}
                        className="text-[13px]"
                        aria-label={`Edit ${fact.label}`}
                        autoFocus
                    />
                    <div className="flex gap-2">
                        <Button size="sm" onClick={() => void save()} disabled={busy}>
                            Save
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                                setValue(fact.value);
                                setEditing(false);
                            }}
                            disabled={busy}
                        >
                            Cancel
                        </Button>
                        <span className="text-ink-3 self-center text-xs">
                            Clear the text to remove the fact.
                        </span>
                    </div>
                </div>
            ) : (
                <p className="text-ink text-[13.5px] leading-relaxed">
                    {fact.value}
                    {fact.cites.map(n => (
                        <Cite key={n} n={n} evidence={evidence} />
                    ))}
                </p>
            )}
            {!editing && (
                <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 justify-self-end"
                    aria-label={`Edit ${fact.label}`}
                    onClick={() => setEditing(true)}
                >
                    <Pencil className="size-3.5" />
                </Button>
            )}
        </div>
    );
}

/**
 * What the sources can prove about the organisation, fact by fact, each
 * with its evidence. Built once from every source; edited by hand where a
 * document is out of date; rebuilt after new reports land.
 */
export function ProfileScreen() {
    const { trackRun, finishedTick, activeRun } = useProposals();
    const res = useResource("proposals:profile", () => proposalsApi.profile());
    const reload = res.reload;
    useEffect(() => {
        if (finishedTick > 0) void reload();
    }, [finishedTick, reload]);
    const building =
        res.data?.profile.status === "building" ||
        (activeRun?.kind === "profile" &&
            (activeRun.status === "running" || activeRun.status === "queued"));
    const [adding, setAdding] = useState(false);
    const [newLabel, setNewLabel] = useState("");
    const [newValue, setNewValue] = useState("");

    const p = res.data?.profile;
    const build = async () => {
        try {
            const { run } = await proposalsApi.buildProfile();
            trackRun(run);
            res.mutate(current => ({ profile: { ...current.profile, status: "building" } }));
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not start building the profile");
        }
    };
    const saveFact = async (key: string, value: string, label?: string) => {
        try {
            const { profile } = await proposalsApi.patchFact({ key, label, value });
            res.mutate(() => ({ profile }));
            toast.success(value.trim() ? "Fact saved" : "Fact removed");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not save the fact");
            throw e;
        }
    };

    const sub = p
        ? p.status === "ready"
            ? `${plural(p.facts.length, "fact")} from ${plural(p.builtFrom?.documents ?? 0, "source")} · built ${relativeTime(p.builtAt)}`
            : building
              ? "Reading your sources now"
              : p.status === "failed"
                ? "The last build failed"
                : `${plural(p.sources, "source")} in the workspace to read from`
        : undefined;

    return (
        <div className="mx-auto flex max-w-[1000px] flex-col gap-7">
            <PageHeader
                title="What your sources"
                accent="can prove"
                sub={sub}
                actions={
                    <Button size="sm" onClick={() => void build()} disabled={building || !p}>
                        {p?.status === "ready" ? "Rebuild profile" : "Build profile"}
                    </Button>
                }
            />
            {res.error && <InlineError message={res.error} onRetry={() => void res.reload()} />}
            {p?.status === "failed" && p.error && (
                <InlineError message={p.error} onRetry={() => void build()} />
            )}

            {res.loading || !p ? (
                <SkeletonRows rows={5} height={56} />
            ) : p.status === "empty" || (p.status === "failed" && p.facts.length === 0) ? (
                <EmptyState
                    title="No profile yet"
                    body={
                        p.sources > 0
                            ? `Reads your ${plural(p.sources, "source")} — past proposals, reports, your website — and keeps the facts a proposal writer needs at hand, each with the document that proves it.`
                            : "Add a few sources first: past proposals, annual reports, your website. The profile is built from what they say."
                    }
                    action={
                        p.sources > 0 ? (
                            <Button size="sm" onClick={() => void build()} disabled={building}>
                                Build profile
                            </Button>
                        ) : undefined
                    }
                />
            ) : building && p.facts.length === 0 ? (
                <SkeletonBlock lines={5} />
            ) : (
                <>
                    <section>
                        <p className="text-ink max-w-[70ch] text-[14px] leading-relaxed">
                            {p.summary}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-1.5">
                            {p.applicantType && <Chip>{APPLICANT_WORD[p.applicantType]}</Chip>}
                            {p.focusAreas.map(f => (
                                <Chip key={f}>{f}</Chip>
                            ))}
                            {p.geography.map(g => (
                                <Chip key={`g:${g}`}>{g}</Chip>
                            ))}
                        </div>
                    </section>

                    <section>
                        <SectionHeading
                            title="Facts"
                            aside={`${plural(p.facts.length, "fact")} · hover a number to see the source`}
                        />
                        <div className="border-line bg-panel overflow-hidden rounded-lg border">
                            {p.facts.map(fact => (
                                <FactRow
                                    key={fact.key}
                                    fact={fact}
                                    evidence={p.evidence}
                                    onSave={value => saveFact(fact.key, value)}
                                />
                            ))}
                            {adding ? (
                                <form
                                    className="border-line-2 grid gap-2 border-t px-4 py-3"
                                    onSubmit={e => {
                                        e.preventDefault();
                                        if (!newLabel.trim() || !newValue.trim()) return;
                                        void saveFact(newLabel, newValue, newLabel.trim()).then(
                                            () => {
                                                setAdding(false);
                                                setNewLabel("");
                                                setNewValue("");
                                            }
                                        );
                                    }}
                                >
                                    <div className="@max-md:grid-cols-1 grid grid-cols-[180px_minmax(0,1fr)] gap-1.5">
                                        <div className="grid gap-1">
                                            <Label htmlFor="fact-label" className="text-xs">
                                                Label
                                            </Label>
                                            <Input
                                                id="fact-label"
                                                value={newLabel}
                                                onChange={e => setNewLabel(e.target.value)}
                                                placeholder="Annual budget"
                                                autoFocus
                                            />
                                        </div>
                                        <div className="grid gap-1">
                                            <Label htmlFor="fact-value" className="text-xs">
                                                Value
                                            </Label>
                                            <Textarea
                                                id="fact-value"
                                                value={newValue}
                                                onChange={e => setNewValue(e.target.value)}
                                                rows={2}
                                                placeholder="$1.2m in FY2025, 60% from foundations"
                                                className="text-[13px]"
                                            />
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        <Button size="sm" type="submit">
                                            Add fact
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            type="button"
                                            onClick={() => setAdding(false)}
                                        >
                                            Cancel
                                        </Button>
                                    </div>
                                </form>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => setAdding(true)}
                                    className="text-ink-2 hover:text-ink border-line-2 focus-visible:ring-brand/50 flex w-full items-center gap-2 border-t px-4 py-2.5 text-left text-[13px] outline-none focus-visible:ring-2"
                                >
                                    <Plus className="size-3.5" />
                                    Add a fact the documents do not say
                                </button>
                            )}
                        </div>
                    </section>

                    <section>
                        <SectionHeading
                            title="Evidence"
                            aside={`${plural(p.evidence.length, "excerpt")} the facts cite`}
                        />
                        <EvidenceRows evidence={p.evidence} />
                    </section>
                </>
            )}
        </div>
    );
}
