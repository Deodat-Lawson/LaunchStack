"use client";

import { BookOpenText, ExternalLink, Loader2, Users } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState, type ReactNode } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "~/components/ui/dialog";
import { useErrorText } from "~/lib/tools/errorText";
import { cn } from "~/lib/utils";

import {
    acceleratorsApi,
    type ApplicationResponse,
    type SimilarCompaniesView,
    type SimilarCompany,
} from "../api";
import { Notice } from "./ProgramFacts";

type Load =
    | { state: "loading" }
    | { state: "failed"; error: unknown }
    | { state: "ready"; view: SimilarCompaniesView };

type Reading = { name: string; application: ApplicationResponse };

const PREVIEW = 5;
/** Longer pitches start clamped to three lines. */
const PITCH_PREVIEW_CHARS = 240;

/** Past accepted companies like this one, each with how it pitches itself. */
export function SimilarCompanies({ programId }: { programId: string }) {
    const t = useTranslations("accelerators.similar");
    const errorText = useErrorText();
    const [load, setLoad] = useState<Load>({ state: "loading" });
    const [reading, setReading] = useState<Reading | null>(null);

    useEffect(() => {
        let live = true;
        setLoad({ state: "loading" });
        acceleratorsApi
            .similar(programId)
            .then(({ similar }) => live && setLoad({ state: "ready", view: similar }))
            .catch((error: unknown) => live && setLoad({ state: "failed", error }));
        return () => {
            live = false;
        };
    }, [programId]);

    if (load.state === "loading") {
        return (
            <p role="status" className="text-ink-3 flex items-center gap-2 text-sm">
                <Loader2 className="size-4 animate-spin" />
                {t("loading")}
            </p>
        );
    }
    if (load.state === "failed") {
        return <Notice danger>{errorText(load.error, t("loadFailed"))}</Notice>;
    }
    const view = load.view;
    if (!view.supported) {
        return (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
                <Users className="text-ink-3 size-8" />
                <p className="text-ink text-sm font-medium">{t("unsupportedTitle")}</p>
                <p className="text-ink-3 max-w-sm text-xs leading-relaxed">{t("unsupported")}</p>
            </div>
        );
    }
    return (
        <div className="space-y-6">
            <p className="text-ink-3 flex flex-wrap items-center gap-2 text-xs leading-relaxed">
                <Badge variant="success">{t("realData")}</Badge>
                {t("intro", { total: view.totalCompanies })}
            </p>
            {view.profileReady ? (
                <ExpandableList
                    title={t("companiesTitle")}
                    items={view.companies}
                    render={item => (
                        <CompanyRow
                            key={item.company.id}
                            item={item}
                            onRead={application =>
                                setReading({ name: item.company.name, application })
                            }
                        />
                    )}
                />
            ) : (
                <Notice>{t("profileMissing")}</Notice>
            )}
            <ApplicationDialog reading={reading} onClose={() => setReading(null)} />
        </div>
    );
}

function ExpandableList<T>({
    title,
    items,
    render,
}: {
    title: string;
    items: T[];
    render: (item: T) => ReactNode;
}) {
    const t = useTranslations("accelerators.similar");
    const [all, setAll] = useState(false);
    return (
        <section className="space-y-2">
            <h3 className="text-ink text-sm font-semibold">{title}</h3>
            <ul className="divide-line border-line divide-y rounded-xl border">
                {(all ? items : items.slice(0, PREVIEW)).map(render)}
            </ul>
            {items.length > PREVIEW && (
                <Button variant="ghost" size="sm" className="-ml-2" onClick={() => setAll(!all)}>
                    {all ? t("showFewer") : t("showAll", { count: items.length })}
                </Button>
            )}
        </section>
    );
}

function CompanyRow({
    item,
    onRead,
}: {
    item: SimilarCompany;
    onRead: (application: ApplicationResponse) => void;
}) {
    const t = useTranslations("accelerators.similar");
    const [expanded, setExpanded] = useState(false);
    const { company, application } = item;
    const pitch = company.description?.trim() ?? "";
    const long = pitch.length > PITCH_PREVIEW_CHARS;
    return (
        <li className="space-y-2.5 p-3">
            <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1 space-y-1">
                    <p className="flex flex-wrap items-baseline gap-x-2">
                        {company.website && /^https?:\/\//i.test(company.website) ? (
                            <a
                                href={company.website}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-ink text-sm font-medium hover:underline"
                            >
                                {company.name}
                            </a>
                        ) : (
                            <span className="text-ink text-sm font-medium">{company.name}</span>
                        )}
                        <span className="text-ink-3 text-xs">
                            {[company.batch, company.status !== "Active" ? company.status : null]
                                .filter(Boolean)
                                .join(" · ")}
                        </span>
                    </p>
                    {company.oneLiner && (
                        <p className="text-ink-2 text-xs leading-relaxed">{company.oneLiner}</p>
                    )}
                </div>
                {application &&
                    (application.sections ? (
                        <Button
                            variant="outline"
                            size="sm"
                            className="shrink-0"
                            onClick={() => onRead(application)}
                        >
                            <BookOpenText className="size-3.5" />
                            {t("readApplication")}
                        </Button>
                    ) : (
                        <Button asChild variant="outline" size="sm" className="shrink-0">
                            <a
                                href={application.sourceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                {t("readApplication")}
                                <ExternalLink className="size-3.5" />
                            </a>
                        </Button>
                    ))}
            </div>
            {pitch && (
                <div className="border-line space-y-1 border-l-2 pl-3">
                    <p className="text-ink-3 text-xs font-medium">{t("pitchLabel")}</p>
                    <p
                        className={cn(
                            "text-ink-2 whitespace-pre-line break-words text-xs leading-relaxed",
                            long && !expanded && "line-clamp-3"
                        )}
                    >
                        {pitch}
                    </p>
                    {long && (
                        <Button
                            variant="link"
                            className="h-auto p-0 text-xs"
                            aria-expanded={expanded}
                            onClick={() => setExpanded(!expanded)}
                        >
                            {expanded ? t("readLess") : t("readMore")}
                        </Button>
                    )}
                </div>
            )}
            {item.sharedTerms.length > 0 && (
                <p className="text-ink-3 text-xs">
                    {t("sharedTerms", { terms: item.sharedTerms.join(", ") })}
                </p>
            )}
        </li>
    );
}

function ProvenanceBadge({ application }: { application: ApplicationResponse }) {
    const t = useTranslations("accelerators.similar");
    return application.provenance === "original" ? (
        <Badge variant="success">{t("provenance.original")}</Badge>
    ) : (
        <Badge variant="warn">{t("provenance.unverified_copy")}</Badge>
    );
}

function ApplicationDialog({ reading, onClose }: { reading: Reading | null; onClose: () => void }) {
    const t = useTranslations("accelerators.similar");
    const format = useFormatter();
    const response = reading?.application;
    return (
        <Dialog open={reading !== null} onOpenChange={open => !open && onClose()}>
            <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
                {response && (
                    <>
                        <DialogHeader>
                            <DialogTitle>
                                {t("dialogTitle", { name: reading?.name ?? "" })}
                            </DialogTitle>
                            <DialogDescription>{response.note}</DialogDescription>
                        </DialogHeader>
                        <div className="flex flex-wrap items-center gap-2">
                            <ProvenanceBadge application={response} />
                            {response.statedBatch && (
                                <Badge variant="secondary">{response.statedBatch}</Badge>
                            )}
                            <a
                                href={response.sourceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-brand-ink inline-flex items-center gap-1 text-xs underline underline-offset-2"
                            >
                                {t("source")}
                                <ExternalLink className="size-3" />
                            </a>
                            {response.originalUrl && (
                                <a
                                    href={response.originalUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-brand-ink inline-flex items-center gap-1 text-xs underline underline-offset-2"
                                >
                                    {t("founderOriginal")}
                                    <ExternalLink className="size-3" />
                                </a>
                            )}
                        </div>
                        {response.caveats.length > 0 && (
                            <ul className="bg-warn-soft text-warn-ink list-disc space-y-1 rounded-md py-2 pl-7 pr-3 text-xs">
                                {response.caveats.map(caveat => (
                                    <li key={caveat}>{caveat}</li>
                                ))}
                            </ul>
                        )}
                        <p className="text-ink-3 text-xs">
                            {t("referenceOnly", {
                                count: format.number(response.sections?.length ?? 0),
                            })}
                        </p>
                        <dl className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1" tabIndex={0}>
                            {(response.sections ?? []).map((section, index) => (
                                <div key={`${index}-${section.question}`} className="space-y-1">
                                    <dt className="text-ink text-sm font-semibold">
                                        {section.question}
                                    </dt>
                                    <dd className="text-ink-2 whitespace-pre-wrap break-words text-sm leading-relaxed">
                                        {section.answer}
                                    </dd>
                                </div>
                            ))}
                        </dl>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}
