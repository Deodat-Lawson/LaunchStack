"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { SignOutButton } from "@clerk/nextjs";

import styles from "./workspace-select.module.css";

type Workspace = {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    swatch: number;
    role: string;
    memberCount: number;
    lastOpenedAt: string;
    isActive: boolean;
};

type Account = {
    name: string;
    email: string;
};

/** Shown in “Pending invites” when backend provides rows (optional). */
export type PendingInvite = {
    id: string;
    companyName: string;
    slug: string;
    swatch: number;
    invitedBy: string;
    invitedAt: string;
    role: string;
};

type Props = {
    workspaces: Workspace[];
    account: Account;
    fromSignup: boolean;
    pendingInvites?: PendingInvite[];
};

const SWATCH_COUNT = 6;

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

function slugify(s: string): string {
    return s
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40);
}

function initialsOf(s: string): string {
    const parts = s.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "✶";
    if (parts.length === 1) return (parts[0]?.slice(0, 2) ?? "").toUpperCase();
    return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
}

function relativeTime(iso: string): string {
    const d = new Date(iso);
    const now = Date.now();
    const diffSec = Math.floor((now - d.getTime()) / 1000);
    if (diffSec < 60) return "just now";
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
    if (diffSec < 86400 * 30) return `${Math.floor(diffSec / 86400)} days ago`;
    if (diffSec < 86400 * 365)
        return `${Math.floor(diffSec / (86400 * 30))} months ago`;
    return `${Math.floor(diffSec / (86400 * 365))} years ago`;
}

function gradientClass(swatch: number): string {
    const cls: Record<number, string> = {
        1: styles.gradient1!,
        2: styles.gradient2!,
        3: styles.gradient3!,
        4: styles.gradient4!,
        5: styles.gradient5!,
        6: styles.gradient6!,
    };
    return cls[swatch] ?? styles.gradient1!;
}

function roleBadgeClass(role: string): string {
    const r = role.toLowerCase();
    if (r === "owner") return `${styles.roleBadge} ${styles.roleOwner}`;
    if (r === "admin") return `${styles.roleBadge} ${styles.roleAdmin}`;
    return `${styles.roleBadge} ${styles.roleEditor}`;
}

const ALTPILE = [styles.avAlt1, styles.avAlt2, styles.avAlt3] as const;

function syntheticMemberInitials(seed: string, index: number): string {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    let h = 0;
    for (let i = 0; i < seed.length; i++) {
        h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    }
    h = (h + index * 17) >>> 0;
    const a = alphabet[h % alphabet.length] ?? "A";
    const b = alphabet[(h >>> 8) % alphabet.length] ?? "B";
    return a + b;
}

function memberPileParts(
    memberCount: number,
    accountName: string,
    seed: string,
): { label: string; extraClass?: string }[] {
    const n = Math.max(1, memberCount);
    const showPlus = n > 4;
    const letterSlots = showPlus ? 4 : Math.min(4, n);
    const out: { label: string; extraClass?: string }[] = [
        { label: initialsOf(accountName), extraClass: undefined },
    ];
    for (let i = 1; i < letterSlots; i++) {
        const alt = ALTPILE[(i - 1) % ALTPILE.length];
        out.push({
            label: syntheticMemberInitials(seed, i),
            extraClass: alt,
        });
    }
    return out;
}

const SWATCH_GRADIENTS: Record<number, string> = {
    1: "linear-gradient(135deg, var(--accent), var(--accent-deep))",
    2: "linear-gradient(135deg, oklch(0.62 0.18 200), oklch(0.42 0.20 220))",
    3: "linear-gradient(135deg, oklch(0.66 0.20 30), oklch(0.46 0.22 30))",
    4: "linear-gradient(135deg, oklch(0.62 0.18 150), oklch(0.42 0.16 165))",
    5: "linear-gradient(135deg, oklch(0.62 0.20 340), oklch(0.42 0.22 340))",
    6: "linear-gradient(135deg, oklch(0.62 0.18 70), oklch(0.42 0.16 60))",
};

export function WorkspaceSelectClient({
    workspaces,
    account,
    fromSignup,
    pendingInvites = [],
}: Props) {
    const router = useRouter();
    const { theme, setTheme, resolvedTheme } = useTheme();
    const isDark = (resolvedTheme ?? theme) === "dark";

    const [query, setQuery] = useState("");
    const [editorOpen, setEditorOpen] = useState(false);
    const [name, setName] = useState("");
    const [slugValue, setSlugValue] = useState("");
    const [slugEdited, setSlugEdited] = useState(false);
    const [swatch, setSwatch] = useState(1);
    const [teamSize, setTeamSize] = useState("Just me — I'm a solo founder");
    const [description, setDescription] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [switchingId, setSwitchingId] = useState<string | null>(null);
    const [slugAvailable, setSlugAvailable] = useState<null | boolean>(null);
    const [dismissedPendingIds, setDismissedPendingIds] = useState(
        () => new Set<string>(),
    );

    const searchRef = useRef<HTMLInputElement>(null);
    const nameRef = useRef<HTMLInputElement>(null);
    const editorRef = useRef<HTMLDivElement>(null);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return workspaces;
        return workspaces.filter((w) => {
            const haystack = [w.name, w.slug, w.role, w.description ?? ""]
                .join(" ")
                .toLowerCase();
            return haystack.includes(q);
        });
    }, [workspaces, query]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "/") {
                const el = document.activeElement;
                if (
                    el?.tagName !== "INPUT" &&
                    el?.tagName !== "TEXTAREA" &&
                    !(el as HTMLElement | null)?.isContentEditable
                ) {
                    e.preventDefault();
                    searchRef.current?.focus();
                }
            } else if (e.key === "Escape" && editorOpen) {
                setEditorOpen(false);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [editorOpen]);

    useEffect(() => {
        if (editorOpen) {
            const t = setTimeout(() => {
                nameRef.current?.focus();
                editorRef.current?.scrollIntoView({
                    behavior: "smooth",
                    block: "center",
                });
            }, 80);
            return () => clearTimeout(t);
        }
    }, [editorOpen]);

    // Live slug availability check (debounced)
    useEffect(() => {
        const s = slugValue.trim().toLowerCase();
        if (!s || !SLUG_RE.test(s) || s.length < 2) {
            setSlugAvailable(null);
            return;
        }
        const ctrl = new AbortController();
        const t = setTimeout(async () => {
            try {
                const res = await fetch(
                    `/api/workspaces/slug-available?slug=${encodeURIComponent(s)}`,
                    { signal: ctrl.signal }
                );
                if (!res.ok) {
                    setSlugAvailable(null);
                    return;
                }
                const data = (await res.json()) as { available?: boolean };
                setSlugAvailable(data.available ?? null);
            } catch {
                /* aborted */
            }
        }, 250);
        return () => {
            clearTimeout(t);
            ctrl.abort();
        };
    }, [slugValue]);

    const previewName = name || "New workspace";
    const previewUrl = `launchstack.app/${slugValue || "—"}`;
    const previewInitials = initialsOf(name);

    function onNameChange(v: string) {
        setName(v);
        if (!slugEdited) setSlugValue(slugify(v));
    }

    function onSlugChange(v: string) {
        setSlugValue(v.toLowerCase().replace(/\s+/g, "-"));
        setSlugEdited(v.length > 0);
    }

    async function switchTo(id: string) {
        if (switchingId) return;
        setSwitchingId(id);
        setError(null);
        try {
            const res = await fetch(`/api/workspaces/${id}/switch`, {
                method: "POST",
            });
            if (!res.ok) {
                const data = (await res.json().catch(() => ({}))) as {
                    error?: string;
                };
                setError(data.error ?? "Could not switch workspace");
                setSwitchingId(null);
                return;
            }
            const data = (await res.json()) as { redirectTo?: string };
            router.push(data.redirectTo ?? "/employer/documents");
        } catch (err) {
            console.error(err);
            setError("Could not switch workspace");
            setSwitchingId(null);
        }
    }

    async function createWorkspace() {
        if (submitting) return;
        const trimmedName = name.trim();
        const trimmedSlug = slugValue.trim().toLowerCase();
        if (trimmedName.length < 1) {
            setError("Workspace name is required");
            return;
        }
        if (trimmedSlug.length < 2 || !SLUG_RE.test(trimmedSlug)) {
            setError(
                "URL must be 2+ characters: lowercase letters, numbers, or dashes."
            );
            return;
        }
        setSubmitting(true);
        setError(null);
        try {
            const res = await fetch("/api/workspaces", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: trimmedName,
                    slug: trimmedSlug,
                    swatch,
                    teamSize,
                    description: description.trim() || undefined,
                }),
            });
            if (!res.ok) {
                const data = (await res.json().catch(() => ({}))) as {
                    error?: string;
                };
                setError(data.error ?? "Could not create workspace");
                setSubmitting(false);
                return;
            }
            router.push("/employer/documents");
            router.refresh();
        } catch (err) {
            console.error(err);
            setError("Could not create workspace");
            setSubmitting(false);
        }
    }

    const accountInitials = initialsOf(account.name);

    return (
        <div className={styles.body}>
            <div className={styles.ambient} aria-hidden="true">
                <div className={`${styles.orb} ${styles.orb1}`} />
                <div className={`${styles.orb} ${styles.orb2}`} />
                <div className={`${styles.orb} ${styles.orb3}`} />
                <div className={styles.ambientGrain} />
            </div>

            <div className={styles.topbar}>
                <div className={styles.brand}>
                    <div className={styles.brandMark} />
                    LaunchStack
                </div>
                <div className={styles.spacer} />
                <div className={styles.me} title="Switch account">
                    <span className={styles.meAvatar}>{accountInitials}</span>
                    <span>{account.name}</span>
                    {account.email ? (
                        <span className={styles.meEmail}>· {account.email}</span>
                    ) : null}
                    <svg
                        className={styles.meChevron}
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        aria-hidden
                    >
                        <polyline points="6 9 12 15 18 9" />
                    </svg>
                </div>
                <SignOutButton>
                    <button className={styles.signout} type="button">
                        Sign out
                    </button>
                </SignOutButton>
                <button
                    type="button"
                    className={styles.iconBtn}
                    title="Toggle theme"
                    aria-label="Toggle theme"
                    onClick={() => setTheme(isDark ? "light" : "dark")}
                >
                    {isDark ? (
                        <svg
                            width="15"
                            height="15"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                        </svg>
                    ) : (
                        <svg
                            width="15"
                            height="15"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            <circle cx="12" cy="12" r="4" />
                            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
                        </svg>
                    )}
                </button>
            </div>

            <div className={styles.wrap}>
                {fromSignup ? (
                    <div className={styles.stepperRow}>
                        <span className={`${styles.seg} ${styles.segDone}`}>
                            <span className={styles.dot}>
                                <svg
                                    width="9"
                                    height="9"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="3.5"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <polyline points="20 6 9 17 4 12" />
                                </svg>
                            </span>
                            Account
                        </span>
                        <span className={`${styles.bar} ${styles.barDone}`} />
                        <span className={`${styles.seg} ${styles.segActive}`}>
                            <span className={styles.dot}>2</span>Workspace
                        </span>
                        <span className={styles.bar} />
                        <span className={styles.seg}>
                            <span className={styles.dot}>3</span>Upload context
                        </span>
                    </div>
                ) : null}

                <header className={styles.header}>
                    {fromSignup ? (
                        <div className={styles.step}>
                            <b>Step 2 of 3</b>
                        </div>
                    ) : null}
                    <h1 className={styles.hTitle}>
                        Pick a{" "}
                        <span className={`${styles.serif} ${styles.accent}`}>
                            workspace
                        </span>
                    </h1>
                    <p className={styles.hSub}>
                        A workspace is where your knowledge graph, sources, and
                        workflows live. Open one you&apos;re already in, accept
                        an invite, or start a new one for a different company.
                    </p>
                </header>

                <div className={styles.searchRow}>
                    <div className={styles.search}>
                        <svg
                            className={styles.searchIcon}
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            <circle cx="11" cy="11" r="8" />
                            <path d="m21 21-4.3-4.3" />
                        </svg>
                        <input
                            ref={searchRef}
                            type="text"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search workspaces by name, URL, or teammate…"
                            autoComplete="off"
                            aria-label="Search workspaces"
                        />
                        <kbd className={styles.kbd}>/</kbd>
                    </div>
                </div>

                <div className={styles.sectionHead}>
                    <div className={styles.sectionTitle}>
                        Your workspaces <span className={styles.ct}>{workspaces.length}</span>
                    </div>
                    <span className={styles.sectionAside}>Last opened first</span>
                </div>

                <div className={styles.wsList}>
                    {filtered.length === 0 ? (
                        <div className={styles.emptyRow}>
                            {query ? (
                                <>
                                    No workspace matches <b>“{query}”</b>. Try
                                    creating a new one below.
                                </>
                            ) : (
                                <>You aren&apos;t in any workspaces yet. Create your first one below.</>
                            )}
                        </div>
                    ) : (
                        filtered.map((ws) => {
                            const initials = initialsOf(ws.name);
                            const memberLabel =
                                ws.memberCount === 1
                                    ? "Just you"
                                    : `${ws.memberCount} members`;
                            const isSwitching = switchingId === ws.id;
                            const showPile = ws.memberCount > 1;
                            const pile = showPile
                                ? memberPileParts(
                                      ws.memberCount,
                                      account.name,
                                      `${ws.id}:${ws.slug}`,
                                  )
                                : [];
                            return (
                                <button
                                    key={ws.id}
                                    type="button"
                                    className={`${styles.ws} ${ws.isActive ? styles.wsActive : ""} ${showPile ? "" : styles.wsSolo}`}
                                    data-name={ws.name}
                                    data-url={ws.slug || ""}
                                    data-active={ws.isActive ? "true" : undefined}
                                    onClick={() => switchTo(ws.id)}
                                    disabled={isSwitching}
                                    aria-label={
                                        ws.isActive
                                            ? `${ws.name} — currently active workspace`
                                            : `Open ${ws.name}`
                                    }
                                    aria-current={ws.isActive ? "true" : undefined}
                                >
                                    <div
                                        className={`${styles.wsMark} ${gradientClass(ws.swatch)}`}
                                    >
                                        {initials}
                                    </div>
                                    <div className={styles.wsBody}>
                                        <div className={styles.wsName}>
                                            <span className={styles.wsNameText}>
                                                {ws.name}
                                            </span>
                                            {ws.isActive ? (
                                                <span className={styles.activeChip}>
                                                    Active
                                                </span>
                                            ) : null}
                                        </div>
                                        <div className={styles.wsMeta}>
                                            {ws.slug ? (
                                                <>
                                                    <span className={styles.url}>
                                                        launchstack.app/{ws.slug}
                                                    </span>
                                                    <span className={styles.sep}>·</span>
                                                </>
                                            ) : null}
                                            <span>{memberLabel}</span>
                                            <span className={styles.sep}>·</span>
                                            <span>
                                                Opened {relativeTime(ws.lastOpenedAt)}
                                            </span>
                                        </div>
                                    </div>
                                    {showPile ? (
                                        <div className={styles.pile} aria-label="Members">
                                            {pile.map((p, i) => (
                                                <span
                                                    key={`${ws.id}-pile-${i}`}
                                                    className={
                                                        p.extraClass
                                                            ? `${styles.av} ${p.extraClass}`
                                                            : styles.av
                                                    }
                                                >
                                                    {p.label}
                                                </span>
                                            ))}
                                            {ws.memberCount > 4 ? (
                                                <span
                                                    className={`${styles.av} ${styles.avMore}`}
                                                >
                                                    +{ws.memberCount - 4}
                                                </span>
                                            ) : null}
                                        </div>
                                    ) : null}
                                    <span className={roleBadgeClass(ws.role)}>
                                        {ws.role.charAt(0).toUpperCase() + ws.role.slice(1)}
                                    </span>
                                </button>
                            );
                        })
                    )}
                </div>

                {pendingInvites.filter((p) => !dismissedPendingIds.has(p.id)).length >
                0 ? (
                    <>
                        <div className={styles.sectionHead}>
                            <div className={styles.sectionTitle}>
                                Pending invites{" "}
                                <span className={styles.ct}>
                                    {
                                        pendingInvites.filter(
                                            (p) => !dismissedPendingIds.has(p.id),
                                        ).length
                                    }
                                </span>
                            </div>
                            <span className={styles.sectionAside}>
                                From teammates who already use LaunchStack
                            </span>
                        </div>
                        <div className={styles.wsList}>
                            {pendingInvites
                                .filter((p) => !dismissedPendingIds.has(p.id))
                                .map((inv) => {
                                    const mark = initialsOf(inv.companyName);
                                    return (
                                        <div
                                            key={inv.id}
                                            className={styles.wsPending}
                                        >
                                            <div
                                                className={`${styles.wsMark} ${gradientClass(inv.swatch)}`}
                                            >
                                                {mark}
                                            </div>
                                            <div className={styles.wsBody}>
                                                <div className={styles.wsName}>
                                                    {inv.companyName}
                                                </div>
                                                <div className={styles.wsMeta}>
                                                    <span className={styles.url}>
                                                        launchstack.app/{inv.slug}
                                                    </span>
                                                    <span className={styles.sep}>·</span>
                                                    <span>
                                                        Invited by{" "}
                                                        <b
                                                            style={{
                                                                color: "var(--ink-2)",
                                                                fontWeight: 500,
                                                            }}
                                                        >
                                                            {inv.invitedBy}
                                                        </b>{" "}
                                                        · {relativeTime(inv.invitedAt)}
                                                    </span>
                                                    <span className={styles.sep}>·</span>
                                                    <span>
                                                        Role:{" "}
                                                        {inv.role.charAt(0).toUpperCase() +
                                                            inv.role.slice(1)}
                                                    </span>
                                                </div>
                                            </div>
                                            <div className={styles.inviteActions}>
                                                <button
                                                    type="button"
                                                    className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`}
                                                    onClick={() =>
                                                        setDismissedPendingIds((s) => {
                                                            const n = new Set(s);
                                                            n.add(inv.id);
                                                            return n;
                                                        })
                                                    }
                                                >
                                                    Decline
                                                </button>
                                                <button
                                                    type="button"
                                                    className={`${styles.btn} ${styles.btnAccent} ${styles.btnSm}`}
                                                    onClick={() =>
                                                        setError(
                                                            "Accepting invites from this screen is not available yet.",
                                                        )
                                                    }
                                                >
                                                    Accept &amp; open
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                        </div>
                    </>
                ) : null}

                <div className={styles.sectionHead}>
                    <div className={styles.sectionTitle}>Start something new</div>
                    <span className={styles.sectionAside}>
                        You can rename or delete this any time
                    </span>
                </div>

                <div className={styles.createNewRow}>
                    <button
                        type="button"
                        className={`${styles.createCard} ${styles.createCardPrimary}`}
                        onClick={() => setEditorOpen(true)}
                    >
                        <div className={styles.createIcon}>
                            <svg
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            >
                                <line x1="12" y1="5" x2="12" y2="19" />
                                <line x1="5" y1="12" x2="19" y2="12" />
                            </svg>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div className={styles.ctTitle}>Create a new workspace</div>
                            <div className={styles.ctHelp}>
                                For a new company or product. Empty knowledge graph,
                                ready to fill.
                            </div>
                        </div>
                        <svg
                            className={styles.ctArrow}
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            <line x1="5" y1="12" x2="19" y2="12" />
                            <polyline points="12 5 19 12 12 19" />
                        </svg>
                    </button>
                    <button
                        type="button"
                        className={`${styles.createCard} ${styles.createCardAlt}`}
                        onClick={() =>
                            setError(
                                "Importing from another tool is coming soon."
                            )
                        }
                    >
                        <div className={`${styles.createIcon} ${styles.createIconAlt}`}>
                            <svg
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            >
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                <polyline points="17 8 12 3 7 8" />
                                <line x1="12" y1="3" x2="12" y2="15" />
                            </svg>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div className={styles.ctTitle}>
                                Import from another tool
                            </div>
                            <div className={styles.ctHelp}>
                                Bring in a Notion workspace, a Linear team, or a
                                Google Drive folder as a starting point.
                            </div>
                        </div>
                        <svg
                            className={styles.ctArrow}
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            <line x1="5" y1="12" x2="19" y2="12" />
                            <polyline points="12 5 19 12 12 19" />
                        </svg>
                    </button>
                </div>

                {editorOpen ? (
                    <div
                        ref={editorRef}
                        className={styles.createEditor}
                        role="region"
                        aria-label="Create a new workspace"
                    >
                        <div className={styles.ceHead}>
                            <div>
                                <h3 className={styles.ceTitle}>New workspace</h3>
                                <p className={styles.ceHelp}>
                                    You&apos;ll start with an empty knowledge graph.
                                    Upload sources next.
                                </p>
                            </div>
                            <button
                                type="button"
                                className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`}
                                aria-label="Close"
                                onClick={() => setEditorOpen(false)}
                            >
                                <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <line x1="18" y1="6" x2="6" y2="18" />
                                    <line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                            </button>
                        </div>

                        <div className={styles.ceGrid}>
                            <div className={styles.ceField}>
                                <label className={styles.ceLabel} htmlFor="ce-name">
                                    Workspace name <span className={styles.req}>*</span>
                                </label>
                                <input
                                    ref={nameRef}
                                    id="ce-name"
                                    className={styles.input}
                                    type="text"
                                    placeholder="e.g. Northwind Labs"
                                    autoComplete="off"
                                    value={name}
                                    onChange={(e) => onNameChange(e.target.value)}
                                />
                            </div>
                            <div className={styles.ceField}>
                                <label className={styles.ceLabel} htmlFor="ce-url">
                                    URL <span className={styles.req}>*</span>
                                </label>
                                <div className={styles.urlInput}>
                                    <span className={styles.urlPrefix}>launchstack.app/</span>
                                    <input
                                        id="ce-url"
                                        type="text"
                                        placeholder="northwind"
                                        autoComplete="off"
                                        value={slugValue}
                                        onChange={(e) => onSlugChange(e.target.value)}
                                    />
                                </div>
                                {slugValue.length >= 2 && slugAvailable !== null ? (
                                    <div
                                        className={`${styles.urlStatus} ${slugAvailable ? "" : styles.urlStatusTaken}`}
                                    >
                                        {slugAvailable ? (
                                            <>
                                                <svg
                                                    width="11"
                                                    height="11"
                                                    viewBox="0 0 24 24"
                                                    fill="none"
                                                    stroke="currentColor"
                                                    strokeWidth="3"
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                >
                                                    <polyline points="20 6 9 17 4 12" />
                                                </svg>
                                                <span>Available</span>
                                            </>
                                        ) : (
                                            <span>Taken — try a different URL</span>
                                        )}
                                    </div>
                                ) : null}
                            </div>

                            <div className={styles.ceField}>
                                <label className={styles.ceLabel}>Workspace icon</label>
                                <div className={styles.swatches} role="radiogroup">
                                    {Array.from({ length: SWATCH_COUNT }, (_, i) => i + 1).map(
                                        (n) => (
                                            <button
                                                key={n}
                                                type="button"
                                                className={`${styles.swatch} ${gradientClass(n)} ${swatch === n ? styles.swatchSelected : ""}`}
                                                aria-label={`Color ${n}`}
                                                aria-checked={swatch === n}
                                                role="radio"
                                                onClick={() => setSwatch(n)}
                                            />
                                        )
                                    )}
                                </div>
                            </div>
                            <div className={styles.ceField}>
                                <label className={styles.ceLabel} htmlFor="ce-team">
                                    Who&apos;s joining you?
                                </label>
                                <select
                                    id="ce-team"
                                    className={styles.select}
                                    value={teamSize}
                                    onChange={(e) => setTeamSize(e.target.value)}
                                >
                                    <option>Just me — I&apos;m a solo founder</option>
                                    <option>2–5 people</option>
                                    <option>6–20 people</option>
                                    <option>20+ people</option>
                                </select>
                            </div>

                            <div className={`${styles.ceField} ${styles.ceFieldFull}`}>
                                <label className={styles.ceLabel} htmlFor="ce-desc">
                                    Short description{" "}
                                    <span
                                        style={{
                                            color: "var(--ink-4)",
                                            fontWeight: 500,
                                            textTransform: "none",
                                            letterSpacing: 0,
                                            fontSize: 11,
                                        }}
                                    >
                                        — optional, helps the AI
                                    </span>
                                </label>
                                <textarea
                                    id="ce-desc"
                                    className={styles.textarea}
                                    rows={2}
                                    placeholder="One sentence on what this company does. e.g. ‘We turn scattered context into a knowledge graph for AI workflows.’"
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                />
                            </div>
                        </div>

                        <div className={styles.ceFoot}>
                            <div className={styles.previewPill}>
                                <span
                                    className={styles.miniMark}
                                    style={{
                                        background: SWATCH_GRADIENTS[swatch] ?? SWATCH_GRADIENTS[1],
                                    }}
                                >
                                    {previewInitials}
                                </span>
                                <span>
                                    Preview: <b>{previewName}</b> ·{" "}
                                    <span className={styles.mono}>{previewUrl}</span>
                                </span>
                            </div>
                            <button
                                type="button"
                                className={`${styles.btn} ${styles.btnOutline} ${styles.btnSm}`}
                                onClick={() => setEditorOpen(false)}
                                disabled={submitting}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className={`${styles.btn} ${styles.btnAccent}`}
                                onClick={createWorkspace}
                                disabled={
                                    submitting ||
                                    !name.trim() ||
                                    !slugValue.trim() ||
                                    slugAvailable === false
                                }
                            >
                                {submitting ? "Creating…" : "Create & continue"}
                                <svg
                                    width="13"
                                    height="13"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2.5"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <line x1="5" y1="12" x2="19" y2="12" />
                                    <polyline points="12 5 19 12 12 19" />
                                </svg>
                            </button>
                        </div>
                    </div>
                ) : null}

                {error ? (
                    <div className={styles.error} role="alert">
                        {error}
                    </div>
                ) : null}

                <p className={styles.foot}>
                    Looking for a workspace that&apos;s not here? Ask its owner to
                    invite{" "}
                    <b style={{ color: "var(--ink-2)", fontWeight: 500 }}>
                        {account.email || "you"}
                    </b>
                    .
                    <br />
                    <a href="/signin">Use a different account</a>
                    <span className={styles.sepDot}>·</span>
                    <a href="/contact">Help</a>
                    <span className={styles.sepDot}>·</span>
                    <a href="/privacy">Privacy</a>
                </p>
            </div>
        </div>
    );
}
