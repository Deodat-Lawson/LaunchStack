"use client";

import { ChevronRight } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "~/components/ui/sheet";
import type { TopicV1Dto } from "../api";
import styles from "./compact-topic.module.css";

/** Native citations remain V1 evidence references throughout the detail view. */
export function NativeTopicDetailSheet({
    topic,
    children,
}: {
    topic: TopicV1Dto;
    children: ReactNode;
}) {
    const [open, setOpen] = useState(false);
    const trigger = useRef<HTMLButtonElement>(null);
    const origin =
        topic.origin === "ai"
            ? "AI suggestion"
            : topic.origin === "rules"
              ? "Rules suggestion"
              : "Human topic";
    return (
        <>
            <button
                ref={trigger}
                type="button"
                aria-haspopup="dialog"
                aria-expanded={open}
                onClick={() => setOpen(true)}
                className="hover:bg-panel-2 focus-visible:ring-brand flex w-full items-center gap-3 px-5 py-4 text-left focus-visible:ring-2 focus-visible:ring-inset"
            >
                <span className="min-w-0 flex-1">
                    <span className="text-ink block text-sm font-medium">{topic.title}</span>
                    <span className="text-ink-3 mt-1 block text-xs">
                        {origin} · {topic.status}
                        {topic.decision ? " · Decision recorded" : ""}
                    </span>
                </span>
                <ChevronRight aria-hidden="true" className="text-ink-3 size-4 shrink-0" />
            </button>
            <Sheet open={open} onOpenChange={setOpen}>
                <SheetContent
                    className={styles.sheet}
                    onCloseAutoFocus={event => {
                        if (trigger.current?.isConnected) {
                            event.preventDefault();
                            trigger.current.focus();
                        }
                    }}
                    onInteractOutside={event => {
                        if ((event.target as Element)?.closest?.('[role="dialog"]'))
                            event.preventDefault();
                    }}
                >
                    <header className={styles.sheetHeader}>
                        <SheetTitle className="text-lg leading-snug">{topic.title}</SheetTitle>
                        <SheetDescription className="mt-2 text-xs">
                            {origin} · {topic.status}
                        </SheetDescription>
                    </header>
                    <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
                </SheetContent>
            </Sheet>
        </>
    );
}
