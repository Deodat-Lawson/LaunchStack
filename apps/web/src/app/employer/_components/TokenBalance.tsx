"use client";

import { useEffect, useState } from "react";
import { Coins } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

export function TokenBalance() {
    const t = useTranslations("chrome.tokens");
    const format = useFormatter();
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
    // 1.2M, 340K: one decimal for millions, none for thousands.
    const short = format.number(balance, {
        notation: "compact",
        minimumFractionDigits: balance >= 1_000_000 ? 1 : 0,
        maximumFractionDigits: balance >= 1_000_000 ? 1 : 0,
    });

    return (
        <div
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                isLow
                    ? "border-danger/30 bg-danger-soft text-danger"
                    : "border-brand bg-brand-soft text-brand-ink dark:border-brand-soft"
            }`}
            title={t("remaining", { count: format.number(balance) })}
        >
            <Coins className="h-3.5 w-3.5" />
            {short}
        </div>
    );
}
