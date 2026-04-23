"use client";

import React, {
    Suspense,
    useCallback,
    useEffect,
    useRef,
    useState,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { SignUp, useAuth, useUser } from "@clerk/nextjs";
import {
    AlertCircle,
    ArrowRight,
    CheckCircle2,
    ChevronDown,
    Rocket,
    Ticket,
    Users,
} from "lucide-react";
import { AuthBrandPanel } from "~/app/_components/AuthBrandPanel";
import { AuthChrome } from "~/app/_components/AuthChrome";

/**
 * Sign-up page.
 *
 * Solo-first flow. After the user authenticates via Clerk, they see three
 * clearly-ranked paths:
 *
 *   1. Start solo (default, one click) — auto-provisions a workspace using
 *      the user's name. No form to fill out.
 *   2. Join with an invite code — a short inline form for team members.
 *   3. Advanced / team setup — expanded form with company name, staff count,
 *      and optional BYOK embedding keys for self-host users.
 *
 * The team-oriented copy ("Create Your Company", "Approximate Number of
 * Staff", "Enterprise Security") from the old design is gone. This product is
 * for solo founders / devs / students first.
 */

// ────────────────────────── Types ──────────────────────────

type Mode = "solo" | "invite" | "team";

interface EmbeddingIndexOption {
    indexKey: string;
    label: string;
}

// ────────────────────────── Page ──────────────────────────

const SignupPage: React.FC = () => {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { userId, isLoaded: isAuthLoaded } = useAuth();
    const { user } = useUser();

    const [mode, setMode] = useState<Mode>("solo");
    const [embeddingIndexOptions, setEmbeddingIndexOptions] = useState<
        EmbeddingIndexOption[]
    >([]);
    const [defaultIndexKey, setDefaultIndexKey] = useState("");

    // ── Solo flow ──
    const [isCreatingSolo, setIsCreatingSolo] = useState(false);
    const [soloError, setSoloError] = useState<string | null>(null);

    // ── Invite flow ──
    const [inviteCode, setInviteCode] = useState("");
    const [inviteError, setInviteError] = useState<string | null>(null);
    const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);
    const [isJoining, setIsJoining] = useState(false);
    const autoJoinTriggered = useRef(false);

    // ── Team flow ──
    const [teamName, setTeamName] = useState("");
    const [teamSize, setTeamSize] = useState("");
    const [teamError, setTeamError] = useState<string | null>(null);
    const [isCreatingTeam, setIsCreatingTeam] = useState(false);
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [openaiKey, setOpenaiKey] = useState("");
    const [hfKey, setHfKey] = useState("");
    const [ollamaUrl, setOllamaUrl] = useState("");
    const [ollamaModel, setOllamaModel] = useState("");

    // Load embedding indexes (used by solo + team flow as a default)
    useEffect(() => {
        if (!userId) return;
        let cancelled = false;
        void (async () => {
            try {
                const res = await fetch("/api/embedding-indexes");
                if (!res.ok) return;
                const json = (await res.json()) as {
                    indexes: EmbeddingIndexOption[];
                };
                if (cancelled) return;
                setEmbeddingIndexOptions(json.indexes ?? []);
                if (json.indexes?.[0]) {
                    setDefaultIndexKey(json.indexes[0].indexKey);
                }
            } catch (err) {
                console.error("Failed to load embedding indexes:", err);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [userId]);

    // ── Join performed (shared by inline form + auto-join from ?code=) ──
    const performJoin = useCallback(
        async (code: string) => {
            if (!userId || !user) return;
            setIsJoining(true);
            setInviteError(null);
            setInviteSuccess(null);

            try {
                const regRes = await fetch("/api/signup/check-registration");
                const regData = (await regRes.json()) as {
                    data?: { registered: boolean; companyName?: string };
                };
                if (regData.data?.registered) {
                    setInviteError(
                        `You're already part of "${regData.data.companyName ?? "a workspace"}". You can't join a second one.`,
                    );
                    setIsJoining(false);
                    return;
                }

                const response = await fetch("/api/signup/join", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        userId,
                        name: user.fullName ?? user.username,
                        email: user.emailAddresses[0]?.emailAddress,
                        inviteCode: code,
                    }),
                });
                const raw: unknown = await response.json();

                if (!response.ok) {
                    const msg =
                        typeof raw === "object" && raw !== null && "message" in raw
                            ? (raw as { message: string }).message
                            : "Invalid or expired invite code.";
                    setInviteError(msg);
                    setIsJoining(false);
                    return;
                }

                const data = raw as {
                    data?: { redirectPath?: string };
                    message?: string;
                };
                setInviteSuccess(data.message ?? "You're in!");
                setTimeout(() => {
                    router.push(data.data?.redirectPath ?? "/");
                }, 1200);
            } catch (err) {
                console.error("Join failed:", err);
                setInviteError(
                    "Something went wrong. Check your connection and try again.",
                );
                setIsJoining(false);
            }
        },
        [userId, user, router],
    );

    // ── Auto-join when arriving via ?code=XYZ ──
    useEffect(() => {
        if (!isAuthLoaded || autoJoinTriggered.current) return;
        const codeFromUrl = searchParams.get("code");
        if (!codeFromUrl) return;
        setMode("invite");
        setInviteCode(codeFromUrl.toUpperCase());
        if (userId && user) {
            autoJoinTriggered.current = true;
            void performJoin(codeFromUrl);
        }
    }, [isAuthLoaded, userId, user, searchParams, performJoin]);

    // ── Solo: one-click workspace creation ──
    const startSolo = async () => {
        if (!userId || !user) return;
        setSoloError(null);
        setIsCreatingSolo(true);
        const firstName =
            user.firstName ??
            user.fullName?.split(" ")[0] ??
            user.username ??
            "Personal";
        const workspaceName = `${firstName}'s workspace`;
        try {
            const response = await fetch("/api/signup/employerCompany", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    userId,
                    name: user.fullName ?? user.username,
                    email: user.emailAddresses[0]?.emailAddress,
                    companyName: workspaceName,
                    numberOfEmployees: "1",
                    embeddingIndexKey: defaultIndexKey,
                }),
            });
            if (!response.ok) {
                const raw: unknown = await response.json();
                const msg =
                    typeof raw === "object" && raw !== null && "error" in raw
                        ? (raw as { error: string }).error
                        : "We couldn't set up your workspace. Please try again.";
                setSoloError(msg);
                setIsCreatingSolo(false);
                return;
            }
            router.push("/employer/onboarding");
        } catch (err) {
            console.error("Solo signup failed:", err);
            setSoloError(
                "We couldn't reach the server. Check your connection and try again.",
            );
            setIsCreatingSolo(false);
        }
    };

    // ── Team: create company with a form ──
    const createTeam = async (e: React.FormEvent) => {
        e.preventDefault();
        setTeamError(null);
        if (!teamName.trim()) {
            setTeamError("Please name your team workspace.");
            return;
        }
        if (!userId || !user) return;
        setIsCreatingTeam(true);
        try {
            const response = await fetch("/api/signup/employerCompany", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    userId,
                    name: user.fullName ?? user.username,
                    email: user.emailAddresses[0]?.emailAddress,
                    companyName: teamName.trim(),
                    numberOfEmployees: teamSize || "2",
                    embeddingIndexKey: defaultIndexKey,
                    embeddingOpenAIApiKey: openaiKey || null,
                    embeddingHuggingFaceApiKey: hfKey || null,
                    embeddingOllamaBaseUrl: ollamaUrl || null,
                    embeddingOllamaModel: ollamaModel || null,
                }),
            });
            if (!response.ok) {
                const raw: unknown = await response.json();
                const msg =
                    typeof raw === "object" && raw !== null && "error" in raw
                        ? (raw as { error: string }).error
                        : "Something went wrong. Please try again.";
                setTeamError(msg);
                setIsCreatingTeam(false);
                return;
            }
            router.push("/employer/onboarding");
        } catch (err) {
            console.error("Team signup failed:", err);
            setTeamError(
                "We couldn't reach the server. Check your connection and try again.",
            );
            setIsCreatingTeam(false);
        }
    };

    // ── Invite: validate + join ──
    const submitInvite = async (e: React.FormEvent) => {
        e.preventDefault();
        const code = inviteCode.trim();
        if (!code) {
            setInviteError("Enter your invite code to continue.");
            return;
        }
        setInviteError(null);
        // No separate validate step — /api/signup/join handles it in one hop.
        await performJoin(code);
    };

    // ────────────────────────── Render ──────────────────────────

    const renderBrandPanel = () => (
        <div style={{ width: "46%", display: "flex" }} className="auth-brand-col">
            <AuthBrandPanel
                tagline="Free · open source"
                headline="Your workspace, set up in under a minute."
                description="Built for solo founders, indie developers, and students. Start alone — invite people later if you ever need to."
            />
        </div>
    );

    const soloName =
        user?.firstName ?? user?.fullName?.split(" ")[0] ?? user?.username ?? null;

    // ── Not yet authenticated: show Clerk SignUp ──
    if (isAuthLoaded && !userId) {
        return (
            <Shell>
                <div style={formPanelStyle}>
                    <div style={{ width: "100%", maxWidth: 440 }}>
                        <Eyebrow>Get started</Eyebrow>
                        <Headline>Create your Launchstack account.</Headline>
                        <SubHeadline>
                            One account covers your solo workspace — and any team you
                            might create down the road.
                        </SubHeadline>
                        <SignUp
                            routing="hash"
                            forceRedirectUrl="/"
                            signInUrl="/signin"
                        />
                        <div style={bottomLinkStyle}>
                            Already have an account?{" "}
                            <Link href="/signin" style={linkStyle}>
                                Sign in →
                            </Link>
                        </div>
                    </div>
                </div>
                {renderBrandPanel()}
            </Shell>
        );
    }

    // ── Loading state ──
    if (!isAuthLoaded) {
        return (
            <Shell>
                <div style={formPanelStyle}>
                    <LoadingState label="Loading…" />
                </div>
                {renderBrandPanel()}
            </Shell>
        );
    }

    // ── Authenticated: pick a path ──
    return (
        <Shell>
            <div style={formPanelStyle}>
                <div style={{ width: "100%", maxWidth: 520 }}>
                    <Eyebrow>You&apos;re signed in</Eyebrow>
                    <Headline>
                        {soloName ? `Hey, ${soloName}.` : "Let's set you up."}
                    </Headline>
                    <SubHeadline>
                        One more step — pick how you want to use Launchstack.
                        You can always invite teammates later.
                    </SubHeadline>

                    <ModeSelect mode={mode} setMode={setMode} />

                    {mode === "solo" && (
                        <SoloCard
                            workspaceName={
                                soloName ? `${soloName}'s workspace` : "Your workspace"
                            }
                            onStart={() => void startSolo()}
                            isCreating={isCreatingSolo}
                            error={soloError}
                        />
                    )}

                    {mode === "invite" && (
                        <InviteCard
                            code={inviteCode}
                            setCode={setInviteCode}
                            onSubmit={(e) => void submitInvite(e)}
                            isJoining={isJoining}
                            error={inviteError}
                            success={inviteSuccess}
                            onClear={() => {
                                setInviteError(null);
                                setInviteSuccess(null);
                            }}
                        />
                    )}

                    {mode === "team" && (
                        <TeamCard
                            name={teamName}
                            setName={setTeamName}
                            size={teamSize}
                            setSize={setTeamSize}
                            onSubmit={(e) => void createTeam(e)}
                            isCreating={isCreatingTeam}
                            error={teamError}
                            showAdvanced={showAdvanced}
                            setShowAdvanced={setShowAdvanced}
                            openaiKey={openaiKey}
                            setOpenaiKey={setOpenaiKey}
                            hfKey={hfKey}
                            setHfKey={setHfKey}
                            ollamaUrl={ollamaUrl}
                            setOllamaUrl={setOllamaUrl}
                            ollamaModel={ollamaModel}
                            setOllamaModel={setOllamaModel}
                            defaultIndexKey={defaultIndexKey}
                            indexOptions={embeddingIndexOptions}
                        />
                    )}
                </div>
            </div>
            {renderBrandPanel()}
        </Shell>
    );
};

// ────────────────────────── Layout primitives ──────────────────────────

const formPanelStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "40px 24px",
};

const linkStyle: React.CSSProperties = {
    color: "var(--accent)",
    fontWeight: 600,
    textDecoration: "none",
};

const bottomLinkStyle: React.CSSProperties = {
    marginTop: 24,
    fontSize: 12.5,
    color: "var(--ink-3)",
    textAlign: "center",
};

function Shell({ children }: { children: React.ReactNode }) {
    return (
        <div
            style={{
                minHeight: "100vh",
                display: "flex",
                flexDirection: "column",
                background: "var(--bg)",
                color: "var(--ink)",
            }}
        >
            <AuthChrome />
            <div
                style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "stretch",
                    minHeight: 0,
                }}
            >
                {children}
            </div>
            <style>{`
                @media (max-width: 960px) {
                    .auth-brand-col { display: none !important; }
                }
            `}</style>
        </div>
    );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
    return (
        <div
            className="mono"
            style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.12em",
                color: "var(--ink-3)",
                textTransform: "uppercase",
                marginBottom: 10,
            }}
        >
            {children}
        </div>
    );
}

function Headline({ children }: { children: React.ReactNode }) {
    return (
        <h1
            className="serif"
            style={{
                fontSize: 32,
                lineHeight: 1.1,
                letterSpacing: "-0.02em",
                color: "var(--ink)",
                margin: "0 0 8px",
            }}
        >
            {children}
        </h1>
    );
}

function SubHeadline({ children }: { children: React.ReactNode }) {
    return (
        <p
            style={{
                fontSize: 14,
                color: "var(--ink-3)",
                lineHeight: 1.55,
                margin: 0,
                marginBottom: 24,
            }}
        >
            {children}
        </p>
    );
}

function LoadingState({ label }: { label: string }) {
    return (
        <div
            style={{
                padding: "48px 0",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 14,
                color: "var(--ink-3)",
                fontSize: 13,
            }}
        >
            <div
                style={{
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    border: "2px solid var(--line)",
                    borderTopColor: "var(--accent)",
                    animation: "lsw-spin 700ms linear infinite",
                }}
            />
            {label}
        </div>
    );
}

// ────────────────────────── Mode selector ──────────────────────────

function ModeSelect({
    mode,
    setMode,
}: {
    mode: Mode;
    setMode: (m: Mode) => void;
}) {
    const options: {
        key: Mode;
        label: string;
        sub: string;
        Icon: React.ComponentType<{ style?: React.CSSProperties }>;
    }[] = [
        {
            key: "solo",
            label: "Start solo",
            sub: "Just you — recommended",
            Icon: Rocket,
        },
        {
            key: "invite",
            label: "Use an invite code",
            sub: "Join an existing workspace",
            Icon: Ticket,
        },
        {
            key: "team",
            label: "Set up a team",
            sub: "Bring others in from day one",
            Icon: Users,
        },
    ];

    return (
        <div
            role="tablist"
            aria-label="How will you use Launchstack?"
            style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: 8,
                marginBottom: 20,
            }}
        >
            {options.map((opt) => {
                const active = mode === opt.key;
                return (
                    <button
                        key={opt.key}
                        role="tab"
                        aria-selected={active}
                        onClick={() => setMode(opt.key)}
                        style={{
                            textAlign: "left",
                            padding: "12px 14px",
                            borderRadius: 12,
                            border: `1px solid ${
                                active ? "var(--accent)" : "var(--line)"
                            }`,
                            background: active
                                ? "var(--accent-soft)"
                                : "var(--panel)",
                            transition:
                                "background 120ms, border-color 120ms, box-shadow 120ms",
                            boxShadow: active
                                ? "0 0 0 3px var(--accent-glow)"
                                : "none",
                            display: "flex",
                            flexDirection: "column",
                            gap: 6,
                        }}
                    >
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                            }}
                        >
                            <opt.Icon
                                style={{
                                    width: 14,
                                    height: 14,
                                    color: active
                                        ? "var(--accent)"
                                        : "var(--ink-3)",
                                }}
                            />
                            <span
                                style={{
                                    fontSize: 13,
                                    fontWeight: 600,
                                    color: "var(--ink)",
                                }}
                            >
                                {opt.label}
                            </span>
                        </div>
                        <span
                            style={{
                                fontSize: 11.5,
                                color: active
                                    ? "var(--accent-ink)"
                                    : "var(--ink-3)",
                                lineHeight: 1.45,
                            }}
                        >
                            {opt.sub}
                        </span>
                    </button>
                );
            })}
        </div>
    );
}

// ────────────────────────── Solo card ──────────────────────────

function SoloCard({
    workspaceName,
    onStart,
    isCreating,
    error,
}: {
    workspaceName: string;
    onStart: () => void;
    isCreating: boolean;
    error: string | null;
}) {
    return (
        <div style={cardStyle}>
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    marginBottom: 8,
                }}
            >
                <div
                    style={{
                        width: 28,
                        height: 28,
                        borderRadius: 8,
                        background: "var(--accent-soft)",
                        color: "var(--accent)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                >
                    <Rocket style={{ width: 14, height: 14 }} />
                </div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>
                    Your personal workspace
                </div>
            </div>
            <div
                style={{
                    fontSize: 13,
                    color: "var(--ink-3)",
                    lineHeight: 1.6,
                    marginBottom: 14,
                }}
            >
                We&apos;ll spin up{" "}
                <span
                    style={{
                        color: "var(--ink-2)",
                        fontWeight: 600,
                    }}
                >
                    {workspaceName}
                </span>{" "}
                for you. No billing, no team setup — just you, your sources, and
                an AI that knows them.
            </div>
            {error && <ErrorBanner>{error}</ErrorBanner>}
            <button
                onClick={onStart}
                disabled={isCreating}
                style={primaryButtonStyle(isCreating)}
            >
                {isCreating ? (
                    <>
                        <Spinner /> Setting things up…
                    </>
                ) : (
                    <>
                        Start my workspace
                        <ArrowRight style={{ width: 14, height: 14 }} />
                    </>
                )}
            </button>
        </div>
    );
}

// ────────────────────────── Invite card ──────────────────────────

function InviteCard({
    code,
    setCode,
    onSubmit,
    isJoining,
    error,
    success,
    onClear,
}: {
    code: string;
    setCode: (v: string) => void;
    onSubmit: (e: React.FormEvent) => void;
    isJoining: boolean;
    error: string | null;
    success: string | null;
    onClear: () => void;
}) {
    if (success) {
        return (
            <div style={cardStyle}>
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        color: "var(--ok)",
                        fontSize: 14,
                        fontWeight: 600,
                        marginBottom: 6,
                    }}
                >
                    <CheckCircle2 style={{ width: 16, height: 16 }} /> {success}
                </div>
                <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                    Taking you to your workspace…
                </div>
            </div>
        );
    }
    return (
        <form onSubmit={onSubmit} style={cardStyle}>
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    marginBottom: 8,
                }}
            >
                <div
                    style={{
                        width: 28,
                        height: 28,
                        borderRadius: 8,
                        background: "var(--accent-soft)",
                        color: "var(--accent)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                >
                    <Ticket style={{ width: 14, height: 14 }} />
                </div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>
                    Enter your invite code
                </div>
            </div>
            <div
                style={{
                    fontSize: 12.5,
                    color: "var(--ink-3)",
                    marginBottom: 12,
                    lineHeight: 1.55,
                }}
            >
                Ask whoever invited you for the 8–12 character code they got from
                Launchstack.
            </div>
            <input
                value={code}
                onChange={(e) => {
                    setCode(e.target.value.toUpperCase());
                    onClear();
                }}
                placeholder="ABCD-1234"
                maxLength={16}
                autoComplete="off"
                style={{
                    ...inputStyle,
                    letterSpacing: "0.08em",
                    fontFamily:
                        "var(--font-jetbrains-mono), ui-monospace, monospace",
                    textTransform: "uppercase",
                    marginBottom: 10,
                }}
            />
            {error && <ErrorBanner>{error}</ErrorBanner>}
            <button
                type="submit"
                disabled={isJoining || code.trim().length === 0}
                style={primaryButtonStyle(isJoining || code.trim().length === 0)}
            >
                {isJoining ? (
                    <>
                        <Spinner /> Joining…
                    </>
                ) : (
                    <>
                        Join workspace
                        <ArrowRight style={{ width: 14, height: 14 }} />
                    </>
                )}
            </button>
        </form>
    );
}

// ────────────────────────── Team card ──────────────────────────

function TeamCard({
    name,
    setName,
    size,
    setSize,
    onSubmit,
    isCreating,
    error,
    showAdvanced,
    setShowAdvanced,
    openaiKey,
    setOpenaiKey,
    hfKey,
    setHfKey,
    ollamaUrl,
    setOllamaUrl,
    ollamaModel,
    setOllamaModel,
    defaultIndexKey,
    indexOptions,
}: {
    name: string;
    setName: (v: string) => void;
    size: string;
    setSize: (v: string) => void;
    onSubmit: (e: React.FormEvent) => void;
    isCreating: boolean;
    error: string | null;
    showAdvanced: boolean;
    setShowAdvanced: (v: boolean) => void;
    openaiKey: string;
    setOpenaiKey: (v: string) => void;
    hfKey: string;
    setHfKey: (v: string) => void;
    ollamaUrl: string;
    setOllamaUrl: (v: string) => void;
    ollamaModel: string;
    setOllamaModel: (v: string) => void;
    defaultIndexKey: string;
    indexOptions: EmbeddingIndexOption[];
}) {
    const selectedLabel =
        indexOptions.find((i) => i.indexKey === defaultIndexKey)?.label ??
        (indexOptions.length === 0 ? "loading…" : defaultIndexKey);

    return (
        <form onSubmit={onSubmit} style={cardStyle}>
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    marginBottom: 8,
                }}
            >
                <div
                    style={{
                        width: 28,
                        height: 28,
                        borderRadius: 8,
                        background: "var(--accent-soft)",
                        color: "var(--accent)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                >
                    <Users style={{ width: 14, height: 14 }} />
                </div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>Team workspace</div>
            </div>
            <div
                style={{
                    fontSize: 12.5,
                    color: "var(--ink-3)",
                    marginBottom: 14,
                    lineHeight: 1.55,
                }}
            >
                Pick a name everyone will recognize. You can invite teammates
                right after setup.
            </div>

            <Label>Workspace name</Label>
            <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Acme, Research Lab, YC W26 Team…"
                style={{ ...inputStyle, marginBottom: 12 }}
            />

            <Label>How many people (approx)</Label>
            <input
                type="number"
                min={1}
                value={size}
                onChange={(e) => setSize(e.target.value)}
                placeholder="2"
                style={{ ...inputStyle, marginBottom: 14 }}
            />

            <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 12,
                    color: "var(--ink-3)",
                    marginBottom: 12,
                    padding: "2px 0",
                }}
            >
                <ChevronDown
                    style={{
                        width: 12,
                        height: 12,
                        transform: showAdvanced ? "rotate(0deg)" : "rotate(-90deg)",
                        transition: "transform 140ms",
                    }}
                />
                Advanced (BYOK &amp; self-host)
            </button>

            {showAdvanced && (
                <div
                    style={{
                        padding: 14,
                        borderRadius: 10,
                        background: "var(--panel-2)",
                        border: "1px solid var(--line)",
                        marginBottom: 14,
                    }}
                >
                    <div
                        style={{
                            fontSize: 11.5,
                            color: "var(--ink-3)",
                            lineHeight: 1.55,
                            marginBottom: 12,
                        }}
                    >
                        Bring your own keys. Leave empty to use the shared
                        defaults. Embedding index:{" "}
                        <span
                            className="mono"
                            style={{
                                color: "var(--ink-2)",
                            }}
                        >
                            {selectedLabel}
                        </span>
                        .
                    </div>
                    <Label>OpenAI API key</Label>
                    <input
                        type="password"
                        value={openaiKey}
                        onChange={(e) => setOpenaiKey(e.target.value)}
                        placeholder="sk-…"
                        autoComplete="off"
                        style={{ ...inputStyle, marginBottom: 10 }}
                    />
                    <Label>Hugging Face token</Label>
                    <input
                        type="password"
                        value={hfKey}
                        onChange={(e) => setHfKey(e.target.value)}
                        placeholder="hf_…"
                        autoComplete="off"
                        style={{ ...inputStyle, marginBottom: 10 }}
                    />
                    <div
                        style={{
                            display: "grid",
                            gridTemplateColumns: "1fr 1fr",
                            gap: 10,
                        }}
                    >
                        <div>
                            <Label>Ollama URL</Label>
                            <input
                                value={ollamaUrl}
                                onChange={(e) => setOllamaUrl(e.target.value)}
                                placeholder="http://localhost:11434"
                                autoComplete="off"
                                style={inputStyle}
                            />
                        </div>
                        <div>
                            <Label>Ollama model</Label>
                            <input
                                value={ollamaModel}
                                onChange={(e) => setOllamaModel(e.target.value)}
                                placeholder="nomic-embed-text"
                                autoComplete="off"
                                style={inputStyle}
                            />
                        </div>
                    </div>
                </div>
            )}

            {error && <ErrorBanner>{error}</ErrorBanner>}
            <button
                type="submit"
                disabled={isCreating}
                style={primaryButtonStyle(isCreating)}
            >
                {isCreating ? (
                    <>
                        <Spinner /> Creating…
                    </>
                ) : (
                    <>
                        Create team workspace
                        <ArrowRight style={{ width: 14, height: 14 }} />
                    </>
                )}
            </button>
        </form>
    );
}

// ────────────────────────── Small bits ──────────────────────────

const cardStyle: React.CSSProperties = {
    padding: 20,
    borderRadius: 14,
    border: "1px solid var(--line)",
    background: "var(--panel)",
    animation: "lsw-fadeIn 180ms",
};

const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "9px 12px",
    borderRadius: 9,
    border: "1px solid var(--line)",
    background: "var(--panel)",
    fontSize: 14,
    color: "var(--ink)",
    outline: "none",
    fontFamily: "inherit",
};

function Label({ children }: { children: React.ReactNode }) {
    return (
        <label
            style={{
                display: "block",
                fontSize: 12,
                fontWeight: 600,
                color: "var(--ink-2)",
                marginBottom: 6,
            }}
        >
            {children}
        </label>
    );
}

function primaryButtonStyle(disabled: boolean): React.CSSProperties {
    return {
        width: "100%",
        padding: "11px 14px",
        borderRadius: 10,
        background: disabled ? "var(--line)" : "var(--accent)",
        color: disabled ? "var(--ink-3)" : "white",
        fontSize: 14,
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        boxShadow: disabled ? "none" : "0 1px 6px var(--accent-glow)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        transition: "background 120ms, box-shadow 120ms",
    };
}

function Spinner() {
    return (
        <div
            style={{
                width: 14,
                height: 14,
                borderRadius: "50%",
                border: "2px solid rgba(255,255,255,0.4)",
                borderTopColor: "white",
                animation: "lsw-spin 700ms linear infinite",
            }}
        />
    );
}

function ErrorBanner({ children }: { children: React.ReactNode }) {
    return (
        <div
            style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                padding: "9px 12px",
                borderRadius: 9,
                background: "oklch(0.96 0.04 25)",
                color: "var(--danger)",
                fontSize: 12.5,
                lineHeight: 1.5,
                marginBottom: 12,
            }}
        >
            <AlertCircle
                style={{
                    width: 14,
                    height: 14,
                    marginTop: 2,
                    flexShrink: 0,
                }}
            />
            <div style={{ flex: 1 }}>{children}</div>
        </div>
    );
}

export default function SignupPageWrapper() {
    return (
        <Suspense>
            <SignupPage />
        </Suspense>
    );
}
