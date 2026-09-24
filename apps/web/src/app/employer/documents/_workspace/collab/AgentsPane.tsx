"use client";

/**
 * Agents — the roster as a first-class app.
 *
 * One list, one agent at a time. Reading an agent means seeing what it is
 * (handle, role, when to use it), what it may use (tools, route, autonomy),
 * and — the part the settings card never had — *trying it*: a scratch chat
 * held with that agent over the workspace's sources, the same route the main
 * chat uses, so what you test is what you get. The definition-file tab is the
 * same agent as text, for review, export and import.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Bot,
    Copy,
    Download,
    FileText,
    MessageSquare,
    Play,
    Plus,
    RotateCcw,
    Search,
    SendHorizontal,
    Trash2,
    Upload,
    Users,
} from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { Textarea } from "~/components/ui/textarea";
import {
    AGENT_AUTONOMY_META,
    DEFAULT_AGENT_AUTONOMY,
    effectiveAutonomy,
    isAgentAutonomy,
} from "~/lib/agents/autonomy";
import { agentFileName, serializeAgentFile } from "~/lib/agents/agent-file";
import {
    AGENT_MODE_META,
    AGENT_TOOLS,
    agentAllows,
    coerceAgentDefinition,
    type AgentDefinition,
} from "~/lib/agents/definition";
import { starterAgent } from "~/lib/agents/starter-agents";
import { usePermissions } from "~/lib/use-permissions";
import { cn } from "~/lib/utils";

import type { AIChatResponse } from "../../hooks/useAIChat";
import { AgentAvatar } from "./AgentAvatar";
import { AgentEditor } from "./AgentEditor";
import { useAgents } from "./useMeetings";
import { type AgentPersonaRecord } from "./types";

export interface AgentsPaneProps {
    /** Picks the agent in the chat composer and switches to the chat tab. */
    onUseInChat?: (agentKey: string) => void;
    /** Opens the new-meeting dialog with this agent seated. */
    onStartMeeting?: (agentKey: string) => void;
    /** Selects an agent by handle — the palette's "Open X in Agents". */
    selectRequest?: { key: string; nonce: number } | null;
}

function toDefinition(persona: AgentPersonaRecord): AgentDefinition {
    return coerceAgentDefinition({
        key: persona.id,
        displayName: persona.displayName,
        role: persona.role,
        description: persona.description,
        systemPrompt: persona.systemPrompt,
        mode: persona.mode,
        tools: persona.tools,
        style: persona.style,
        route: persona.route,
        temperature: persona.temperature,
        maxTurnChars: persona.maxTurnChars,
        accent: persona.accent,
        avatarUrl: persona.avatarUrl,
        autonomy: persona.autonomy,
        nodeId: persona.nodeId,
    });
}

export function AgentsPane({ onUseInChat, onStartMeeting, selectRequest }: AgentsPaneProps) {
    const { data, loading, error, refresh } = useAgents({ includeArchived: true });
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [query, setQuery] = useState("");
    const [editing, setEditing] = useState<{
        persona: AgentPersonaRecord | null;
        seed?: Partial<AgentDefinition>;
    } | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const importInput = useRef<HTMLInputElement>(null);

    const personas = useMemo(() => data?.personas ?? [], [data]);
    const active = useMemo(() => personas.filter(p => !p.archived), [personas]);
    const retired = useMemo(() => personas.filter(p => p.archived), [personas]);
    const selected = personas.find(p => p.dbId === selectedId) ?? null;
    const defaultAutonomy = isAgentAutonomy(data?.defaults?.autonomy)
        ? data.defaults.autonomy
        : DEFAULT_AGENT_AUTONOMY;

    // Land on the first agent so the pane opens on something to read.
    useEffect(() => {
        if (!selectedId && active.length > 0) setSelectedId(active[0]!.dbId);
    }, [active, selectedId]);

    // A request from the palette wins over the landing choice, once per nonce.
    useEffect(() => {
        if (!selectRequest) return;
        const match = personas.find(p => p.id === selectRequest.key);
        if (match) setSelectedId(match.dbId);
    }, [selectRequest, personas]);

    const filtered = useMemo(() => {
        const needle = query.trim().toLowerCase();
        if (!needle) return { active, retired };
        const match = (p: AgentPersonaRecord) =>
            [p.displayName, p.id, p.role, p.description].some(v =>
                v.toLowerCase().includes(needle)
            );
        return { active: active.filter(match), retired: retired.filter(match) };
    }, [query, active, retired]);

    const request = useCallback(
        async (path: string, init: RequestInit, done: string) => {
            const response = await fetch(path, init);
            const body = (await response.json().catch(() => ({}))) as {
                error?: string;
                persona?: AgentPersonaRecord;
            };
            if (!response.ok) {
                setNotice(body.error ?? "That did not work");
                return null;
            }
            setNotice(done);
            await refresh();
            return body.persona ?? null;
        },
        [refresh]
    );

    const retire = (persona: AgentPersonaRecord) =>
        request(
            `/api/collab/agents/${persona.dbId}`,
            { method: "DELETE" },
            `${persona.displayName} retired. Past transcripts keep the name.`
        );
    const restore = (persona: AgentPersonaRecord) =>
        request(
            `/api/collab/agents/${persona.dbId}`,
            {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
            },
            ""
        ).then(() =>
            // PATCH cannot unarchive; reset does for starters, and for a custom
            // agent we re-import its own file with replace, which un-retires it.
            persona.builtin
                ? request(
                      `/api/collab/agents/${persona.dbId}/reset`,
                      { method: "POST" },
                      `${persona.displayName} is back.`
                  )
                : request(
                      "/api/collab/agents/import",
                      {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                              file: serializeAgentFile(toDefinition(persona)),
                              replace: true,
                          }),
                      },
                      `${persona.displayName} is back.`
                  )
        );
    const reset = (persona: AgentPersonaRecord) =>
        request(
            `/api/collab/agents/${persona.dbId}/reset`,
            { method: "POST" },
            `${persona.displayName} restored to the shipped definition.`
        );

    const importFile = async (file: File) => {
        const text = await file.text();
        const response = await fetch("/api/collab/agents/import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ file: text }),
        });
        const body = (await response.json().catch(() => ({}))) as {
            error?: string;
            persona?: AgentPersonaRecord;
            conflict?: { displayName: string };
        };
        if (response.status === 409 && body.conflict) {
            const replace = window.confirm(
                `${body.conflict.displayName} already uses that handle. Replace it with the file's definition?`
            );
            if (!replace) return;
            const again = await fetch("/api/collab/agents/import", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ file: text, replace: true }),
            });
            const replaced = (await again.json().catch(() => ({}))) as {
                error?: string;
                persona?: AgentPersonaRecord;
            };
            if (!again.ok) {
                setNotice(replaced.error ?? "Could not import that file");
                return;
            }
            setNotice(`${replaced.persona?.displayName ?? "Agent"} replaced from ${file.name}.`);
            await refresh();
            if (replaced.persona) setSelectedId(replaced.persona.dbId);
            return;
        }
        if (!response.ok) {
            setNotice(body.error ?? "Could not import that file");
            return;
        }
        setNotice(`${body.persona?.displayName ?? "Agent"} imported from ${file.name}.`);
        await refresh();
        if (body.persona) setSelectedId(body.persona.dbId);
    };

    return (
        <div className="bg-surface flex h-full min-h-0">
            <aside className="border-line bg-panel flex w-[280px] shrink-0 flex-col border-r">
                <div className="border-line flex items-center gap-2 border-b px-4 py-3">
                    <div className="min-w-0 flex-1">
                        <div className="mono text-ink-3 text-[10px] font-bold uppercase tracking-[0.1em]">
                            Agents
                        </div>
                        <div className="text-ink-2 mt-0.5 text-[12.5px]">
                            {active.length} on the roster
                            {retired.length > 0 ? ` · ${retired.length} retired` : ""}
                        </div>
                    </div>
                    <input
                        ref={importInput}
                        type="file"
                        accept=".md,.markdown,text/markdown,text/plain"
                        className="hidden"
                        onChange={async event => {
                            const file = event.target.files?.[0];
                            if (file) await importFile(file);
                            event.target.value = "";
                        }}
                    />
                    <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        title="Import a definition file"
                        onClick={() => importInput.current?.click()}
                    >
                        <Upload className="size-3.5" />
                    </Button>
                    <Button
                        size="icon"
                        className="size-7"
                        title="New agent"
                        onClick={() => setEditing({ persona: null })}
                    >
                        <Plus className="size-3.5" />
                    </Button>
                </div>
                <div className="px-3 pt-3">
                    <label className="border-line bg-panel-2 text-ink-3 flex items-center gap-2 rounded-lg border px-2.5 py-1.5">
                        <Search className="size-3.5" />
                        <input
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder="Find an agent"
                            className="text-ink placeholder:text-ink-3 w-full bg-transparent text-[12.5px] outline-none"
                        />
                    </label>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4 pt-2">
                    {loading && personas.length === 0 && (
                        <div className="text-ink-3 px-2 py-3 text-[12.5px]">Loading agents…</div>
                    )}
                    {error && <div className="text-danger px-2 py-3 text-[12.5px]">{error}</div>}
                    {filtered.active.map(persona => (
                        <RosterRow
                            key={persona.dbId}
                            persona={persona}
                            active={persona.dbId === selectedId}
                            onClick={() => setSelectedId(persona.dbId)}
                        />
                    ))}
                    {filtered.retired.length > 0 && (
                        <>
                            <div className="mono text-ink-3 px-2 pb-1 pt-4 text-[9.5px] font-bold uppercase tracking-[0.1em]">
                                Retired
                            </div>
                            {filtered.retired.map(persona => (
                                <RosterRow
                                    key={persona.dbId}
                                    persona={persona}
                                    active={persona.dbId === selectedId}
                                    onClick={() => setSelectedId(persona.dbId)}
                                    muted
                                />
                            ))}
                        </>
                    )}
                </div>
            </aside>

            <main className="flex min-w-0 flex-1 flex-col">
                {notice && (
                    <div className="bg-brand-soft text-brand-ink border-line flex items-center gap-3 border-b px-5 py-2 text-[12.5px]">
                        <span className="flex-1">{notice}</span>
                        <button
                            className="opacity-70 hover:opacity-100"
                            onClick={() => setNotice(null)}
                            aria-label="Dismiss"
                        >
                            ×
                        </button>
                    </div>
                )}
                {selected ? (
                    <AgentDetail
                        key={selected.dbId}
                        persona={selected}
                        defaultAutonomy={defaultAutonomy}
                        onEdit={() => setEditing({ persona: selected })}
                        onDuplicate={() =>
                            setEditing({
                                persona: null,
                                seed: {
                                    ...toDefinition(selected),
                                    key: `${selected.id}-copy`,
                                    displayName: `${selected.displayName} (copy)`,
                                },
                            })
                        }
                        onRetire={() => void retire(selected)}
                        onRestore={() => void restore(selected)}
                        onReset={selected.builtin ? () => void reset(selected) : undefined}
                        onUseInChat={onUseInChat ? () => onUseInChat(selected.id) : undefined}
                        onStartMeeting={
                            onStartMeeting ? () => onStartMeeting(selected.id) : undefined
                        }
                    />
                ) : (
                    <div className="text-ink-3 flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
                        <Bot className="size-8 opacity-50" />
                        <div className="text-ink text-[15px] font-medium">
                            Pick an agent, or write one
                        </div>
                        <p className="max-w-sm text-[12.5px] leading-relaxed">
                            An agent is a name, a role and standing instructions grounded in a
                            method that works. The same agent sits in meetings, answers in chat when
                            picked or @mentioned, and can be exported as a file.
                        </p>
                    </div>
                )}
            </main>

            <AgentEditor
                open={editing !== null}
                persona={editing?.persona ?? null}
                seed={editing?.seed ?? null}
                nodeIds={(data?.nodes ?? []).map(node => node.nodeId)}
                onClose={() => setEditing(null)}
                onSaved={async persona => {
                    setEditing(null);
                    setNotice(`${persona.displayName} saved.`);
                    await refresh();
                    setSelectedId(persona.dbId);
                }}
            />
        </div>
    );
}

function RosterRow({
    persona,
    active,
    onClick,
    muted,
}: {
    persona: AgentPersonaRecord;
    active: boolean;
    onClick: () => void;
    muted?: boolean;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-current={active ? "true" : undefined}
            className={cn(
                "mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors",
                active ? "bg-brand-soft text-brand-ink" : "text-ink-2 hover:bg-line-2",
                muted && "opacity-60"
            )}
        >
            <AgentAvatar agent={persona} size={28} />
            <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-1.5">
                    <span
                        className={cn(
                            "truncate text-[12.5px]",
                            active ? "font-semibold" : "font-medium"
                        )}
                    >
                        {persona.displayName}
                    </span>
                    <span
                        className={cn(
                            "mono truncate text-[10.5px]",
                            active ? "text-brand-ink/70" : "text-ink-3"
                        )}
                    >
                        @{persona.id}
                    </span>
                </span>
                <span
                    className={cn(
                        "block truncate text-[11px]",
                        active ? "text-brand-ink/80" : "text-ink-3"
                    )}
                >
                    {persona.role}
                </span>
            </span>
        </button>
    );
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

function AgentDetail({
    persona,
    defaultAutonomy,
    onEdit,
    onDuplicate,
    onRetire,
    onRestore,
    onReset,
    onUseInChat,
    onStartMeeting,
}: {
    persona: AgentPersonaRecord;
    defaultAutonomy: ReturnType<typeof effectiveAutonomy>;
    onEdit: () => void;
    onDuplicate: () => void;
    onRetire: () => void;
    onRestore: () => void;
    onReset?: () => void;
    onUseInChat?: () => void;
    onStartMeeting?: () => void;
}) {
    const [tab, setTab] = useState("try");
    const definition = useMemo(() => toDefinition(persona), [persona]);
    const autonomy = effectiveAutonomy(persona.autonomy, defaultAutonomy);
    const starter = persona.builtin ? starterAgent(persona.id) : undefined;

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <header className="border-line bg-panel border-b px-6 pb-4 pt-5">
                <div className="flex flex-wrap items-start gap-4">
                    <AgentAvatar agent={persona} size={56} />
                    <div className="min-w-[260px] flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                            <h1 className="serif text-ink m-0 text-[24px] leading-tight">
                                {persona.displayName}
                            </h1>
                            <span className="mono text-ink-3 text-[12px]">@{persona.id}</span>
                            {persona.archived && <Badge variant="warn">retired</Badge>}
                            {persona.builtin && <Badge variant="secondary">starter</Badge>}
                        </div>
                        <div className="text-ink-2 mt-0.5 text-[13.5px] font-medium">
                            {persona.role}
                        </div>
                        {persona.description && (
                            <p className="text-ink-3 m-0 mt-1.5 max-w-[640px] text-[13px] leading-relaxed">
                                {persona.description}
                            </p>
                        )}
                    </div>
                    <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                        {persona.archived ? (
                            <Button variant="outline" size="sm" onClick={onRestore}>
                                <RotateCcw className="size-3.5" /> Bring back
                            </Button>
                        ) : (
                            <>
                                {onUseInChat && (
                                    <Button
                                        size="sm"
                                        onClick={onUseInChat}
                                        title="Pick this agent in the chat composer"
                                    >
                                        <MessageSquare className="size-3.5" /> Use in chat
                                    </Button>
                                )}
                                {onStartMeeting && (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={onStartMeeting}
                                        title="Open a new meeting with this agent seated"
                                    >
                                        <Users className="size-3.5" /> Put in a meeting
                                    </Button>
                                )}
                                <Button variant="outline" size="sm" onClick={onEdit}>
                                    Edit
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-8"
                                    title="Duplicate"
                                    onClick={onDuplicate}
                                >
                                    <Copy className="size-3.5" />
                                </Button>
                                {onReset && (
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="size-8"
                                        title="Restore the shipped definition"
                                        onClick={onReset}
                                    >
                                        <RotateCcw className="size-3.5" />
                                    </Button>
                                )}
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="text-ink-3 hover:text-danger size-8"
                                    title="Retire"
                                    onClick={onRetire}
                                >
                                    <Trash2 className="size-3.5" />
                                </Button>
                            </>
                        )}
                    </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-1.5">
                    <Badge variant="info" title={AGENT_MODE_META[persona.mode].description}>
                        {AGENT_MODE_META[persona.mode].label}
                    </Badge>
                    <Badge
                        variant={autonomy === "full" ? "secondary" : "warn"}
                        title={AGENT_AUTONOMY_META[autonomy].description}
                    >
                        {AGENT_AUTONOMY_META[autonomy].label}
                        {isAgentAutonomy(persona.autonomy) ? "" : " · default"}
                    </Badge>
                    <Badge variant="secondary">
                        {persona.route ? `${persona.route} route` : "default route"}
                    </Badge>
                    {persona.style && <Badge variant="secondary">{persona.style}</Badge>}
                    {persona.temperature !== undefined && (
                        <Badge variant="outline">temp {persona.temperature}</Badge>
                    )}
                    {persona.nodeId && <Badge variant="outline">node {persona.nodeId}</Badge>}
                    <span className="text-ink-4 mx-1">·</span>
                    {AGENT_TOOLS.map(tool => {
                        const on = agentAllows(persona.tools, tool.id);
                        return (
                            <span
                                key={tool.id}
                                title={`${tool.description}${on ? "" : " (off for this agent)"}`}
                                className={cn(
                                    "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px]",
                                    on
                                        ? "bg-success-soft text-success"
                                        : "bg-line-2 text-ink-3 line-through"
                                )}
                            >
                                {tool.label}
                            </span>
                        );
                    })}
                    {persona.tools === null && (
                        <span className="text-ink-3 text-[11px]">
                            · every tool, including new ones
                        </span>
                    )}
                </div>
            </header>

            <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
                <div className="border-line bg-panel border-b px-6 py-2">
                    <TabsList>
                        <TabsTrigger value="try">
                            <Play className="size-3.5" /> Try it
                        </TabsTrigger>
                        <TabsTrigger value="instructions">Instructions</TabsTrigger>
                        <TabsTrigger value="file">
                            <FileText className="size-3.5" /> Definition file
                        </TabsTrigger>
                    </TabsList>
                </div>
                <TabsContent value="try" className="min-h-0 flex-1">
                    <Playground persona={persona} />
                </TabsContent>
                <TabsContent
                    value="instructions"
                    className="min-h-0 flex-1 overflow-y-auto px-6 py-5"
                >
                    <div className="text-ink-3 mb-2 text-[11.5px] uppercase tracking-[0.08em]">
                        Standing instructions
                    </div>
                    <pre className="text-ink-2 border-line bg-panel m-0 max-w-[760px] whitespace-pre-wrap rounded-xl border px-5 py-4 font-sans text-[13.5px] leading-relaxed">
                        {persona.systemPrompt}
                    </pre>
                    {starter && (
                        <div className="border-line bg-panel-2 mt-5 max-w-[760px] rounded-xl border px-5 py-4">
                            <div className="mono text-ink-3 mb-1.5 text-[10px] font-bold uppercase tracking-[0.1em]">
                                Where this comes from
                            </div>
                            <p className="text-ink-2 m-0 text-[13px] leading-relaxed">
                                {starter.basis.summary}
                            </p>
                            <ul className="m-0 mt-2 list-none p-0">
                                {starter.basis.sources.map(source => (
                                    <li
                                        key={source.title}
                                        className="text-ink-3 text-[12px] leading-relaxed"
                                    >
                                        {source.url ? (
                                            <a
                                                href={source.url}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="text-brand-ink underline-offset-2 hover:underline"
                                            >
                                                {source.title}
                                            </a>
                                        ) : (
                                            source.title
                                        )}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                    <div className="text-ink-3 mt-4 max-w-[760px] text-[12px] leading-relaxed">
                        In chat these instructions go above the answer style
                        {persona.style ? ` (${persona.style})` : ""}; in a meeting they go under the
                        meeting&apos;s objective, agenda and current phase. The agent always sees
                        the workspace&apos;s cited passages when retrieval is on.
                    </div>
                </TabsContent>
                <TabsContent value="file" className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                    <DefinitionFile definition={definition} personaDbId={persona.dbId} />
                </TabsContent>
            </Tabs>
        </div>
    );
}

function DefinitionFile({
    definition,
    personaDbId,
}: {
    definition: AgentDefinition;
    personaDbId: string;
}) {
    const text = useMemo(() => serializeAgentFile(definition), [definition]);
    const [copied, setCopied] = useState(false);
    return (
        <div className="max-w-[760px]">
            <div className="text-ink-3 mb-3 text-[12.5px] leading-relaxed">
                The same agent as a file — front matter for the settings, the body is the
                instructions. It is the shape OpenCode and Claude Code agents use, so it moves
                between tools. Import one with the upload button on the left.
            </div>
            <div className="border-line bg-panel overflow-hidden rounded-xl border">
                <div className="border-line flex items-center gap-2 border-b px-3 py-2">
                    <span className="mono text-ink-3 flex-1 text-[11px]">
                        {agentFileName(definition)}
                    </span>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={async () => {
                            try {
                                await navigator.clipboard.writeText(text);
                                setCopied(true);
                                setTimeout(() => setCopied(false), 1500);
                            } catch {
                                /* clipboard refused — the download still works */
                            }
                        }}
                    >
                        <Copy className="size-3.5" /> {copied ? "Copied" : "Copy"}
                    </Button>
                    <Button variant="ghost" size="sm" asChild>
                        <a href={`/api/collab/agents/${personaDbId}/file?download=1`}>
                            <Download className="size-3.5" /> Download
                        </a>
                    </Button>
                </div>
                <pre className="mono text-ink-2 m-0 whitespace-pre-wrap px-4 py-3 text-[12px] leading-relaxed">
                    {text}
                </pre>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Playground — a scratch chat with one agent, through the real chat route
// ---------------------------------------------------------------------------

interface PlayTurn {
    role: "user" | "assistant";
    text: string;
    model?: string;
    citations?: number;
    notes?: string[];
    error?: boolean;
}

function Playground({ persona }: { persona: AgentPersonaRecord }) {
    const { companyId } = usePermissions();
    const [turns, setTurns] = useState<PlayTurn[]>([]);
    const [draft, setDraft] = useState("");
    const [busy, setBusy] = useState(false);
    const scroller = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const el = scroller.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [turns, busy]);

    const send = async (text: string) => {
        const question = text.trim();
        if (!question || busy) return;
        setDraft("");
        const history = turns
            .slice(-6)
            .map(
                t => `${t.role === "user" ? "User" : persona.displayName}: ${t.text.slice(0, 800)}`
            )
            .join("\n\n");
        setTurns(prev => [...prev, { role: "user", text: question }]);
        setBusy(true);
        try {
            const response = await fetch("/api/agents/documentQ&A/AIChat/query", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    question,
                    searchScope: companyId ? "company" : "document",
                    companyId: companyId ?? undefined,
                    agentKey: persona.id,
                    conversationHistory: history || undefined,
                }),
            });
            const data = (await response.json().catch(() => ({}))) as AIChatResponse;
            if (!response.ok || !data.success) {
                setTurns(prev => [
                    ...prev,
                    {
                        role: "assistant",
                        text: data.message ?? data.error ?? `Request failed (${response.status})`,
                        error: true,
                    },
                ]);
                return;
            }
            setTurns(prev => [
                ...prev,
                {
                    role: "assistant",
                    text: data.summarizedAnswer ?? "(no answer)",
                    model: data.aiModel,
                    citations: data.references?.length ?? 0,
                    notes: data.agent?.notes,
                },
            ]);
        } catch (err) {
            setTurns(prev => [
                ...prev,
                {
                    role: "assistant",
                    text: err instanceof Error ? err.message : "Could not reach the model",
                    error: true,
                },
            ]);
        } finally {
            setBusy(false);
        }
    };

    const suggestions = [
        `What should I ask you about, ${persona.displayName}?`,
        "Summarize what my sources say about our biggest risk right now.",
        "What would you push back on in our current plan?",
    ];

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                <div className="mx-auto max-w-[760px]">
                    {turns.length === 0 ? (
                        <div className="text-ink-3 flex flex-col gap-3 pt-6">
                            <div className="text-ink text-[14px] font-medium">
                                Try {persona.displayName} before you rely on it
                            </div>
                            <p className="m-0 max-w-[560px] text-[12.5px] leading-relaxed">
                                A scratch conversation held with this agent over the
                                workspace&apos;s sources, through the same route the main chat uses.
                                Nothing here is saved.
                            </p>
                            <div className="flex flex-wrap gap-2">
                                {suggestions.map(s => (
                                    <button
                                        key={s}
                                        type="button"
                                        onClick={() => void send(s)}
                                        className="border-line bg-panel text-ink-2 hover:border-brand rounded-full border px-3 py-1.5 text-left text-[12px] transition-colors"
                                    >
                                        {s}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : (
                        turns.map((turn, index) => (
                            <div key={index} className="mb-5">
                                <div className="mb-1.5 flex items-center gap-2">
                                    {turn.role === "user" ? (
                                        <span className="bg-ink text-panel inline-flex size-5 items-center justify-center rounded-full text-[9px] font-bold">
                                            You
                                        </span>
                                    ) : (
                                        <AgentAvatar agent={persona} size={20} />
                                    )}
                                    <span className="text-ink text-[12.5px] font-semibold">
                                        {turn.role === "user" ? "You" : persona.displayName}
                                    </span>
                                    {turn.model && (
                                        <span className="mono text-ink-3 text-[10px]">
                                            · {turn.model}
                                        </span>
                                    )}
                                    {turn.citations !== undefined && turn.citations > 0 && (
                                        <span className="text-ink-3 text-[10.5px]">
                                            · {turn.citations} passage
                                            {turn.citations === 1 ? "" : "s"}
                                        </span>
                                    )}
                                </div>
                                <div
                                    className={cn(
                                        "whitespace-pre-wrap text-[13.5px] leading-relaxed",
                                        turn.error ? "text-danger" : "text-ink-2"
                                    )}
                                >
                                    {turn.text}
                                </div>
                                {turn.notes && turn.notes.length > 0 && (
                                    <div className="text-ink-3 mt-1 text-[11px]">
                                        Agent policy: {turn.notes.join("; ")}.
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                    {busy && (
                        <div className="text-ink-3 flex items-center gap-2 text-[12px] italic">
                            <span className="bg-brand size-1.5 animate-pulse rounded-full" />
                            {persona.displayName} is thinking…
                        </div>
                    )}
                </div>
            </div>
            <div className="border-line bg-panel border-t px-6 py-3">
                <div className="border-line bg-panel-2 mx-auto flex max-w-[760px] items-end gap-2 rounded-xl border px-3 py-2">
                    <Textarea
                        value={draft}
                        onChange={e => setDraft(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                void send(draft);
                            }
                        }}
                        rows={1}
                        placeholder={`Ask ${persona.displayName} something…`}
                        className="min-h-0 flex-1 resize-none border-0 bg-transparent p-0 text-[13.5px] shadow-none focus-visible:ring-0"
                    />
                    <Button
                        size="sm"
                        onClick={() => void send(draft)}
                        disabled={busy || !draft.trim()}
                    >
                        <SendHorizontal className="size-3.5" />
                    </Button>
                </div>
                <div className="text-ink-3 mx-auto mt-1.5 max-w-[760px] text-[11px]">
                    Enter to send · answers cite the workspace&apos;s sources · not saved to your
                    chat history
                </div>
            </div>
        </div>
    );
}
