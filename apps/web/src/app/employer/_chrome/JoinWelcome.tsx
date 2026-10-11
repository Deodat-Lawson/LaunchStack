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
    {
        Icon: MessageSquareText,
        title: "Ask anything",
        body: "Questions get answered from the documents shared with you, with citations.",
    },
    {
        Icon: FileText,
        title: "Look around Documents",
        body: "Everything the workspace shares is in the Sources rail on the left.",
    },
    {
        Icon: UserRound,
        title: "Tell people who you are",
        body: "Add a photo and a title so teammates recognise you.",
    },
] as const;

export function JoinWelcome() {
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
                        Welcome to {welcome.workspaceName}
                    </DialogTitle>
                    <DialogDescription>
                        {welcome.invitedBy
                            ? `${welcome.invitedBy} invited you. You've joined as ${welcome.roleName}.`
                            : `You've joined as ${welcome.roleName}.`}
                    </DialogDescription>
                </DialogHeader>
                <ul className="m-0 flex list-none flex-col gap-3 p-0">
                    {FIRST_STEPS.map(({ Icon, title, body }) => (
                        <li key={title} className="flex items-start gap-3">
                            <span className="bg-brand-soft text-brand flex size-8 shrink-0 items-center justify-center rounded-lg">
                                <Icon className="size-4" aria-hidden />
                            </span>
                            <span className="min-w-0">
                                <span className="text-ink block text-sm font-semibold">
                                    {title}
                                </span>
                                <span className="text-ink-3 block text-[13px] leading-relaxed">
                                    {body}
                                </span>
                            </span>
                        </li>
                    ))}
                </ul>
                <DialogFooter>
                    <Button asChild variant="outline" onClick={close}>
                        <Link href="/employer/settings#account">Set up your profile</Link>
                    </Button>
                    <Button onClick={close} autoFocus>
                        Get started
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
