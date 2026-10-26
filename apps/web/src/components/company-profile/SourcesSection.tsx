"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "~/components/ui/button";
import { SourceLink } from "~/components/tools/Cite";
import { SectionHeading } from "~/components/tools/PageHeader";
import type { ProfileSourceDto, SourceOverride } from "~/lib/company-profile/dto";
import { ROLE_KEY, failureText, sourceReasonText } from "./words";

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
    const t = useTranslations("companyProfile.sources");
    if (sources.length === 0) return null;
    const counted = sources.filter(s => s.counted);
    const reading = sources.filter(s => !s.counted && s.status === "pending");
    const aside = sources.filter(s => !s.counted && s.status !== "pending");

    const summary = [
        t("summary.counted", { count: counted.length }),
        t("summary.aside", { count: aside.length }),
        reading.length > 0
            ? building
                ? t("summary.stillReading", { count: reading.length })
                : t("summary.notReadYet", { count: reading.length })
            : null,
    ]
        .filter(Boolean)
        .join(" · ");

    return (
        <section aria-label={t("title")}>
            <SectionHeading title={t("title")} aside={summary} />
            <div className="flex flex-col gap-4">
                <SourceGroup
                    title={t("groups.counted")}
                    note={counted.length > 0 ? t("groups.countedSome") : t("groups.countedNone")}
                    sources={counted}
                    canEdit={canEdit}
                    building={building}
                    busyId={busyId}
                    onSetSource={onSetSource}
                />
                {reading.length > 0 && (
                    <SourceGroup
                        title={t("groups.reading")}
                        note={t("groups.readingNote")}
                        sources={reading}
                        canEdit={canEdit}
                        building={building}
                        busyId={busyId}
                        onSetSource={onSetSource}
                    />
                )}
                {aside.length > 0 && (
                    <SourceGroup
                        title={t("groups.aside")}
                        note={t("groups.asideNote")}
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
    const t = useTranslations("companyProfile.sources");
    const tf = useTranslations("companyProfile.facts");
    const ts = useTranslations("companyProfile.server");
    const tc = useTranslations("common");
    const reason = sourceReasonText(ts, source);
    const roleWord =
        source.role !== null
            ? t(`roles.${ROLE_KEY[source.role]}`)
            : source.status === "pending"
              ? t("roles.notReadYet")
              : null;
    const meta = [
        roleWord,
        source.folder || null,
        source.counted && source.facts > 0 ? tf("count", { count: source.facts }) : null,
    ].filter((part): part is string => Boolean(part));

    const note =
        source.status === "pending"
            ? null
            : source.status === "failed"
              ? t("row.failed", { error: failureText(ts, source) ?? t("row.readingFailed") })
              : reason;

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
                        <span className="text-brand-ink text-xs" title={t("row.yourCallTitle")}>
                            {t("row.yourCall")}
                        </span>
                    )}
                </div>
                {source.status === "pending" ? (
                    building ? (
                        <p className="text-ink-3 mt-0.5 inline-flex items-center gap-1.5 text-xs">
                            <Loader2 className="size-3 animate-spin motion-reduce:animate-none" />
                            {t("row.reading")}
                        </p>
                    ) : (
                        <p className="text-ink-3 mt-0.5 text-xs">{reason ?? t("row.nextBuild")}</p>
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
                                aria-label={t("row.setAsideLabel", { title: source.title })}
                                onClick={() => onSetSource(source, "set_aside")}
                            >
                                {t("row.setAside")}
                            </Button>
                        ) : (
                            <Button
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                aria-label={t("row.countLabel", { title: source.title })}
                                onClick={() => onSetSource(source, "about_us")}
                            >
                                {t("row.count")}
                            </Button>
                        ))}
                    {showUndo && (
                        <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            aria-label={t("row.undoLabel", { title: source.title })}
                            onClick={() => onSetSource(source, null)}
                        >
                            {tc("actions.undo")}
                        </Button>
                    )}
                </div>
            )}
        </li>
    );
}
