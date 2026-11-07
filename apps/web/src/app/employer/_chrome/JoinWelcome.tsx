"use client";

/**
 * The one-time "Welcome to <workspace>" someone sees the moment a join link
 * or invitation drops them in. The join page leaves the note in this tab's
 * sessionStorage (`~/lib/join-handoff`) and this reads it once, so a reload
 * or a later visit never shows it again.
 */

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { FileText, MessageSquareText, UserRound } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "~/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "~/components/ui/dialog";
import { takeJoinWelcome, type JoinWelcome as Welcome } from "~/lib/join-handoff";

const FIRST_STEPS = [
    { key: "ask", Icon: MessageSquareText },
    { key: "documents", Icon: FileText },
    { key: "profile", Icon: UserRound },
] as const;

export function JoinWelcome() {
    const t = useTranslations("chrome.joinWelcome");
    const [welcome, setWelcome] = useState<Welcome | null>(null);

    useEffect(() => {
        setWelcome(takeJoinWelcome());
    }, []);

    if (!welcome) return null;
    const close = () => setWelcome(null);

    return (
        <Dialog open onOpenChange={open => !open && close()}>
            <DialogContent className="bg-panel border-line sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="text-ink text-xl">
                        {t("title", { workspace: welcome.workspaceName })}
                    </DialogTitle>
                    <DialogDescription>
                        {welcome.invitedBy
                            ? t("invitedBy", { inviter: welcome.invitedBy, role: welcome.roleName })
                            : t("joined", { role: welcome.roleName })}
                    </DialogDescription>
                </DialogHeader>
                <ul className="m-0 flex list-none flex-col gap-3 p-0">
                    {FIRST_STEPS.map(({ key, Icon }) => (
                        <li key={key} className="flex items-start gap-3">
                            <span className="bg-brand-soft text-brand flex size-8 shrink-0 items-center justify-center rounded-lg">
                                <Icon className="size-4" aria-hidden />
                            </span>
                            <span className="min-w-0">
                                <span className="text-ink block text-sm font-semibold">
                                    {t(`steps.${key}.title`)}
                                </span>
                                <span className="text-ink-3 block text-[13px] leading-relaxed">
                                    {t(`steps.${key}.body`)}
                                </span>
                            </span>
                        </li>
                    ))}
                </ul>
                <DialogFooter>
                    <Button asChild variant="outline" onClick={close}>
                        <Link href="/employer/settings#account">{t("setUpProfile")}</Link>
                    </Button>
                    <Button onClick={close} autoFocus>
                        {t("getStarted")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
