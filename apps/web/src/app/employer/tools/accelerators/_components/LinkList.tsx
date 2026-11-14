"use client";

import { ExternalLink, Mail } from "lucide-react";
import type { ReactNode } from "react";

export interface LinkListItem {
    href: string;
    title: string;
    /** Where it goes, in quiet text under the title. */
    detail?: string;
    /** Right-aligned context, such as when the page was checked. */
    meta?: ReactNode;
}

/** "500.co/fellowship": which page it is, readable at a glance. */
export function pageLabel(url: string): string {
    try {
        const { hostname, pathname } = new URL(url);
        const label = hostname.replace(/^www\./, "") + pathname.replace(/\/+$/, "");
        return label.length > 48 ? `${label.slice(0, 47)}…` : label;
    } catch {
        return url;
    }
}

/** "…/blog/applications-open-sg21" reads as "Applications open sg21"; a bare site as its host. */
function pageName(url: URL): string {
    const segment = url.pathname.split("/").filter(Boolean).at(-1);
    if (!segment) return url.hostname.replace(/^www\./, "");
    let name = segment;
    try {
        name = decodeURIComponent(segment);
    } catch {
        // A malformed escape stays as written.
    }
    name =
        name
            .replace(/\.[a-z]{2,4}$/i, "")
            .replace(/[-_+]+/g, " ")
            .trim() || segment;
    return name.charAt(0).toUpperCase() + name.slice(1);
}

/** A web page or an email address as a titled link. Anything else is not a link. */
export function linkItem(value: string): LinkListItem | null {
    if (/^mailto:/i.test(value) || /^[^\s@/]+@[^\s@/]+\.[a-z]{2,}$/i.test(value)) {
        const address = value.replace(/^mailto:/i, "");
        return { href: `mailto:${address}`, title: address };
    }
    if (!URL.canParse(value)) return null;
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return { href: url.toString(), title: pageName(url), detail: pageLabel(value) };
}

/** Outbound links as one bordered list: a title, where it goes, and an icon for the kind. */
export function LinkList({ items }: { items: readonly LinkListItem[] }) {
    return (
        <ul className="border-line divide-line divide-y rounded-xl border">
            {items.map(item => {
                const external = !item.href.startsWith("mailto:");
                const Icon = external ? ExternalLink : Mail;
                return (
                    <li key={item.href}>
                        <a
                            href={item.href}
                            {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                            className="hover:bg-panel-2 group flex items-center gap-3 px-3 py-2.5 transition-colors first:rounded-t-xl last:rounded-b-xl"
                        >
                            <span className="min-w-0 flex-1">
                                <span className="text-ink group-hover:text-brand-ink block truncate text-sm">
                                    {item.title}
                                </span>
                                {item.detail && (
                                    <span className="text-ink-3 block truncate text-xs">
                                        {item.detail}
                                    </span>
                                )}
                            </span>
                            {item.meta && (
                                <span className="text-ink-3 shrink-0 text-xs">{item.meta}</span>
                            )}
                            <Icon
                                aria-hidden="true"
                                className="text-ink-3 group-hover:text-ink size-3.5 shrink-0"
                            />
                        </a>
                    </li>
                );
            })}
        </ul>
    );
}
