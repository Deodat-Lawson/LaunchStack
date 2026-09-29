/**
 * The Companies list remembers its current order so the company page can
 * offer previous / next without a round trip. Session-scoped: a new tab
 * starts fresh, and nothing here is authoritative.
 */
const KEY = "prospects:list-order";

export function rememberListOrder(ids: string[]): void {
    try {
        sessionStorage.setItem(KEY, JSON.stringify(ids));
    } catch {
        /* private mode or blocked storage: navigation still works, just without prev/next */
    }
}

export function neighbours(id: string): { prev: string | null; next: string | null } {
    try {
        const raw = sessionStorage.getItem(KEY);
        if (!raw) return { prev: null, next: null };
        const ids = JSON.parse(raw) as unknown;
        if (!Array.isArray(ids)) return { prev: null, next: null };
        const list = ids.filter((v): v is string => typeof v === "string");
        const index = list.indexOf(id);
        if (index < 0) return { prev: null, next: null };
        return { prev: list[index - 1] ?? null, next: list[index + 1] ?? null };
    } catch {
        return { prev: null, next: null };
    }
}
