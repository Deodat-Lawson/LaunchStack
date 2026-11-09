/** Authenticated development-only bridge; personal context is never stored in the browser. */
import type {
    PersonalContextClientV0,
    PersonalContextViewV0,
} from "~/components/vantage-context/PersonalContextPanel";

export interface DemoPersonalContextView extends PersonalContextViewV0 {
    persistence?: "server-process-memory";
    blocker?: string;
}
export interface PersonalContextObserver {
    loaded(view: DemoPersonalContextView): void;
    invalidated(): void;
    unavailable(): void;
}

export function createDemoPersonalContextClient(
    week?: string,
    observer?: PersonalContextObserver
): PersonalContextClientV0 {
    let requestVersion = 0;
    const path = `/api/vantage/demo/personal${week ? `?${new URLSearchParams({ week })}` : ""}`;
    async function request<T>(init?: RequestInit): Promise<T> {
        const response = await fetch(path, {
            credentials: "same-origin",
            cache: "no-store",
            ...init,
        });
        if (!response.ok)
            throw new Error("Personal context is unavailable with the current access or revision.");
        return response.json() as Promise<T>;
    }
    async function update(operation: "roles" | "star", change: unknown): Promise<void> {
        requestVersion++;
        observer?.invalidated();
        try {
            await request({
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ operation, ...(change as Record<string, unknown>) }),
            });
        } catch {
            observer?.unavailable();
            throw new Error("Personal context could not be saved. Reload before editing again.");
        }
    }
    return {
        async load() {
            const version = ++requestVersion;
            try {
                const view = await request<DemoPersonalContextView>();
                if (version === requestVersion) observer?.loaded(view);
                return view;
            } catch {
                if (version === requestVersion) observer?.unavailable();
                throw new Error(
                    "Personal context could not be loaded. Reload to check current access."
                );
            }
        },
        saveRoles: ({ roleIds, primaryRoleId, expectedRevision }) =>
            update("roles", { roleIds, primaryRoleId, expectedRevision }),
        setStar: ({ documentId, starred, expectedRevision }) =>
            update("star", { documentId, starred, expectedRevision }),
    };
}
