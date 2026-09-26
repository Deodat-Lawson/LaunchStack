"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "~/lib/utils";

import type { BackTarget } from "./backTarget";
import styles from "./BackButton.module.css";

/**
 * The one look for "go back up": a bordered button that names where it goes,
 * "‹ Studio", matching the document preview's "‹ Library".
 *
 * A named, bordered control rather than a bare arrow or a text link, because
 * it is the one thing on a page that leaves it, and it should read as an
 * action at a glance. It says a place, never "Back": it goes up the product,
 * not back through history — see `backTarget.ts`.
 */
export function BackButton({
    to,
    className,
    ...rest
}: {
    /** Where it goes. Not `target`, which an anchor already uses for "_blank". */
    to: BackTarget;
} & Omit<ComponentPropsWithoutRef<typeof Link>, "href" | "children" | "target">) {
    return (
        <Link
            href={to.href}
            aria-label={`Back to ${to.label}`}
            className={cn(styles.button, className)}
            {...rest}
        >
            <ChevronLeft aria-hidden className={styles.icon} />
            <span className={styles.label}>{to.label}</span>
        </Link>
    );
}
