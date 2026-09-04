"use client";

import { ExternalLink, FileText, Mail, Send } from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/components/ui/select";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "~/components/ui/sheet";
import { Textarea } from "~/components/ui/textarea";

import {
    KIND_LABELS,
    STAGE_LABELS,
    daysAgo,
    formatDate,
    type EventDto,
    type RelationshipStage,
} from "../api";
import type { DistributionState } from "../useDistribution";
import { FitBadge, StageBadge } from "./badges";

const STAGE_OPTIONS = Object.keys(STAGE_LABELS) as RelationshipStage[];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section className="flex flex-col gap-1.5">
            <h3 className="text-ink-3 text-[10px] font-bold uppercase tracking-widest">{title}</h3>
            {children}
        </section>
    );
}

function Cited({ label, ids }: { label: string; ids: number[] }) {
    return (
        <li className="text-ink text-sm">
            {label}{" "}
            <span className="text-ink-3 font-mono text-[11px]">
                {ids.map(id => `E${id}`).join(" ")}
            </span>
        </li>
    );
}

/** Event payloads are untyped JSON; render scalars as text and anything else as JSON. */
function text(value: unknown, fallback = ""): string {
    if (value === null || value === undefined || value === "") return fallback;
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    try {
        return JSON.stringify(value);
    } catch {
        return fallback;
    }
}

function eventText(e: EventDto): string {
    const p = e.payload;
    switch (e.type) {
        case "stage_changed":
            return `Moved ${text(p.from, "?")} → ${text(p.to, "?")}`;
        case "researched":
            return `Researched (${text(p.status, "?")}; fit ${text(p.fitScore, "?")}; ${text(p.evidence, "0")} evidence)`;
        case "note":
            return text(p.text, "Note");
        case "imported":
            return `Imported at stage ${text(p.stage, "?")}`;
        case "agreement_signed": {
            const ends = text(p.endsOn);
            return `Agreement recorded (${text(p.exclusivity, "none")}${ends ? `, ends ${ends}` : ""})`;
        }
        case "owner_changed":
            return `Owner set to ${text(p.ownerUserId, "?")}`;
        case "next_action_set":
            return `Next action: ${text(p.nextAction, "—")}`;
        case "reply_logged": {
            const summary = text(p.summary);
            return `Reply logged${summary ? `: ${summary}` : ""}`;
        }
        case "meeting": {
            const summary = text(p.summary);
            return `Meeting${summary ? `: ${summary}` : ""}`;
        }
        case "document_shared": {
            const title = text(p.title);
            return `Document shared${title ? `: ${title}` : ""}`;
        }
        default:
            return e.type;
    }
}

export function PartnerDrawer({ state }: { state: DistributionState }) {
    const detail = state.detail;
    const open = state.detailId !== null;
    const [stage, setStage] = useState<RelationshipStage | "">("");
    const [owner, setOwner] = useState("");
    const [nextAction, setNextAction] = useState("");
    const [nextActionAt, setNextActionAt] = useState("");
    const [note, setNote] = useState("");
    const [logType, setLogType] = useState<"reply_logged" | "meeting" | "document_shared">(
        "reply_logged"
    );
    const [logSummary, setLogSummary] = useState("");
    const [agreement, setAgreement] = useState({
        exclusivity: "none",
        startsOn: "",
        endsOn: "",
        renewal: "",
        notes: "",
    });
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!detail) return;
        setStage(detail.relationship.stage);
        setOwner(detail.relationship.ownerUserId ?? "");
        setNextAction(detail.relationship.nextAction ?? "");
        setNextActionAt(
            detail.relationship.nextActionAt ? detail.relationship.nextActionAt.slice(0, 10) : ""
        );
        setNote("");
    }, [detail]);

    const r = detail?.relationship;
    const org = detail?.org;
    const dossier = r?.dossier ?? null;

    const save = async () => {
        if (!r) return;
        setBusy(true);
        const patch: Record<string, unknown> = {};
        if (stage && stage !== r.stage) patch.stage = stage;
        if ((owner || null) !== r.ownerUserId) patch.ownerUserId = owner || null;
        if ((nextAction || null) !== r.nextAction) patch.nextAction = nextAction || null;
        const currentDue = r.nextActionAt ? r.nextActionAt.slice(0, 10) : "";
        if (nextActionAt !== currentDue)
            patch.nextActionAt = nextActionAt
                ? new Date(`${nextActionAt}T09:00:00`).toISOString()
                : null;
        if (note.trim()) patch.note = note.trim();
        if (Object.keys(patch).length > 0) await state.patchRelationship(r.id, patch, "Saved");
        setBusy(false);
    };

    return (
        <Sheet open={open} onOpenChange={o => !o && void state.openPartner(null)}>
            <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
                {!detail || !r || !org ? (
                    <SheetHeader>
                        <SheetTitle>{state.loading.detail ? "Loading…" : "Partner"}</SheetTitle>
                        <SheetDescription />
                    </SheetHeader>
                ) : (
                    <div className="flex flex-col gap-6 pb-8">
                        <SheetHeader className="p-0">
                            <SheetTitle className="text-ink flex flex-wrap items-center gap-2 text-lg">
                                {org.name}
                                <StageBadge stage={r.stage} />
                                <FitBadge score={r.fitScore} />
                            </SheetTitle>
                            <SheetDescription className="text-ink-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                                <span>
                                    {KIND_LABELS[r.kind]}
                                    {r.territory
                                        ? ` · ${r.territory.region ? `${r.territory.region}, ` : ""}${r.territory.country}`
                                        : ""}
                                </span>
                                {org.domain && (
                                    <a
                                        className="text-brand-ink inline-flex items-center gap-1 underline-offset-2 hover:underline"
                                        href={`https://${org.domain}`}
                                        target="_blank"
                                        rel="noreferrer"
                                    >
                                        {org.domain} <ExternalLink className="h-3 w-3" />
                                    </a>
                                )}
                                {org.kgEntityId && (
                                    <Badge variant="info">mentioned in your documents</Badge>
                                )}
                                {r.dossierDocumentId && (
                                    <a
                                        className="text-brand-ink inline-flex items-center gap-1 underline-offset-2 hover:underline"
                                        href={`/employer/documents?docId=${r.dossierDocumentId}`}
                                    >
                                        <FileText className="h-3 w-3" /> Dossier in Sources
                                    </a>
                                )}
                            </SheetDescription>
                        </SheetHeader>

                        {(r.riskFlags.length > 0 || r.screening?.status === "flagged") && (
                            <div className="border-warn/50 bg-warn-soft text-warn rounded-md border px-3 py-2 text-xs">
                                {r.screening?.status === "flagged" && (
                                    <p className="mb-1 font-medium">
                                        Compliance screening flagged (advisory,{" "}
                                        {r.screening.provider}):{" "}
                                        {r.screening.flags
                                            ?.map(
                                                f =>
                                                    `${f.matchedName} (${Math.round(f.score * 100)}%)`
                                            )
                                            .join("; ")}
                                    </p>
                                )}
                                <ul className="list-disc pl-4">
                                    {r.riskFlags.map((f, i) => (
                                        <li key={i}>{f}</li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        <Section title="Fit">
                            <p className="text-ink text-sm">
                                {r.fitRationale ?? "Not scored yet."}
                            </p>
                            {r.fitBreakdown && (
                                <p className="text-ink-3 font-mono text-[11px]">
                                    category {r.fitBreakdown.categoryOverlap} · territory{" "}
                                    {r.fitBreakdown.territoryMatch} · role{" "}
                                    {r.fitBreakdown.roleMatch} · evidence{" "}
                                    {r.fitBreakdown.evidenceDepth} · fresh{" "}
                                    {r.fitBreakdown.freshness} · size {r.fitBreakdown.sizeFit} ·
                                    known {r.fitBreakdown.knownSignal}
                                </p>
                            )}
                        </Section>

                        <Section title="Update">
                            <div className="grid gap-3 md:grid-cols-2">
                                <div className="grid gap-1">
                                    <Label className="text-xs">Stage</Label>
                                    <Select
                                        value={stage || undefined}
                                        onValueChange={v => setStage(v as RelationshipStage)}
                                    >
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {STAGE_OPTIONS.map(s => (
                                                <SelectItem key={s} value={s}>
                                                    {STAGE_LABELS[s]}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="grid gap-1">
                                    <Label className="text-xs">Owner (user id or name)</Label>
                                    <Input
                                        value={owner}
                                        onChange={e => setOwner(e.target.value)}
                                        placeholder="who is driving this"
                                    />
                                </div>
                                <div className="grid gap-1">
                                    <Label className="text-xs">Next action</Label>
                                    <Input
                                        value={nextAction}
                                        onChange={e => setNextAction(e.target.value)}
                                        placeholder="Send samples; call purchasing"
                                    />
                                </div>
                                <div className="grid gap-1">
                                    <Label className="text-xs">Due</Label>
                                    <Input
                                        type="date"
                                        value={nextActionAt}
                                        onChange={e => setNextActionAt(e.target.value)}
                                    />
                                </div>
                                <div className="grid gap-1 md:col-span-2">
                                    <Label className="text-xs">Note</Label>
                                    <Textarea
                                        rows={2}
                                        value={note}
                                        onChange={e => setNote(e.target.value)}
                                        placeholder="What happened, what was agreed"
                                    />
                                </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <Button size="sm" onClick={() => void save()} disabled={busy}>
                                    Save
                                </Button>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={
                                        busy ||
                                        ["contracted", "active", "declined"].includes(r.stage)
                                    }
                                    onClick={async () => {
                                        setBusy(true);
                                        await state.outreach([r.id]);
                                        setBusy(false);
                                    }}
                                >
                                    <Mail className="h-4 w-4" /> Draft outreach in Email
                                </Button>
                                <span className="text-ink-3 text-[11px]">
                                    Stage rules: an owner from contacted, a next action from in
                                    conversation, an agreement to reach contracted.
                                </span>
                            </div>
                        </Section>

                        <Section title="Log activity">
                            <div className="flex flex-wrap items-end gap-2">
                                <Select
                                    value={logType}
                                    onValueChange={v => setLogType(v as typeof logType)}
                                >
                                    <SelectTrigger className="w-[170px]">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="reply_logged">Reply received</SelectItem>
                                        <SelectItem value="meeting">Meeting</SelectItem>
                                        <SelectItem value="document_shared">
                                            Document shared
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                                <Input
                                    className="min-w-[220px] flex-1"
                                    value={logSummary}
                                    onChange={e => setLogSummary(e.target.value)}
                                    placeholder="One line summary"
                                />
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    disabled={busy}
                                    onClick={async () => {
                                        setBusy(true);
                                        await state.logEvent(r.id, {
                                            type: logType,
                                            payload: { summary: logSummary },
                                        });
                                        setLogSummary("");
                                        setBusy(false);
                                    }}
                                >
                                    <Send className="h-4 w-4" /> Log
                                </Button>
                            </div>
                        </Section>

                        <Section title={`Dossier${dossier ? "" : " (not yet produced)"}`}>
                            {dossier ? (
                                <div className="flex flex-col gap-3">
                                    <p className="text-ink text-sm">{dossier.summary}</p>
                                    <div className="grid gap-3 md:grid-cols-2">
                                        <div>
                                            <div className="text-ink-2 text-xs font-medium">
                                                Roles
                                            </div>
                                            <p className="text-ink text-sm">
                                                {dossier.roles.join(", ") || "—"}
                                            </p>
                                        </div>
                                        <div>
                                            <div className="text-ink-2 text-xs font-medium">
                                                Size
                                            </div>
                                            <p className="text-ink text-sm">{dossier.sizeBand}</p>
                                        </div>
                                        <div>
                                            <div className="text-ink-2 text-xs font-medium">
                                                Brands carried
                                            </div>
                                            <ul>
                                                {dossier.brandsCarried.map((b, i) => (
                                                    <Cited
                                                        key={i}
                                                        label={b.brand}
                                                        ids={b.evidenceIds}
                                                    />
                                                ))}
                                            </ul>
                                        </div>
                                        <div>
                                            <div className="text-ink-2 text-xs font-medium">
                                                Territories
                                            </div>
                                            <ul>
                                                {dossier.territories.map((t, i) => (
                                                    <Cited
                                                        key={i}
                                                        label={t.territory}
                                                        ids={t.evidenceIds}
                                                    />
                                                ))}
                                            </ul>
                                        </div>
                                        <div>
                                            <div className="text-ink-2 text-xs font-medium">
                                                Retail coverage
                                            </div>
                                            <ul>
                                                {dossier.retailCoverage.map((t, i) => (
                                                    <Cited
                                                        key={i}
                                                        label={t.account}
                                                        ids={t.evidenceIds}
                                                    />
                                                ))}
                                            </ul>
                                        </div>
                                        <div>
                                            <div className="text-ink-2 text-xs font-medium">
                                                Certifications
                                            </div>
                                            <ul>
                                                {dossier.certifications.map((t, i) => (
                                                    <Cited
                                                        key={i}
                                                        label={t.certification}
                                                        ids={t.evidenceIds}
                                                    />
                                                ))}
                                            </ul>
                                        </div>
                                        <div>
                                            <div className="text-ink-2 text-xs font-medium">
                                                Decision makers
                                            </div>
                                            <ul>
                                                {dossier.decisionMakers.map((t, i) => (
                                                    <Cited
                                                        key={i}
                                                        label={`${t.title}${t.name ? ` — ${t.name}` : ""}`}
                                                        ids={t.evidenceIds}
                                                    />
                                                ))}
                                            </ul>
                                        </div>
                                        <div>
                                            <div className="text-ink-2 text-xs font-medium">
                                                Contact channels
                                            </div>
                                            <ul>
                                                {dossier.contactChannels.map((t, i) => (
                                                    <Cited
                                                        key={i}
                                                        label={`${t.channel}: ${t.value}`}
                                                        ids={t.evidenceIds}
                                                    />
                                                ))}
                                            </ul>
                                        </div>
                                    </div>
                                    {dossier.risks.length > 0 && (
                                        <div>
                                            <div className="text-ink-2 text-xs font-medium">
                                                Risks
                                            </div>
                                            <ul>
                                                {dossier.risks.map((t, i) => (
                                                    <Cited
                                                        key={i}
                                                        label={t.risk}
                                                        ids={t.evidenceIds}
                                                    />
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                    {dossier.openQuestions.length > 0 && (
                                        <div>
                                            <div className="text-ink-2 text-xs font-medium">
                                                Open questions
                                            </div>
                                            <ul className="text-ink-2 list-disc pl-4 text-sm">
                                                {dossier.openQuestions.map((q, i) => (
                                                    <li key={i}>{q}</li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <p className="text-ink-2 text-sm">
                                    Run discovery (or wait for the current run) to research this
                                    organisation. Evidence recorded so far is listed below.
                                </p>
                            )}
                        </Section>

                        <Section title={`Evidence (${detail.evidence.length})`}>
                            {detail.evidence.length === 0 ? (
                                <p className="text-ink-2 text-sm">None recorded.</p>
                            ) : (
                                <ul className="divide-line divide-y">
                                    {detail.evidence.map(e => (
                                        <li key={e.id} className="py-2 text-sm">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="text-ink-3 font-mono text-[11px]">
                                                    E{e.id}
                                                </span>
                                                <Badge variant="secondary">
                                                    {e.kind.replace(/_/g, " ")}
                                                </Badge>
                                                <span className="text-ink">{e.claim}</span>
                                            </div>
                                            {e.quote && (
                                                <blockquote className="border-line text-ink-2 mt-1 border-l-2 pl-2 text-xs italic">
                                                    {e.quote}
                                                </blockquote>
                                            )}
                                            <a
                                                className="text-brand-ink mt-1 inline-flex items-center gap-1 text-xs underline-offset-2 hover:underline"
                                                href={e.sourceUrl}
                                                target="_blank"
                                                rel="noreferrer"
                                            >
                                                {e.sourceUrl
                                                    .replace(/^https?:\/\//, "")
                                                    .slice(0, 80)}{" "}
                                                <ExternalLink className="h-3 w-3" />
                                            </a>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </Section>

                        <Section title={`Agreements (${detail.agreements.length})`}>
                            {detail.agreements.map(a => (
                                <div
                                    key={a.id}
                                    className="border-line rounded-md border px-3 py-2 text-sm"
                                >
                                    <span className="text-ink font-medium">{a.exclusivity}</span>
                                    <span className="text-ink-2">
                                        {" "}
                                        · {a.startsOn ?? "?"} → {a.endsOn ?? "open"}
                                        {a.renewalReminderAt
                                            ? ` · renewal reminder ${formatDate(a.renewalReminderAt)}`
                                            : ""}
                                    </span>
                                    {a.territory && a.territory.length > 0 && (
                                        <span className="text-ink-3 ml-2 font-mono text-xs">
                                            {a.territory.map(t => t.country).join(", ")}
                                        </span>
                                    )}
                                </div>
                            ))}
                            <div className="grid gap-2 md:grid-cols-4">
                                <Select
                                    value={agreement.exclusivity}
                                    onValueChange={v =>
                                        setAgreement({ ...agreement, exclusivity: v })
                                    }
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="none">Non-exclusive</SelectItem>
                                        <SelectItem value="semi">Semi-exclusive</SelectItem>
                                        <SelectItem value="exclusive">Exclusive</SelectItem>
                                    </SelectContent>
                                </Select>
                                <Input
                                    type="date"
                                    value={agreement.startsOn}
                                    onChange={e =>
                                        setAgreement({ ...agreement, startsOn: e.target.value })
                                    }
                                    aria-label="Starts on"
                                />
                                <Input
                                    type="date"
                                    value={agreement.endsOn}
                                    onChange={e =>
                                        setAgreement({ ...agreement, endsOn: e.target.value })
                                    }
                                    aria-label="Ends on"
                                />
                                <Input
                                    type="date"
                                    value={agreement.renewal}
                                    onChange={e =>
                                        setAgreement({ ...agreement, renewal: e.target.value })
                                    }
                                    aria-label="Renewal reminder"
                                />
                                <Input
                                    className="md:col-span-3"
                                    value={agreement.notes}
                                    onChange={e =>
                                        setAgreement({ ...agreement, notes: e.target.value })
                                    }
                                    placeholder="Terms: price tier, MOQ, payment terms"
                                />
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    disabled={busy}
                                    onClick={async () => {
                                        setBusy(true);
                                        await state.createAgreement(r.id, {
                                            exclusivity: agreement.exclusivity,
                                            territory: r.territory ? [r.territory] : null,
                                            startsOn: agreement.startsOn || null,
                                            endsOn: agreement.endsOn || null,
                                            renewalReminderAt: agreement.renewal
                                                ? new Date(
                                                      `${agreement.renewal}T09:00:00`
                                                  ).toISOString()
                                                : null,
                                            terms: agreement.notes
                                                ? { notes: agreement.notes }
                                                : {},
                                        });
                                        setAgreement({
                                            exclusivity: "none",
                                            startsOn: "",
                                            endsOn: "",
                                            renewal: "",
                                            notes: "",
                                        });
                                        setBusy(false);
                                    }}
                                >
                                    Add agreement
                                </Button>
                            </div>
                        </Section>

                        <Section title="Timeline">
                            <ol className="border-line ml-1 border-l pl-4">
                                {detail.events.map(e => (
                                    <li key={e.id} className="relative pb-3 text-sm">
                                        <span className="bg-brand absolute -left-[21px] top-1.5 h-2 w-2 rounded-full" />
                                        <div className="text-ink">{eventText(e)}</div>
                                        <div className="text-ink-3 text-[11px]">
                                            {formatDate(e.occurredAt)} · {daysAgo(e.occurredAt)}
                                            {e.actorUserId ? ` · ${e.actorUserId}` : ""}
                                        </div>
                                    </li>
                                ))}
                                {detail.events.length === 0 && (
                                    <li className="text-ink-2 text-sm">No activity yet.</li>
                                )}
                            </ol>
                        </Section>
                    </div>
                )}
            </SheetContent>
        </Sheet>
    );
}
