/** Relative time in the product's words: "today", "yesterday", "12 days ago". */
export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
    if (!iso) return "never";
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return "never";
    const minutes = Math.round((now - then) / 60_000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) {
        const sameDay = new Date(then).toDateString() === new Date(now).toDateString();
        return sameDay
            ? `today ${new Date(then).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`
            : `${hours} hours ago`;
    }
    const startOfDay = (t: number) => new Date(t).setHours(0, 0, 0, 0);
    const days = Math.round((startOfDay(now) - startOfDay(then)) / 86_400_000);
    if (days <= 1) return "yesterday";
    if (days < 30) return `${days} days ago`;
    return new Date(then).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function shortDate(iso: string | null | undefined): string {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function duration(ms: number): string {
    if (ms < 1000) return `${ms} ms`;
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s} s`;
    const m = Math.floor(s / 60);
    const rest = s % 60;
    return rest ? `${m} min ${rest} s` : `${m} min`;
}

export function money(usd: number): string {
    return `€${usd.toFixed(2)}`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
    return `${n} ${n === 1 ? one : many}`;
}

/** "NL, DE and the UK" from ["NL","DE","GB"]. */
export function joinNatural(items: string[]): string {
    if (items.length <= 1) return items.join("");
    return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
