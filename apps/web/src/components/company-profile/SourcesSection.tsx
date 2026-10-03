"use client";

import { Loader2 } from "lucide-react";

import { Button } from "~/components/ui/button";
import { SourceLink } from "~/components/tools/Cite";
import { SectionHeading } from "~/components/tools/PageHeader";
import type { ProfileSourceDto, SourceOverride } from "~/lib/company-profile/dto";
import { plural } from "~/lib/tools/format";

import { ROLE_WORD } from "./words";

export type SetSource = (source: ProfileSourceDto, override: SourceOverride | null) => void;

/**
 * Which sources the profile was read from and which it set aside, each with
 * the sentence that says why. This is the honest half of the page: a
 * workspace holding only someone else's paper and a few empty mindmaps
 * shows exactly that here, rather than a profile that looks broken.
 */
export function SourcesSection({
    sources,
    canEdit,
    building,
    busyId,
    onSetSource,
}: {
    sources: ProfileSourceDto[];
    canEdit: boolean;
    /** A build is running, so unread sources are being read right now. */
    building: boolean;
    /** The source whose decision is being saved. */
    busyId: number | null;
    onSetSource: SetSource;
}) {
    if (sources.length === 0) return null;
    const counted = sources.filter(s => s.counted);
    const reading = sources.filter(s => !s.counted && s.status === "pending");
    const aside = sources.filter(s => !s.counted && s.status !== "pending");

    const summary = [
        `${counted.length} read for the profile`,
        `${aside.length} set aside`,
        reading.length > 0
            ? `${reading.length} ${building ? "still reading" : "not read yet"}`
            : null,
    ]
        .filter(Boolean)
        .join(" · ");

    return (
        <section aria-label="Sources">
            <SectionHeading title="Sources" aside={summary} />
            <div className="flex flex-col gap-4">
                <SourceGroup
                    title="Read for the profile"
                    note={
                        counted.length > 0
                            ? "Written by you or about you. Their facts count."
                            : "None yet. A source written by you or about you counts."
                    }
                    sources={counted}
                    canEdit={canEdit}
                    building={building}
                    busyId={busyId}
                    onSetSource={onSetSource}
                />
                {reading.length > 0 && (
                    <SourceGroup
                        title="Reading now"
                        note="Each is decided as soon as it has been read."
                        sources={reading}
                        canEdit={canEdit}
                        building={building}
                        busyId={busyId}
                        onSetSource={onSetSource}
                    />
                )}
                {aside.length > 0 && (
                    <SourceGroup
                        title="Set aside"
                        note="Not counted. Each says why."
                        sources={aside}
                        canEdit={canEdit}
                        building={building}
                        busyId={busyId}
                        onSetSource={onSetSource}
                    />
                )}
            </div>
        </section>
    );
}

function SourceGroup({
    title,
    note,
    sources,
    canEdit,
    building,
    busyId,
    onSetSource,
}: {
    title: string;
    note: string;
    sources: ProfileSourceDto[];
    canEdit: boolean;
    building: boolean;
    busyId: number | null;
    onSetSource: SetSource;
}) {
    return (
        <div role="group" aria-label={title}>
            <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2">
                <h3 className="text-ink-2 text-xs font-medium">
                    {title}
                    <span className="text-ink-3 ml-1 font-normal tabular-nums">
                        {sources.length}
                    </span>
                </h3>
                <span className="text-ink-3 text-xs">{note}</span>
            </div>
            {sources.length > 0 && (
                <ul className="border-line bg-panel overflow-hidden rounded-lg border">
                    {sources.map(source => (
                        <SourceRow
                            key={source.documentId}
                            source={source}
                            canEdit={canEdit}
                            building={building}
                            busy={busyId === source.documentId}
                            onSetSource={onSetSource}
                        />
                    ))}
                </ul>
            )}
        </div>
    );
}

function SourceRow({
    source,
    canEdit,
    building,
    busy,
    onSetSource,
}: {
    source: ProfileSourceDto;
    canEdit: boolean;
    building: boolean;
    busy: boolean;
    onSetSource: SetSource;
}) {
    const roleWord =
        source.role !== null
            ? ROLE_WORD[source.role]
            : source.status === "pending"
              ? "Not read yet"
              : null;
    const meta = [
        roleWord,
        source.folder || null,
        source.counted && source.facts > 0 ? plural(source.facts, "fact") : null,
    ].filter((part): part is string => Boolean(part));

    const note =
        source.status === "pending"
            ? null
            : source.status === "failed"
              ? `Could not be read: ${source.error ?? "reading it failed"}. Rebuild to try again.`
              : source.reason;

    // What the reader decided, before any person's call.
    const readerCounts = source.role === "about_us";
    // A call that agrees with the reader changes nothing, so it still offers the flip.
    const overruled = source.override !== null && (source.override === "about_us") !== readerCounts;
    const showFlip = canEdit && source.status !== "failed" && !overruled;
    const showUndo = canEdit && source.override !== null;

    return (
        <li className="border-line-2 @max-md:grid-cols-1 @max-md:gap-y-2 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 border-t px-4 py-3 first:border-t-0">
            <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <SourceLink
                        href={source.href}
                        className="text-ink hover:text-brand-ink focus-visible:ring-brand/50 min-w-0 break-words rounded-sm text-[13px] font-medium outline-none focus-visible:ring-2"
                    >
                        {source.title}
                    </SourceLink>
                    {meta.length > 0 && (
                        <span className="text-ink-3 text-xs">{meta.join(" · ")}</span>
                    )}
                    {source.override !== null && (
                        <span
                            className="text-brand-ink text-xs"
                            title="Someone in the workspace decided this, not the reader."
                        >
                            · your call
                        </span>
                    )}
                </div>
                {source.status === "pending" ? (
                    building ? (
                        <p className="text-ink-3 mt-0.5 inline-flex items-center gap-1.5 text-xs">
                            <Loader2 className="size-3 animate-spin motion-reduce:animate-none" />
                            Reading…
                        </p>
                    ) : (
                        <p className="text-ink-3 mt-0.5 text-xs">Read on the next build.</p>
                    )
                ) : (
                    note && (
                        <p
                            className={
                                source.status === "failed"
                                    ? "text-danger mt-0.5 text-xs leading-relaxed"
                                    : "text-ink-2 mt-0.5 text-xs leading-relaxed"
                            }
                        >
                            {note}
                        </p>
                    )
                )}
            </div>
            {(showFlip || showUndo) && (
                <div className="flex flex-wrap items-center gap-1.5">
                    {showFlip &&
                        (source.counted ? (
                            <Button
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                aria-label={`Set aside: ${source.title}`}
                                onClick={() => onSetSource(source, "set_aside")}
                            >
                                Set aside
                            </Button>
                        ) : (
                            <Button
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                aria-label={`Count this source: ${source.title}`}
                                onClick={() => onSetSource(source, "about_us")}
                            >
                                Count this source
                            </Button>
                        ))}
                    {showUndo && (
                        <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            aria-label={`Undo your call on ${source.title}`}
                            onClick={() => onSetSource(source, null)}
                        >
                            Undo
                        </Button>
                    )}
                </div>
            )}
        </li>
    );
}
