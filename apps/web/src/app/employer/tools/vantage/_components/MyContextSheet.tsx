"use client";

import { useRef, type RefObject } from "react";
import { useSheetFocusRecovery } from "../_lib/use-sheet-focus-recovery";
import { Button } from "~/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "~/components/ui/sheet";
import {
    PersonalContextPanel,
    type PersonalContextClientV0,
} from "~/components/vantage-context/PersonalContextPanel";
import type { DemoSource } from "../demo-contract";
import styles from "./my-context.module.css";

export interface MyContextSheetProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    client: PersonalContextClientV0;
    companyArchitecture?: DemoSource;
    onInspectProfile: () => void;
    busy?: boolean;
    triggerRef?: RefObject<HTMLButtonElement | null>;
}

function suppliedFactCount(body: string): number | null {
    try {
        const value: unknown = JSON.parse(body);
        if (
            typeof value !== "object" ||
            value === null ||
            !("facts" in value) ||
            !Array.isArray(value.facts)
        )
            return null;
        return value.facts.length;
    } catch {
        return null;
    }
}

export function MyContextSheet({
    open,
    onOpenChange,
    client,
    companyArchitecture,
    onInspectProfile,
    busy = false,
    triggerRef,
}: MyContextSheetProps) {
    const heading = useRef<HTMLElement | null>(null);
    useSheetFocusRecovery(open, heading);
    const factCount = companyArchitecture ? suppliedFactCount(companyArchitecture.body) : null;
    const unreviewed = companyArchitecture?.reviewState === "unreviewed";
    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent
                className={styles.sheet}
                onCloseAutoFocus={event => {
                    if (triggerRef?.current?.isConnected) {
                        event.preventDefault();
                        triggerRef.current.focus();
                    }
                }}
                onInteractOutside={event => {
                    if ((event.target as Element)?.closest?.('[role="dialog"]'))
                        event.preventDefault();
                }}
            >
                <header ref={heading} tabIndex={-1} className={styles.header}>
                    <SheetTitle className="text-xl">My context</SheetTitle>
                    <SheetDescription className="mt-3 leading-relaxed">
                        What Vantage should pay attention to when it prepares your next review.
                        Saved reports keep their original context.
                    </SheetDescription>
                </header>
                <div className={styles.body}>
                    <section className={styles.profile} aria-label="Company profile">
                        <h3>
                            <span className={styles.dot} aria-hidden="true" />
                            {companyArchitecture
                                ? unreviewed
                                    ? "Company profile isn't reviewed yet"
                                    : companyArchitecture.reviewState
                                      ? "Company profile"
                                      : "Company profile review status isn't supplied"
                                : "Company profile isn't available"}
                        </h3>
                        <p>
                            {companyArchitecture
                                ? unreviewed
                                    ? "Treat this profile as background until its facts have been checked."
                                    : "Inspect the supplied profile before relying on it."
                                : "The current company profile could not be supplied."}
                        </p>
                        {factCount !== null ? <p>Supplied company facts: {factCount}.</p> : null}
                        {companyArchitecture ? (
                            <Button
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                onClick={onInspectProfile}
                            >
                                Inspect profile
                            </Button>
                        ) : null}
                    </section>
                    <div className={styles.personal}>
                        <PersonalContextPanel client={client} />
                    </div>
                </div>
                <footer className={styles.footer}>
                    <p>
                        Changes apply to the next review; saved reports keep their original context.
                    </p>
                    <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
                        Done
                    </Button>
                </footer>
            </SheetContent>
        </Sheet>
    );
}
