/**
 * The public page's one bar: what the file is, where it is from, and what a
 * visitor can do with it — download it when the link allows, or take its
 * text as Markdown (the address an AI agent should be given). No app chrome
 * and no sign-in: the visitor has no account here.
 */

import { Bot, Download } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { ThemeToggle } from "~/app/_components/ThemeToggle";
import type { DocumentDisplayType } from "~/app/employer/documents/types/document";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";

import { DisplayTypeIcon } from "./PublicFileViewer";

export interface PublicHeaderFile {
    title: string;
    displayType: DocumentDisplayType;
    workspaceName: string;
    /** ISO time. */
    updatedAt: string;
    downloadUrl: string | null;
    markdownUrl: string;
}

export function PublicHeader({ file }: { file: PublicHeaderFile }) {
    const t = useTranslations("publicShare.page");
    const tTypes = useTranslations("viewers.displayTypes");
    const format = useFormatter();
    const updated = format.dateTime(new Date(file.updatedAt), { dateStyle: "medium" });

    return (
        <header className="border-line bg-panel shrink-0 border-b px-4 py-2 sm:px-6">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="flex min-w-0 flex-[1_1_16rem] items-center gap-3">
                    <div className="bg-brand-soft text-brand-ink flex size-9 shrink-0 items-center justify-center rounded-lg">
                        <DisplayTypeIcon type={file.displayType} className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                            <h1
                                className="text-ink truncate text-sm font-semibold"
                                title={file.title}
                            >
                                {file.title}
                            </h1>
                            <Badge variant="secondary">{tTypes(file.displayType)}</Badge>
                        </div>
                        <p className="text-ink-3 truncate text-xs">
                            {t("sharedFrom", { workspace: file.workspaceName, date: updated })}
                        </p>
                    </div>
                </div>
                <div
                    role="group"
                    aria-label={t("actions")}
                    className="flex shrink-0 flex-wrap items-center gap-2"
                >
                    {file.downloadUrl && (
                        <Button asChild size="sm">
                            <a href={file.downloadUrl} download rel="nofollow">
                                <Download aria-hidden />
                                {t("download")}
                            </a>
                        </Button>
                    )}
                    <Button asChild size="sm" variant="outline">
                        <a
                            href={file.markdownUrl}
                            type="text/markdown"
                            rel="alternate nofollow"
                            title={t("markdownTitle")}
                        >
                            <Bot aria-hidden />
                            {t("markdown")}
                        </a>
                    </Button>
                    <ThemeToggle />
                </div>
            </div>
        </header>
    );
}
