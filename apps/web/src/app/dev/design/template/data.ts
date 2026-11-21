"use client";

/**
 * The template tool's data, and the one hook its screens read it through.
 *
 * In a real tool this file is your API client: `useContracts()` would fetch
 * `/api/<your-tool>/contracts` and return the same `{ status, data, retry }`
 * shape, so every screen handles loading, empty and failed the same way. Here
 * it answers from memory, and the design library's "State" switch decides
 * what it answers with, so each screen's states can be looked at on demand.
 */

import { createContext, useCallback, useContext, useEffect, useState } from "react";

export type ContractStatus = "decide" | "auto" | "renewing" | "ending";

export interface Contract {
    id: string;
    vendor: string;
    owner: string;
    /** ISO date. */
    renewsOn: string;
    /** Annual value in US dollars. */
    value: number;
    status: ContractStatus;
    noticeDays: number;
    /** The document it came from: its source id, and the passage that says when it renews. */
    source: { id: string; title: string; page: number; quote: string };
}

/** The design library's switch. A real tool has no such thing. */
export type PreviewState = "ready" | "loading" | "empty" | "error";

export const PreviewStateContext = createContext<PreviewState>("ready");

/** "Today" for the template, fixed so the screenshots never drift. */
export const TODAY = "2026-11-20";

export const CONTRACTS: Contract[] = [
    {
        id: "northwind",
        vendor: "Northwind Analytics",
        owner: "Ada Okafor",
        renewsOn: "2027-01-14",
        value: 48000,
        status: "decide",
        noticeDays: 30,
        source: {
            id: "src-northwind",
            title: "Northwind MSA 2024.pdf",
            page: 4,
            quote: "This Agreement renews automatically for successive twelve-month terms unless either party gives written notice at least thirty (30) days before the end of the then-current term.",
        },
    },
    {
        id: "harbor",
        vendor: "Harbor Cloud",
        owner: "Lin Wei",
        renewsOn: "2026-12-31",
        value: 72500,
        status: "decide",
        noticeDays: 30,
        source: {
            id: "src-harbor",
            title: "Harbor Cloud order form.pdf",
            page: 2,
            quote: "Fees for any renewal term will increase by no more than seven percent (7%) over the fees for the prior term.",
        },
    },
    {
        id: "atlas",
        vendor: "Atlas Legal",
        owner: "Sam Rivera",
        renewsOn: "2027-02-01",
        value: 18000,
        status: "decide",
        noticeDays: 60,
        source: {
            id: "src-atlas",
            title: "Atlas engagement letter.docx",
            page: 1,
            quote: "Either party may end this engagement on sixty (60) days' written notice.",
        },
    },
    {
        id: "brightdesk",
        vendor: "Brightdesk",
        owner: "Ada Okafor",
        renewsOn: "2026-12-12",
        value: 9600,
        status: "auto",
        noticeDays: 14,
        source: {
            id: "src-brightdesk",
            title: "Brightdesk terms.pdf",
            page: 6,
            quote: "Subscriptions renew automatically at the then-current list price.",
        },
    },
    {
        id: "kitepay",
        vendor: "Kitepay",
        owner: "Priya Nair",
        renewsOn: "2027-03-15",
        value: 21000,
        status: "auto",
        noticeDays: 30,
        source: {
            id: "src-kitepay",
            title: "Kitepay services agreement.pdf",
            page: 3,
            quote: "The term renews for one-year periods unless terminated in accordance with Section 11.",
        },
    },
    {
        id: "fernway",
        vendor: "Fernway Recruiting",
        owner: "Sam Rivera",
        renewsOn: "2027-01-31",
        value: 6100,
        status: "renewing",
        noticeDays: 30,
        source: {
            id: "src-fernway",
            title: "Fernway SOW 3.pdf",
            page: 2,
            quote: "This Statement of Work may be extended by mutual written agreement.",
        },
    },
    {
        id: "quarry",
        vendor: "Quarry Security",
        owner: "Lin Wei",
        renewsOn: "2027-02-20",
        value: 9000,
        status: "auto",
        noticeDays: 45,
        source: {
            id: "src-quarry",
            title: "Quarry MSA.pdf",
            page: 9,
            quote: "Unless cancelled forty-five (45) days prior, the subscription renews for a further year.",
        },
    },
    {
        id: "mosaic",
        vendor: "Mosaic Print",
        owner: "Priya Nair",
        renewsOn: "2027-01-05",
        value: 0,
        status: "ending",
        noticeDays: 30,
        source: {
            id: "src-mosaic",
            title: "Mosaic quote 2025.pdf",
            page: 1,
            quote: "Pricing valid for twelve months from acceptance.",
        },
    },
];

export const OWNERS = ["Ada Okafor", "Lin Wei", "Priya Nair", "Sam Rivera"];

export const DECISIONS = [
    { vendor: "Pinecrest Payroll", decision: "renew", person: "Priya Nair", on: "2026-11-12" },
    { vendor: "Orbit Travel", decision: "end", person: "Sam Rivera", on: "2026-11-04" },
] as const;

const DAY = 86_400_000;

/** Whole days from the template's "today" to an ISO date. */
export function daysUntil(iso: string): number {
    return Math.round((Date.parse(iso) - Date.parse(TODAY)) / DAY);
}

/** The last day notice can be given, as an ISO date. */
export function noticeBy(contract: Contract): string {
    return new Date(Date.parse(contract.renewsOn) - contract.noticeDays * DAY)
        .toISOString()
        .slice(0, 10);
}

export type Loaded<T> =
    | { status: "loading"; data: null; retry: () => void }
    | { status: "error"; data: null; retry: () => void }
    | { status: "ready"; data: T; retry: () => void };

/**
 * Every screen's data in one shape. Swap the body for your fetch; keep the
 * return type, and the screens need no change.
 */
export function useContracts(): Loaded<Contract[]> {
    const preview = useContext(PreviewStateContext);
    const [attempt, setAttempt] = useState(0);
    const [settled, setSettled] = useState(false);
    useEffect(() => {
        setSettled(false);
        if (preview === "loading") return;
        // A short wait, so the loading state shows the way it does live.
        const timer = window.setTimeout(() => setSettled(true), 250);
        return () => window.clearTimeout(timer);
    }, [preview, attempt]);
    const retry = useCallback(() => setAttempt(n => n + 1), []);
    if (!settled) return { status: "loading", data: null, retry };
    if (preview === "error") return { status: "error", data: null, retry };
    return { status: "ready", data: preview === "empty" ? [] : CONTRACTS, retry };
}
