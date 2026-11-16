"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "~/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "~/components/ui/collapsible";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { weeklyReviewApi, type WeeklyReviewEvidenceDto } from "../api";
import { useWeeklyReviewErrorText } from "../_lib/weekly-review-errors";
import styles from "./review-layout.module.css";

export function ReviewCitationDialog({
    reportId,
    reference,
    onClose,
}: {
    reportId: string;
    reference: string | null;
    onClose: () => void;
}) {
    const t = useTranslations("vantage.weeklyReview");
    const errorText = useWeeklyReviewErrorText();
    const [result, setResult] = useState<{
        reportId: string;
        reference: string;
        evidence?: WeeklyReviewEvidenceDto;
        error?: unknown;
    } | null>(null);
    useEffect(() => {
        if (!reference) return;
        let active = true;
        weeklyReviewApi
            .evidence(reportId, reference)
            .then(evidence => {
                if (active) setResult({ reportId, reference, evidence });
            })
            .catch(error => {
                if (active) setResult({ reportId, reference, error });
            });
        return () => {
            active = false;
        };
    }, [reportId, reference]);
    const current =
        result?.reportId === reportId && result?.reference === reference ? result : null;
    const evidence = current?.evidence;
    const purposes = {
        "company-architecture": "company-architecture",
        "workspace-required": "workspace-required",
        "personal-star": "personal-star",
        retrieved: "internal-retrieval",
    } as const;
    const purpose = evidence ? purposes[evidence.purpose as keyof typeof purposes] : undefined;
    return (
        <Dialog
            open={reference !== null}
            onOpenChange={open => {
                if (!open) {
                    setResult(null);
                    onClose();
                }
            }}
        >
            <DialogContent className="bg-panel max-h-[85dvh] overflow-y-auto text-[length:var(--fs-body)] font-normal sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle className="text-[length:var(--fs-h3)] font-semibold">
                        {evidence?.title ?? t("founder.citationTitle")}
                    </DialogTitle>
                    <DialogDescription className="text-ink-2 text-[length:var(--fs-small)]">
                        {t("founder.citationDescription")}
                    </DialogDescription>
                </DialogHeader>
                {current?.error ? (
                    <p role="alert" className="text-danger">
                        {errorText(current.error)}
                    </p>
                ) : evidence ? (
                    <>
                        <p className="text-ink-2 text-[length:var(--fs-small)]">
                            {t("founder.sourceVersion", {
                                title: evidence.title,
                                version: evidence.version,
                            })}
                        </p>
                        <p className="text-ink-2 text-[length:var(--fs-small)]">
                            {purpose ? t(`founder.purpose.${purpose}`) : t("founder.purposeOther")}
                        </p>
                        <p className="max-w-[68ch] whitespace-pre-wrap break-words leading-relaxed">
                            {evidence.text}
                        </p>
                        {evidence.scope ? (
                            <p className="text-ink-2 text-[length:var(--fs-small)]">
                                {evidence.scope.coverage.qualification}
                            </p>
                        ) : null}
                        <Collapsible>
                            <CollapsibleTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-[length:var(--fs-small)] font-semibold"
                                >
                                    {t("founder.technicalDetails")}
                                </Button>
                            </CollapsibleTrigger>
                            <CollapsibleContent className={styles.accordionContent}>
                                <pre className="bg-panel-2 overflow-auto rounded p-3 text-[length:var(--fs-small)]">
                                    {JSON.stringify(
                                        {
                                            ref: evidence.ref,
                                            hash: evidence.hash,
                                            scope: evidence.scope,
                                        },
                                        null,
                                        2
                                    )}
                                </pre>
                            </CollapsibleContent>
                        </Collapsible>
                    </>
                ) : (
                    <div role="status" aria-label={t("loadingEvidence")}>
                        <Skeleton className="h-5 w-2/3" />
                        <Skeleton className="mt-3 h-40 w-full" />
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
