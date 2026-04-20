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
        fetch("/api/credits")
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
                if (data?.balanceTokens != null) setBalance(data.balanceTokens);
            })
            .catch(() => {});
    }, []);

    if (balance === null) return null;

    const isLow = balance < 500_000;

    return (
        <div
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                isLow
                    ? "bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800/50 text-red-600 dark:text-red-400"
                    : "bg-purple-50 dark:bg-purple-950/40 border-purple-200 dark:border-purple-800/50 text-purple-600 dark:text-purple-400"
            }`}
            title={`${balance.toLocaleString()} tokens remaining`}
        >
            <Coins className="w-3.5 h-3.5" />
            {formatTokens(balance)}
        </div>
    );
}
