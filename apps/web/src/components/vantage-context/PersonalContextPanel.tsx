"use client";

import { useEffect, useRef, useState } from "react";
import { Star, ShieldCheck, FileText } from "lucide-react";
import {
    roleDirectoryV0,
    mergedRolePrioritiesV0,
} from "@launchstack/pipelines/vantage/role-context-v0";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import type { PersonalContextViewV0 } from "~/lib/vantage/personal-context";
export type { PersonalContextViewV0 } from "~/lib/vantage/personal-context";

/** The application uses authenticated HTTP; the development page supplies fixtures. */
export interface PersonalContextClientV0 {
    load(): Promise<PersonalContextViewV0>;
    saveRoles(change: {
        roleIds: string[];
        primaryRoleId?: string;
        expectedRevision: number;
    }): Promise<void>;
    setStar(change: {
        documentId: string;
        starred: boolean;
        expectedRevision: number;
    }): Promise<void>;
}
const directory = roleDirectoryV0();
const coverageLabel = {
    used: "Included",
    missing: "Missing",
    revoked: "Access revoked",
    unavailable: "Unavailable",
    omitted: "Not included",
};
export function PersonalContextPanel({ client }: { client: PersonalContextClientV0 }) {
    const [view, setView] = useState<PersonalContextViewV0 | null>(null);
    const [selected, setSelected] = useState<string[]>([]);
    const [primary, setPrimary] = useState<string | undefined>();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [needsReload, setNeedsReload] = useState(false);
    const [documentSearch, setDocumentSearch] = useState("");
    const lock = useRef(false);
    const request = useRef(0);
    function apply(next: PersonalContextViewV0) {
        setView(next);
        setSelected(next.roles.roleIds);
        setPrimary(next.roles.primaryRoleId);
        setNeedsReload(false);
    }
    useEffect(() => {
        let active = true;
        lock.current = false;
        setBusy(true);
        setView(null);
        setError(null);
        setMessage(null);
        setNeedsReload(false);
        client
            .load()
            .then(
                next => {
                    if (active) apply(next);
                },
                () => {
                    if (active) setError("Context could not be loaded. Try again.");
                }
            )
            .finally(() => {
                if (active) setBusy(false);
            });
        return () => {
            active = false;
            request.current += 1;
        };
    }, [client]);
    async function perform(mutate?: () => Promise<void>) {
        if (lock.current) return;
        lock.current = true;
        setBusy(true);
        setError(null);
        setMessage(null);
        const version = ++request.current;
        let saved = false;
        try {
            if (mutate) {
                await mutate();
                saved = true;
            }
            const next = await client.load();
            if (version !== request.current) return;
            apply(next);
            setMessage(mutate ? "Your context choices were saved." : "Context refreshed.");
        } catch {
            if (version !== request.current) return;
            setNeedsReload(true);
            setError(
                saved
                    ? "Your changes were saved, but the refreshed context could not be loaded. Reload before editing again."
                    : "Context could not be updated. Your access or saved choices may have changed. Reload to review the current state."
            );
        } finally {
            if (version === request.current) {
                lock.current = false;
                setBusy(false);
            }
        }
    }
    const disabled = busy || needsReload;
    const starIds = new Set(view?.state.stars.map(star => star.documentId));
    const personal = view?.scope === "personal";
    const visibleDocuments =
        view?.documents.filter(doc =>
            doc.title.toLowerCase().includes(documentSearch.toLowerCase())
        ) ?? [];
    return (
        <div className="text-ink mx-auto max-w-4xl space-y-6 p-4 sm:p-8" aria-busy={busy}>
            <header className="space-y-2">
                <p className="text-brand text-sm font-medium">Vantage · Personal context</p>
                <h1 className="display text-2xl">Your roles and documents</h1>
                <p className="text-ink-2 max-w-2xl text-sm">
                    Choose the responsibilities and documents that should inform your weekly review.
                    These choices belong to you in this workspace.
                </p>
                <p className="text-ink-2 flex items-center gap-2 text-sm">
                    <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
                    Business roles and stars never change document permissions.
                </p>
            </header>
            {error ? (
                <div
                    role="alert"
                    className="border-danger/40 bg-panel rounded-lg border p-4 text-sm"
                >
                    {error}
                </div>
            ) : null}
            {message ? (
                <p role="status" className="text-success text-sm">
                    {message}
                </p>
            ) : null}
            <div className="flex items-center justify-between gap-3">
                <p role="status" className="text-ink-2 text-sm">
                    {busy
                        ? "Checking context…"
                        : view?.ready
                          ? personal
                              ? "Your personal context snapshot is ready."
                              : "Required context is ready for handoff."
                          : view
                            ? personal
                                ? "Your starred documents need attention before a snapshot can be prepared."
                                : "Required context needs attention before generation."
                            : "Context has not loaded."}
                </p>
                <Button variant="outline" disabled={busy} onClick={() => void perform()}>
                    Reload context
                </Button>
            </div>
            {view ? (
                <>
                    {personal ? (
                        <section
                            aria-labelledby="snapshot-heading"
                            className="border-line bg-panel space-y-2 rounded-xl border p-5"
                        >
                            <h2 id="snapshot-heading" className="text-lg font-semibold">
                                Context snapshot
                            </h2>
                            <p className="text-ink-2 text-sm">
                                Your choices are saved to your LaunchStack account in this
                                workspace. Reload checks the saved roles, document versions and
                                permissions again.
                            </p>
                            {view.snapshot ? (
                                <p className="text-sm">
                                    Revision {view.snapshot.revision} ·{" "}
                                    {view.snapshot.sources.length} starred sources · Checked{" "}
                                    {new Date(view.snapshot.asOf).toLocaleString()}
                                </p>
                            ) : (
                                <p className="text-warn text-sm">
                                    No usable snapshot is returned until every starred source is
                                    available.
                                </p>
                            )}
                        </section>
                    ) : null}
                    <section
                        aria-labelledby="roles-heading"
                        className="border-line bg-panel space-y-4 rounded-xl border p-5"
                    >
                        <div>
                            <h2 id="roles-heading" className="text-lg font-semibold">
                                Business responsibilities
                            </h2>
                            <p className="text-ink-2 text-sm">
                                Select all that apply. A primary perspective changes priority order.
                            </p>
                        </div>
                        {!view.roles.userConfirmed ? (
                            <p className="text-warn text-sm">
                                Suggested from your profile title. Review and save to confirm.
                            </p>
                        ) : null}
                        {view.roles.fallback ? (
                            <p className="text-warn text-sm">
                                Some responsibilities are unknown. Review your roles; no permissions
                                have been inferred.
                            </p>
                        ) : null}
                        <div className="grid gap-3 sm:grid-cols-2">
                            {directory.roles.map(role => (
                                <div key={role.id} className="border-line rounded-lg border p-3">
                                    <label className="flex cursor-pointer items-center gap-3 font-medium">
                                        <Checkbox
                                            checked={selected.includes(role.id)}
                                            disabled={disabled}
                                            onCheckedChange={checked => {
                                                setSelected(ids =>
                                                    checked
                                                        ? [...ids, role.id]
                                                        : ids.filter(id => id !== role.id)
                                                );
                                                if (!checked && primary === role.id)
                                                    setPrimary(undefined);
                                            }}
                                        />
                                        {role.label}
                                    </label>
                                    <p className="text-ink-2 mt-2 text-sm">{role.description}</p>
                                    {selected.includes(role.id) ? (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="mt-2"
                                            aria-pressed={primary === role.id}
                                            disabled={disabled}
                                            onClick={() =>
                                                setPrimary(
                                                    primary === role.id ? undefined : role.id
                                                )
                                            }
                                        >
                                            {primary === role.id
                                                ? "Primary perspective"
                                                : "Make primary"}
                                            <span className="sr-only">: {role.label}</span>
                                        </Button>
                                    ) : null}
                                </div>
                            ))}
                        </div>
                        <Button
                            disabled={disabled}
                            onClick={() =>
                                void perform(() =>
                                    client.saveRoles({
                                        roleIds: selected,
                                        primaryRoleId: primary,
                                        expectedRevision: view.state.revision,
                                    })
                                )
                            }
                        >
                            Save roles
                        </Button>
                        <p className="text-ink-2 text-sm">
                            Saved priorities: {mergedRolePrioritiesV0(view.roles).join(" · ")}
                        </p>
                    </section>
                    <section
                        aria-labelledby="stars-heading"
                        className="border-line bg-panel space-y-4 rounded-xl border p-5"
                    >
                        <div>
                            <h2 id="stars-heading" className="text-lg font-semibold">
                                Your Vantage stars
                            </h2>
                            <p className="text-ink-2 text-sm">
                                Every selected document is checked, even when it has not changed
                                recently. Stars do not carry into other modules.
                            </p>
                        </div>
                        {view.documents.length === 0 ? (
                            <p className="text-ink-2 text-sm">
                                No readable documents are available.
                            </p>
                        ) : null}
                        <label className="block space-y-2 text-sm">
                            <span>Find a document</span>
                            <Input
                                value={documentSearch}
                                onChange={event => setDocumentSearch(event.target.value)}
                                placeholder="Search your readable documents"
                            />
                        </label>
                        {view.documents.length > 0 && visibleDocuments.length === 0 ? (
                            <p className="text-ink-2 text-sm">No matching documents.</p>
                        ) : null}
                        {visibleDocuments.map(doc => (
                            <div
                                key={doc.id}
                                className="border-line flex items-start justify-between gap-3 rounded-lg border p-3"
                            >
                                <div className="min-w-0">
                                    <p className="flex items-center gap-2 font-medium">
                                        <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
                                        {doc.title}
                                    </p>
                                    <p className="text-ink-2 mt-1 text-sm">
                                        Version {doc.version} · Updated{" "}
                                        {doc.sourceDate.slice(0, 10)}
                                    </p>
                                    {personal ? (
                                        <Button variant="link" size="sm" asChild>
                                            <a
                                                href={`/api/documents/${doc.id}/versions/${doc.version}/content`}
                                                target="_blank"
                                                rel="noreferrer"
                                            >
                                                View saved source version
                                            </a>
                                        </Button>
                                    ) : null}
                                </div>
                                <Button
                                    variant="outline"
                                    aria-label={`${starIds.has(doc.id) ? "Unstar" : "Star"} ${doc.title}`}
                                    aria-pressed={starIds.has(doc.id)}
                                    disabled={disabled}
                                    onClick={() =>
                                        void perform(() =>
                                            client.setStar({
                                                documentId: doc.id,
                                                starred: !starIds.has(doc.id),
                                                expectedRevision: view.state.revision,
                                            })
                                        )
                                    }
                                >
                                    <Star className="h-4 w-4" aria-hidden="true" />
                                    {starIds.has(doc.id) ? "Starred" : "Star"}
                                </Button>
                            </div>
                        ))}
                        {view.state.stars
                            .filter(star => !view.documents.some(doc => doc.id === star.documentId))
                            .map(star => (
                                <div
                                    key={star.documentId}
                                    className="border-line flex items-center justify-between gap-3 rounded-lg border p-3"
                                >
                                    <p className="text-sm">
                                        A starred document is missing or no longer readable. Its
                                        content is excluded.
                                    </p>
                                    <Button
                                        variant="outline"
                                        disabled={disabled}
                                        onClick={() =>
                                            void perform(() =>
                                                client.setStar({
                                                    documentId: star.documentId,
                                                    starred: false,
                                                    expectedRevision: view.state.revision,
                                                })
                                            )
                                        }
                                    >
                                        Remove unavailable star
                                    </Button>
                                </div>
                            ))}
                    </section>
                    <section
                        aria-labelledby="coverage-heading"
                        className="border-line bg-panel space-y-4 rounded-xl border p-5"
                    >
                        <div>
                            <h2 id="coverage-heading" className="text-lg font-semibold">
                                {personal ? "Personal source coverage" : "Required source coverage"}
                            </h2>
                            <p className="text-ink-2 text-sm">
                                {personal
                                    ? "This snapshot contains your roles and personal stars. Company context and other required evidence are added separately by the report pipeline."
                                    : "Company context is mandatory and separate from your personal stars. Inclusion means prepared context, not proof that a model used it."}
                            </p>
                        </div>
                        <ul className="space-y-3">
                            {view.diagnostics.sources.map((source, index) => (
                                <li
                                    key={`${source.lane}-${source.source?.id}-${index}`}
                                    className="border-line rounded-lg border p-3 text-sm"
                                >
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <span className="font-medium">
                                            {source.lane === "company"
                                                ? "Shared company architecture"
                                                : source.lane === "mandatory"
                                                  ? "Workspace requirement"
                                                  : "Personal Vantage star"}
                                        </span>
                                        <span
                                            className={
                                                source.status === "used"
                                                    ? "text-success"
                                                    : "text-warn"
                                            }
                                        >
                                            {coverageLabel[source.status]}
                                        </span>
                                    </div>
                                    {source.status === "used" && source.source ? (
                                        <p className="text-ink-2 mt-1">
                                            Source {source.source.id} · Version{" "}
                                            {source.source.version}
                                            {source.excerptOffsets
                                                ? ` · Characters ${source.excerptOffsets.start}–${source.excerptOffsets.end}`
                                                : ""}
                                        </p>
                                    ) : null}
                                    {source.reason ? (
                                        <p className="text-ink-2 mt-1">{source.reason}</p>
                                    ) : null}
                                    <p className="text-ink-2 mt-1 text-xs">
                                        Checked {source.checkedAt}
                                    </p>
                                </li>
                            ))}
                        </ul>
                    </section>
                </>
            ) : null}
        </div>
    );
}
