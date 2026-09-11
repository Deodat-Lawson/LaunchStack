"use client";

import { Loader2, Play } from "lucide-react";
import { useState } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "~/components/ui/table";

import { formatDate, type RunDto } from "../api";
import type { DistributionState } from "../useDistribution";

const ACTIVE = new Set([
    "queued",
    "profiling",
    "planning",
    "gathering",
    "resolving",
    "enriching",
    "screening",
    "scoring",
    "reporting",
]);

function RunStatus({ run }: { run: RunDto }) {
    if (run.status === "completed") return <Badge variant="success">completed</Badge>;
    if (run.status === "failed") return <Badge variant="destructive">failed</Badge>;
    return (
        <Badge variant="info">
            <Loader2 className="h-3 w-3 animate-spin" /> {run.status}
        </Badge>
    );
}

function RunDetail({ run }: { run: RunDto }) {
    const s = run.summary;
    return (
        <div className="text-ink-2 grid gap-2 text-xs md:grid-cols-2">
            {run.plan && (
                <div>
                    <div className="text-ink-3 mb-1 text-[10px] font-bold uppercase tracking-widest">
                        Plan
                    </div>
                    <p className="text-ink">{run.plan.strategy}</p>
                    <p className="mt-1">
                        Adjacent brands: {run.plan.adjacentBrands.join(", ") || "—"}
                    </p>
                    <p>
                        {run.plan.queries.length} queries ·{" "}
                        {run.plan.queries.filter(q => q.kind === "web").length} web ·{" "}
                        {run.plan.queries.filter(q => q.kind === "place").length} place ·{" "}
                        {run.plan.queries.filter(q => q.kind === "trade").length} trade
                    </p>
                </div>
            )}
            {s && (
                <div>
                    <div className="text-ink-3 mb-1 text-[10px] font-bold uppercase tracking-widest">
                        Summary
                    </div>
                    <p>
                        {s.mentions} mentions → {s.resolved} organisations ({s.excluded} excluded) →{" "}
                        {s.shortlisted} shortlisted → {s.enriched} researched
                        {s.gateRejections ? ` · ${s.gateRejections} failed grounding` : ""}
                        {s.budgetExhausted ? ` · ${s.budgetExhausted} hit budget` : ""}
                    </p>
                    <p>
                        {s.screened} screened{s.flagged ? ` (${s.flagged} flagged)` : ""} ·{" "}
                        {s.published} dossiers published · {s.tokens.total.toLocaleString()} tokens
                        · {s.wallMs ? `${Math.round(s.wallMs / 1000)}s` : ""}
                    </p>
                    <p className="mt-1">
                        Sources:{" "}
                        {s.sources
                            .map(
                                src =>
                                    `${src.source} ${src.status}${src.results ? ` (${src.results})` : ""}`
                            )
                            .join(" · ")}
                    </p>
                    {s.warnings.length > 0 && (
                        <ul className="text-warn mt-1 list-disc pl-4">
                            {s.warnings.map((w, i) => (
                                <li key={i}>{w}</li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
            {run.errorMessage && <p className="text-danger md:col-span-2">{run.errorMessage}</p>}
        </div>
    );
}

export function RunsPanel({ state }: { state: DistributionState }) {
    const [maxCandidates, setMaxCandidates] = useState(25);
    const [starting, setStarting] = useState(false);
    const [expanded, setExpanded] = useState<string | null>(null);
    const running = state.runs.some(r => ACTIVE.has(r.status));

    return (
        <div className="flex flex-col gap-4">
            <div className="border-line bg-panel flex flex-wrap items-end gap-3 rounded-xl border p-3">
                <div className="flex flex-col gap-1">
                    <Label
                        htmlFor="max-candidates"
                        className="text-ink-3 text-[10px] uppercase tracking-widest"
                    >
                        Candidates to research
                    </Label>
                    <Input
                        id="max-candidates"
                        type="number"
                        min={1}
                        max={100}
                        className="w-[120px]"
                        value={maxCandidates}
                        onChange={e =>
                            setMaxCandidates(
                                Math.max(1, Math.min(100, Number(e.target.value) || 1))
                            )
                        }
                    />
                </div>
                <Button
                    disabled={!state.programId || starting || running}
                    onClick={async () => {
                        setStarting(true);
                        await state.startRun(maxCandidates);
                        setStarting(false);
                    }}
                >
                    {starting || running ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                        <Play className="h-4 w-4" />
                    )}
                    {running ? "A run is in progress" : "Start discovery run"}
                </Button>
                <p className="text-ink-3 text-xs">
                    Credits are debited per completed candidate, after its research. Existing
                    partners and anyone already contacted are excluded automatically.
                </p>
            </div>

            <div className="border-line bg-panel overflow-x-auto rounded-xl border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Started</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Shortlisted</TableHead>
                            <TableHead className="text-right">Researched</TableHead>
                            <TableHead className="text-right">Credits</TableHead>
                            <TableHead>Finished</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {state.runs.length === 0 && (
                            <TableRow>
                                <TableCell
                                    colSpan={6}
                                    className="text-ink-2 py-8 text-center text-sm"
                                >
                                    No runs yet.
                                </TableCell>
                            </TableRow>
                        )}
                        {state.runs.map(run => (
                            <>
                                <TableRow
                                    key={run.id}
                                    className="cursor-pointer"
                                    onClick={() => setExpanded(expanded === run.id ? null : run.id)}
                                >
                                    <TableCell className="text-xs">
                                        {formatDate(run.createdAt)}
                                    </TableCell>
                                    <TableCell>
                                        <RunStatus run={run} />
                                    </TableCell>
                                    <TableCell className="text-right font-mono text-xs tabular-nums">
                                        {run.summary?.shortlisted ??
                                            run.candidateOrgIds?.length ??
                                            "—"}
                                    </TableCell>
                                    <TableCell className="text-right font-mono text-xs tabular-nums">
                                        {run.summary?.enriched ?? "—"}
                                    </TableCell>
                                    <TableCell className="text-right font-mono text-xs tabular-nums">
                                        {run.creditsUsed.toLocaleString()}
                                    </TableCell>
                                    <TableCell className="text-xs">
                                        {formatDate(run.completedAt)}
                                    </TableCell>
                                </TableRow>
                                {expanded === run.id && (
                                    <TableRow key={`${run.id}-detail`}>
                                        <TableCell colSpan={6} className="bg-panel-2/50">
                                            <RunDetail run={run} />
                                        </TableCell>
                                    </TableRow>
                                )}
                            </>
                        ))}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
