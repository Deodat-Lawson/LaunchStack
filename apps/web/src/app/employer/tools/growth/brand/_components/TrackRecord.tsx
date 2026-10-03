"use client";

import { ToolLink } from "~/components/tool-app/ToolLink";
import { InlineError } from "~/components/tools/EmptyState";
import { SectionHeading } from "~/components/tools/PageHeader";
import { SkeletonRows } from "~/components/tools/SkeletonRows";
import { Button } from "~/components/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "~/components/ui/table";
import type { TrackRecord, TrackRecordRow } from "~/lib/scenarios/types";
import { percent } from "~/lib/scenarios/words";
import { plural, shortDate } from "~/lib/tools/format";
import { useResource } from "~/lib/tools/useResource";

import { useGrowthPaths } from "../../_lib/paths";
import { brandApi, type BrandPlatform } from "../api";
import { NETWORK_LABEL } from "./NetworkMark";

/** Agreement this strong or more reads as "ranked the same way". */
const AGREES = 0.3;

function networkName(network: string): string {
    return NETWORK_LABEL[network as BrandPlatform] ?? network;
}

/**
 * Whether post tests have been worth anything: for drafts tested before they
 * went out, the simulated engagement against the real one. Says nothing until
 * enough tested posts have real numbers, and then only what the numbers say.
 */
export function TrackRecordSection() {
    const res = useResource("brand:post-tests:track-record", () => brandApi.trackRecord());
    const record = res.data?.record ?? null;
    return (
        <section>
            <SectionHeading title="Post tests" aside="Simulated against real engagement" />
            {res.error ? (
                <InlineError message={res.error} onRetry={() => void res.reload()} />
            ) : !record ? (
                <SkeletonRows rows={3} height={44} />
            ) : (
                <div className="border-line bg-panel overflow-hidden rounded-lg border">
                    <div className="px-4 py-3.5">
                        {record.withResults < record.minimum || record.spearman === null ? (
                            <NotEnough record={record} />
                        ) : (
                            <Agreement record={record} spearman={record.spearman} />
                        )}
                    </div>
                    {record.rows.length > 0 && <Rows rows={record.rows} />}
                </div>
            )}
        </section>
    );
}

function NotEnough({ record }: { record: TrackRecord }) {
    const paths = useGrowthPaths();
    const waiting = record.tested - record.withResults;
    return (
        <div className="flex flex-col items-start gap-2">
            <div className="text-ink text-sm font-medium">
                Not enough tested posts with results yet ({record.withResults} of {record.minimum})
            </div>
            <p className="text-ink-2 max-w-[70ch] text-[13px] leading-relaxed">
                Test a draft in Compose, then publish that same text. Once {record.minimum} tested
                posts have real numbers from their network, this shows whether the posts the
                simulation liked also did better for real.
                {record.tested > 0 &&
                    ` ${plural(record.tested, "tested post")} so far${waiting > 0 ? `, ${waiting} waiting for impressions` : ""}.`}
            </p>
            <Button asChild size="sm" variant="outline">
                <ToolLink href={paths.brand("/compose")}>Compose a post</ToolLink>
            </Button>
        </div>
    );
}

function Agreement({ record, spearman }: { record: TrackRecord; spearman: number }) {
    const agrees = spearman >= AGREES;
    return (
        <div className="flex flex-col gap-1.5">
            <div className="text-ink text-sm font-medium">
                {agrees
                    ? "Posts the simulation ranked higher also did better for real."
                    : "Posts the simulation ranked higher did not do better for real."}
            </div>
            <p className="text-ink-2 max-w-[75ch] text-[13px] leading-relaxed">
                Rank agreement <span className="font-mono tabular-nums">{spearman.toFixed(2)}</span>{" "}
                across {plural(record.withResults, "post")}: 1 would mean the same order, 0 no
                relation, below 0 the opposite order. The simulation put {record.hits} of{" "}
                {record.total} on the right side of the median — above it for real when it expected
                above, below when it expected below.
            </p>
            {record.withResults < 15 && (
                <p className="text-ink-3 text-xs">
                    {plural(record.withResults, "post")} is a small sample: read this as a hint, not
                    proof.
                </p>
            )}
        </div>
    );
}

function Rows({ rows }: { rows: TrackRecordRow[] }) {
    return (
        <div className="border-line-2 overflow-x-auto border-t">
            <Table className="min-w-[620px] text-[13px]">
                <TableHeader>
                    <TableRow className="hover:bg-transparent">
                        <TableHead className="text-ink-3 pl-4 text-xs font-medium">Post</TableHead>
                        <TableHead className="text-ink-3 text-xs font-medium">Network</TableHead>
                        <TableHead className="text-ink-3 text-xs font-medium">Published</TableHead>
                        <TableHead className="text-ink-3 text-right text-xs font-medium">
                            Simulated
                        </TableHead>
                        <TableHead className="text-ink-3 pr-4 text-right text-xs font-medium">
                            Real
                        </TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {rows.map(row => (
                        <TableRow key={`${row.runId}-${row.postId}`}>
                            <TableCell
                                className="text-ink max-w-[320px] truncate pl-4"
                                title={row.text}
                            >
                                {row.text}
                            </TableCell>
                            <TableCell className="text-ink-2">{networkName(row.network)}</TableCell>
                            <TableCell className="text-ink-2 tabular-nums">
                                {row.publishedAt ? shortDate(row.publishedAt) : "not yet"}
                            </TableCell>
                            <TableCell className="text-ink-2 text-right font-mono tabular-nums">
                                {percent(row.predicted)}
                            </TableCell>
                            <TableCell className="pr-4 text-right font-mono tabular-nums">
                                {row.actual === null ? (
                                    <span className="text-ink-3 font-sans text-xs">
                                        waiting for impressions
                                    </span>
                                ) : (
                                    <span className="text-ink">{percent(row.actual)}</span>
                                )}
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}
