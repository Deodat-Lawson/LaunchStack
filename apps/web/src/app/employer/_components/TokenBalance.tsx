"use client";

import { useEffect, useState } from "react";
import { Coins } from "lucide-react";

function formatTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
    return n.toLocaleString();
}

export function TokenBalance() {
    const [balance, setBalance] = useState<number | null>(null);

    useEffect(() => {
        void (async () => {
            try {
                const res = await fetch("/api/credits");
                if (!res.ok) return;
                // Known response shape of our /api/credits route.
                const data = (await res.json()) as { balanceTokens?: number | null };
                if (data.balanceTokens != null) setBalance(data.balanceTokens);
            } catch {
                // Network errors just leave the balance chip hidden.
            }
        })();
    }, []);

    if (balance === null) return null;

    const isLow = balance < 500_000;

    return (
        <div
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                isLow
                    ? "border-red-200 bg-red-50 text-red-600 dark:border-red-800/50 dark:bg-red-950/40 dark:text-red-400"
                    : "border-brand bg-brand-soft text-brand-ink dark:border-brand-soft"
            }`}
            title={`${balance.toLocaleString()} tokens remaining`}
        >
            <Coins className="h-3.5 w-3.5" />
            {formatTokens(balance)}
        </div>
    );
}
