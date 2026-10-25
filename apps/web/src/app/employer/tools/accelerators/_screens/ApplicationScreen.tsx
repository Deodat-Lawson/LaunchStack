"use client";

import { ArrowLeft, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { ToolNotFound } from "~/components/tool-app/ToolFrame";
import { ToolLink } from "~/components/tool-app/ToolLink";
import { Button } from "~/components/ui/button";
import { useErrorText } from "~/lib/tools/errorText";

import { AcceleratorsApiError } from "../api";
import { FieldEditor } from "../_components/FieldEditor";
import { Notice } from "../_components/ProgramFacts";
import { useAccelerators } from "../_lib/context";
import { programPath } from "../_lib/screens";

export function ApplicationScreen({ id }: { id: string }) {
    const t = useTranslations("accelerators");
    const errorText = useErrorText();
    const { home, loadApplication } = useAccelerators();
    const [loading, setLoading] = useState(true);
    const [failure, setFailure] = useState<unknown>(null);
    useEffect(() => {
        let disposed = false;
        setLoading(true);
        setFailure(null);
        void loadApplication(id)
            .catch(error => {
                if (!disposed) setFailure(error);
            })
            .finally(() => {
                if (!disposed) setLoading(false);
            });
        return () => {
            disposed = true;
        };
    }, [id, loadApplication]);
    const application = home?.applications.find(item => item.id === id);
    if (failure instanceof AcceleratorsApiError && failure.status === 404)
        return <ToolNotFound home="/programs" homeLabel={t("tool.programs")} />;
    if (!application)
        return (
            <div className="space-y-4">
                {loading ? (
                    <p role="status" className="text-ink-3 flex items-center gap-2 text-sm">
                        <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
                        {t("common.loading")}
                    </p>
                ) : (
                    <Notice danger>{errorText(failure, t("common.notFound"))}</Notice>
                )}
                {!loading && (
                    <Button
                        type="button"
                        variant="outline"
                        onClick={async () => {
                            setLoading(true);
                            try {
                                await loadApplication(id);
                                setFailure(null);
                            } catch (error) {
                                setFailure(error);
                            } finally {
                                setLoading(false);
                            }
                        }}
                    >
                        {t("common.retry")}
                    </Button>
                )}
            </div>
        );
    const program = home?.programs.find(item => item.program.id === application.programId)?.program;
    const manualCount = application.sections.filter(
        section => section.field.fieldType === "file" || section.field.fieldType === "video"
    ).length;
    return (
        <div className="space-y-6">
            <header className="space-y-4">
                <Button asChild variant="ghost" size="sm">
                    <ToolLink href={program ? programPath(program.id) : "/programs"}>
                        <ArrowLeft className="size-3.5" />
                        {program?.name ?? t("common.backPrograms")}
                    </ToolLink>
                </Button>
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 flex-1 space-y-2">
                        <p className="text-ink-3 text-xs font-medium uppercase tracking-wide">
                            {t("application.title")}
                        </p>
                        <h1 className="display text-ink break-words text-2xl tracking-tight">
                            {application.title}
                        </h1>
                        <p className="text-ink-2 max-w-2xl text-sm leading-relaxed">
                            {t("application.description")}
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            title={t("application.refreshHint")}
                            disabled={loading}
                            onClick={async () => {
                                setLoading(true);
                                try {
                                    await loadApplication(id);
                                    setFailure(null);
                                } catch (error) {
                                    setFailure(error);
                                } finally {
                                    setLoading(false);
                                }
                            }}
                        >
                            <RefreshCw
                                className={
                                    loading
                                        ? "size-3.5 animate-spin motion-reduce:animate-none"
                                        : "size-3.5"
                                }
                            />
                            {t("application.refresh")}
                        </Button>
                        {program && (
                            <Button asChild variant="outline" size="sm">
                                <a
                                    href={program.applyUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    {t("common.portal")}
                                    <ExternalLink className="size-3.5" />
                                </a>
                            </Button>
                        )}
                    </div>
                </div>
                <p className="text-ink-3 text-xs">{t("application.shared")}</p>
                <Notice>{t("application.snapshot")}</Notice>
                {manualCount > 0 && (
                    <p className="text-ink-3 text-xs">
                        {t("application.manualCount", { count: manualCount })}
                    </p>
                )}
                {!home?.profileReady && <Notice>{t("home.profileMissing")}</Notice>}
                {failure != null && (
                    <Notice danger>{errorText(failure, t("common.loadFailed"))}</Notice>
                )}
            </header>
            {application.sections.length === 0 ? (
                <Notice>{t("application.noFields")}</Notice>
            ) : (
                [...application.sections]
                    .sort((left, right) => left.field.position - right.field.position)
                    .map(section => (
                        <FieldEditor
                            key={section.id}
                            applicationId={application.id}
                            section={section}
                        />
                    ))
            )}
        </div>
    );
}
