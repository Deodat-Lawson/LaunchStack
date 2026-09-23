"use client";

/**
 * Create or edit one agent.
 *
 * Two views of the same definition: a form, and the definition file it
 * serialises to (markdown with front matter — the shape OpenCode and Claude
 * Code agents are written in). Editing either updates the other, so a person
 * who thinks in files can paste one in and a person who thinks in fields
 * never has to see the front matter.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, FileText, RotateCcw, Upload } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "~/components/ui/dialog";
import { Switch } from "~/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { Field, SelectInput, TextArea, TextInput } from "~/components/field";
import { AGENT_AUTONOMY_LEVELS, AGENT_AUTONOMY_META, isAgentAutonomy } from "~/lib/agents/autonomy";
import {
    AGENT_MODES,
    AGENT_MODE_META,
    AGENT_STYLE_IDS,
    AGENT_TOOL_IDS,
    AGENT_TOOL_META,
    coerceAgentDefinition,
    isAgentMode,
    isAgentRoute,
    toAgentKey,
    type AgentDefinition,
    type AgentToolPolicy,
} from "~/lib/agents/definition";
import {
    AgentFileError,
    agentFileName,
    parseAgentFile,
    serializeAgentFile,
} from "~/lib/agents/agent-file";
import { cn } from "~/lib/utils";

import { initialsOf, personaColor, type AgentPersonaRecord } from "./types";

const ROUTES = [
    { value: "", label: "Default route" },
    { value: "fast", label: "Fast" },
    { value: "reasoning", label: "Reasoning" },
    { value: "vision", label: "Vision" },
];

const STYLE_LABELS: Record<(typeof AGENT_STYLE_IDS)[number], string> = {
    concise: "Concise — direct and short",
    detailed: "Detailed — comprehensive with context",
    academic: "Academic — analytical and precise",
    organized: "Organized — structured with headings",
};

/** Eight accents that read on both themes. Stored as literal OKLCH, like the mindmap. */
const ACCENTS = [
    "oklch(0.55 0.14 250)",
    "oklch(0.58 0.15 165)",
    "oklch(0.55 0.14 225)",
    "oklch(0.6 0.17 50)",
    "oklch(0.6 0.15 30)",
    "oklch(0.58 0.16 300)",
    "oklch(0.62 0.17 15)",
    "oklch(0.6 0.15 120)",
    "oklch(0.58 0.14 195)",
    "oklch(0.5 0.12 350)",
];

export interface AgentEditorProps {
    /** Null creates a new agent. */
    persona: AgentPersonaRecord | null;
    /** Known worker nodes, for the datalist. */
    nodeIds?: string[];
    open: boolean;
    onClose: () => void;
    onSaved: (persona: AgentPersonaRecord) => void | Promise<void>;
    /** A definition to start a new agent from (duplicate, or an imported file). */
    seed?: Partial<AgentDefinition> | null;
}

interface FormState {
    key: string;
    displayName: string;
    role: string;
    description: string;
    systemPrompt: string;
    mode: string;
    style: string;
    route: string;
    autonomy: string;
    temperature: string;
    maxTurnChars: string;
    nodeId: string;
    accent: string;
    tools: AgentToolPolicy;
}

function fromPersona(
    persona: AgentPersonaRecord | null,
    seed?: Partial<AgentDefinition> | null
): FormState {
    const source: Partial<AgentDefinition> = persona
        ? {
              key: persona.id,
              displayName: persona.displayName,
              role: persona.role,
              description: persona.description,
              systemPrompt: persona.systemPrompt,
              mode: persona.mode,
              style: persona.style,
              route: isAgentRoute(persona.route) ? persona.route : null,
              autonomy: persona.autonomy ?? null,
              temperature: persona.temperature ?? null,
              maxTurnChars: persona.maxTurnChars ?? null,
              nodeId: persona.nodeId ?? null,
              accent: persona.accent ?? null,
              tools: persona.tools,
          }
        : (seed ?? {});
    return {
        key: source.key ?? "",
        displayName: source.displayName ?? "",
        role: source.role ?? "",
        description: source.description ?? "",
        systemPrompt: source.systemPrompt ?? "",
        mode: source.mode ?? "all",
        style: source.style ?? "",
        route: source.route ?? "",
        autonomy: source.autonomy ?? "",
        temperature:
            source.temperature === null || source.temperature === undefined
                ? ""
                : String(source.temperature),
        maxTurnChars:
            source.maxTurnChars === null || source.maxTurnChars === undefined
                ? ""
                : String(source.maxTurnChars),
        nodeId: source.nodeId ?? "",
        accent: source.accent ?? ACCENTS[(source.key?.length ?? 0) % ACCENTS.length]!,
        tools: source.tools ?? {},
    };
}

function toDefinition(form: FormState): AgentDefinition {
    return coerceAgentDefinition({
        key: form.key,
        displayName: form.displayName,
        role: form.role,
        description: form.description,
        systemPrompt: form.systemPrompt,
        mode: form.mode,
        style: form.style || null,
        route: form.route || null,
        autonomy: form.autonomy || null,
        temperature: form.temperature === "" ? null : Number(form.temperature),
        maxTurnChars: form.maxTurnChars === "" ? null : Number(form.maxTurnChars),
        nodeId: form.nodeId || null,
        accent: form.accent || null,
        tools: form.tools,
    });
}

function toPayload(definition: AgentDefinition) {
    return {
        key: definition.key,
        displayName: definition.displayName,
        role: definition.role,
        systemPrompt: definition.systemPrompt,
        description: definition.description || null,
        mode: definition.mode,
        tools: definition.tools,
        style: definition.style,
        route: definition.route,
        temperature: definition.temperature,
        maxTurnChars: definition.maxTurnChars,
        nodeId: definition.nodeId,
        accent: definition.accent,
        autonomy: definition.autonomy,
    };
}

export function AgentEditor({
    persona,
    nodeIds = [],
    open,
    onClose,
    onSaved,
    seed,
}: AgentEditorProps) {
    const [form, setForm] = useState<FormState>(() => fromPersona(persona, seed));
    const [tab, setTab] = useState<"form" | "file">("form");
    const [fileText, setFileText] = useState("");
    const [fileError, setFileError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const fileInput = useRef<HTMLInputElement>(null);

    // Reopen with a different agent: start from that agent, not the last edit.
    useEffect(() => {
        if (!open) return;
        setForm(fromPersona(persona, seed));
        setTab("form");
        setError(null);
        setFileError(null);
    }, [open, persona, seed]);

    const definition = useMemo(() => toDefinition(form), [form]);
    const isNew = persona === null;
    const canSave = Boolean(
        definition.key && definition.displayName && definition.role && definition.systemPrompt
    );

    // The file view is regenerated from the form whenever it is shown, so the
    // two never drift; edits to the text are applied back explicitly.
    useEffect(() => {
        if (tab === "file") {
            setFileText(serializeAgentFile(definition));
            setFileError(null);
        }
        // Only when switching in — regenerating on every keystroke would clobber edits.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tab]);

    const applyFile = useCallback((text: string) => {
        try {
            const parsed = parseAgentFile(text);
            setForm(fromPersona(null, parsed.definition));
            setFileError(
                parsed.unknownKeys.length > 0
                    ? `Ignored keys this format does not know: ${parsed.unknownKeys.join(", ")}`
                    : null
            );
            setTab("form");
        } catch (err) {
            setFileError(err instanceof AgentFileError ? err.message : "Could not read that file");
        }
    }, []);

    const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
        setForm(prev => ({ ...prev, [key]: value }));

    const save = async () => {
        if (!canSave) return;
        setSaving(true);
        setError(null);
        try {
            const response = await fetch(
                isNew ? "/api/collab/agents" : `/api/collab/agents/${persona.dbId}`,
                {
                    method: isNew ? "POST" : "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(toPayload(definition)),
                }
            );
            const body = (await response.json().catch(() => ({}))) as {
                persona?: AgentPersonaRecord;
                error?: string;
            };
            if (!response.ok || !body.persona)
                throw new Error(body.error ?? "Could not save the agent");
            await onSaved(body.persona);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Could not save the agent");
        } finally {
            setSaving(false);
        }
    };

    const download = () => {
        const blob = new Blob([serializeAgentFile(definition)], { type: "text/markdown" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = agentFileName(definition);
        a.click();
        URL.revokeObjectURL(url);
    };

    const color = form.accent || personaColor({ id: form.key || "new" });

    return (
        <Dialog open={open} onOpenChange={next => !next && onClose()}>
            <DialogContent className="flex max-h-[90vh] w-[min(720px,calc(100vw-32px))] max-w-none flex-col gap-0 p-0">
                <DialogHeader className="border-line flex-row items-center gap-3 border-b px-5 py-4 text-left">
                    <span
                        className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-[12px] font-bold text-white"
                        style={{ background: color }}
                    >
                        {initialsOf(form.displayName || "?")}
                    </span>
                    <div className="min-w-0 flex-1">
                        <DialogTitle className="serif text-ink text-[20px]">
                            {isNew ? "New agent" : `Edit ${persona.displayName}`}
                        </DialogTitle>
                        <DialogDescription className="mt-0.5">
                            {isNew
                                ? "A name, a role, standing instructions — and what it may use."
                                : `@${persona.id}${persona.builtin ? " · starter agent" : ""}`}
                        </DialogDescription>
                    </div>
                </DialogHeader>

                <Tabs
                    value={tab}
                    onValueChange={value => setTab(value === "file" ? "file" : "form")}
                    className="flex min-h-0 flex-1 flex-col"
                >
                    <div className="border-line flex items-center gap-2 border-b px-5 py-2">
                        <TabsList>
                            <TabsTrigger value="form">Definition</TabsTrigger>
                            <TabsTrigger value="file">
                                <FileText className="size-3.5" /> File
                            </TabsTrigger>
                        </TabsList>
                        <div className="flex-1" />
                        <input
                            ref={fileInput}
                            type="file"
                            accept=".md,.markdown,text/markdown,text/plain"
                            className="hidden"
                            onChange={async event => {
                                const file = event.target.files?.[0];
                                if (file) applyFile(await file.text());
                                event.target.value = "";
                            }}
                        />
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => fileInput.current?.click()}
                        >
                            <Upload className="size-3.5" /> Import file
                        </Button>
                        <Button variant="ghost" size="sm" onClick={download} disabled={!canSave}>
                            <Download className="size-3.5" /> Export
                        </Button>
                    </div>

                    <TabsContent
                        value="form"
                        className="min-h-0 flex-1 overflow-y-auto px-5 pb-2 pt-4"
                    >
                        <div className="grid grid-cols-2 gap-x-4">
                            <Field label="Display name">
                                <TextInput
                                    value={form.displayName}
                                    onChange={e => {
                                        update("displayName", e.target.value);
                                        if (isNew && !form.key)
                                            update("key", toAgentKey(e.target.value));
                                    }}
                                    placeholder="Dana"
                                    autoFocus
                                />
                            </Field>
                            <Field
                                label="Handle"
                                hint="Written as @handle in transcripts and chat."
                            >
                                <TextInput
                                    value={form.key}
                                    onChange={e => update("key", toAgentKey(e.target.value))}
                                    placeholder="finance"
                                />
                            </Field>
                        </div>

                        <Field
                            label="Role"
                            hint="One line. Shown next to the name and injected into the prompt."
                        >
                            <TextInput
                                value={form.role}
                                onChange={e => update("role", e.target.value)}
                                placeholder="Finance partner"
                            />
                        </Field>

                        <Field
                            label="When to use it"
                            hint="One sentence. Shown in the @-menu and on the card, so a person can pick the right agent without reading the prompt."
                        >
                            <TextInput
                                value={form.description}
                                onChange={e => update("description", e.target.value)}
                                placeholder="Guards margin and cash; asks what a decision costs."
                                maxLength={240}
                            />
                        </Field>

                        <Field
                            label="Standing instructions"
                            hint="How this agent behaves everywhere it appears. Be specific about what it owns and what it should refuse to answer."
                        >
                            <TextArea
                                value={form.systemPrompt}
                                onChange={e => update("systemPrompt", e.target.value)}
                                rows={7}
                                className="font-mono text-[12.5px] leading-relaxed"
                            />
                        </Field>

                        <div className="grid grid-cols-2 gap-x-4">
                            <Field
                                label="Mode"
                                hint={
                                    isAgentMode(form.mode)
                                        ? AGENT_MODE_META[form.mode].description
                                        : ""
                                }
                            >
                                <SelectInput
                                    value={form.mode}
                                    onChange={e => update("mode", e.target.value)}
                                >
                                    {AGENT_MODES.map(mode => (
                                        <option key={mode} value={mode}>
                                            {AGENT_MODE_META[mode].label}
                                        </option>
                                    ))}
                                </SelectInput>
                            </Field>
                            <Field
                                label="Answer style"
                                hint="Applied under the instructions in chat."
                            >
                                <SelectInput
                                    value={form.style}
                                    onChange={e => update("style", e.target.value)}
                                >
                                    <option value="">Chat default</option>
                                    {AGENT_STYLE_IDS.map(style => (
                                        <option key={style} value={style}>
                                            {STYLE_LABELS[style]}
                                        </option>
                                    ))}
                                </SelectInput>
                            </Field>
                            <Field
                                label="Model route"
                                hint="Which configured route serves this agent's turns."
                            >
                                <SelectInput
                                    value={form.route}
                                    onChange={e => update("route", e.target.value)}
                                >
                                    {ROUTES.map(option => (
                                        <option key={option.value} value={option.value}>
                                            {option.label}
                                        </option>
                                    ))}
                                </SelectInput>
                            </Field>
                            <Field
                                label="Autonomy"
                                hint={
                                    isAgentAutonomy(form.autonomy)
                                        ? AGENT_AUTONOMY_META[form.autonomy].description
                                        : "Inherits the workspace default (Settings → Agents)."
                                }
                            >
                                <SelectInput
                                    value={form.autonomy}
                                    onChange={e => update("autonomy", e.target.value)}
                                >
                                    <option value="">Workspace default</option>
                                    {AGENT_AUTONOMY_LEVELS.map(level => (
                                        <option key={level} value={level}>
                                            {AGENT_AUTONOMY_META[level].label}
                                        </option>
                                    ))}
                                </SelectInput>
                            </Field>
                            <Field
                                label="Temperature"
                                hint="0 is deterministic, 2 is wild. Blank uses the model's default."
                            >
                                <TextInput
                                    type="number"
                                    min={0}
                                    max={2}
                                    step={0.1}
                                    value={form.temperature}
                                    onChange={e => update("temperature", e.target.value)}
                                    placeholder="0.4"
                                />
                            </Field>
                            <Field
                                label="Turn length cap"
                                hint="Characters per turn in meetings. Blank means no cap."
                            >
                                <TextInput
                                    type="number"
                                    min={120}
                                    max={8000}
                                    step={10}
                                    value={form.maxTurnChars}
                                    onChange={e => update("maxTurnChars", e.target.value)}
                                    placeholder="1200"
                                />
                            </Field>
                        </div>

                        <Field
                            label="Tools"
                            hint="What a chat turn with this agent may use. Everything is on unless switched off here."
                        >
                            <div className="border-line bg-panel-2 divide-line divide-y rounded-lg border">
                                {AGENT_TOOL_IDS.map(id => {
                                    const on = form.tools[id] !== false;
                                    return (
                                        <label
                                            key={id}
                                            className="flex cursor-pointer items-center gap-3 px-3 py-2.5"
                                        >
                                            <div className="min-w-0 flex-1">
                                                <div className="text-ink text-[13px] font-medium">
                                                    {AGENT_TOOL_META[id].label}
                                                </div>
                                                <div className="text-ink-3 text-[11.5px]">
                                                    {AGENT_TOOL_META[id].description}
                                                </div>
                                            </div>
                                            <Switch
                                                checked={on}
                                                onCheckedChange={checked =>
                                                    update("tools", {
                                                        ...form.tools,
                                                        [id]: checked ? undefined : false,
                                                    })
                                                }
                                                aria-label={AGENT_TOOL_META[id].label}
                                            />
                                        </label>
                                    );
                                })}
                            </div>
                        </Field>

                        <div className="grid grid-cols-2 gap-x-4">
                            <Field label="Colour" hint="Used for the avatar and the transcript.">
                                <div className="flex flex-wrap gap-1.5">
                                    {ACCENTS.map(accent => (
                                        <button
                                            key={accent}
                                            type="button"
                                            aria-label={`Colour ${accent}`}
                                            aria-pressed={form.accent === accent}
                                            onClick={() => update("accent", accent)}
                                            className={cn(
                                                "size-6 rounded-full border-2 transition-transform",
                                                form.accent === accent
                                                    ? "border-ink scale-110"
                                                    : "border-transparent hover:scale-105"
                                            )}
                                            style={{ background: accent }}
                                        />
                                    ))}
                                </div>
                            </Field>
                            <Field
                                label="Runs on node"
                                hint="Leave blank to run in this app process."
                            >
                                <TextInput
                                    value={form.nodeId}
                                    onChange={e => update("nodeId", e.target.value)}
                                    list="collab-node-ids"
                                    placeholder="gpu-box-1"
                                />
                                <datalist id="collab-node-ids">
                                    {nodeIds.map(node => (
                                        <option key={node} value={node} />
                                    ))}
                                </datalist>
                            </Field>
                        </div>

                        {fileError && (
                            <div className="bg-warn-soft text-warn mb-3 rounded-lg px-3 py-2 text-[12.5px]">
                                {fileError}
                            </div>
                        )}
                    </TabsContent>

                    <TabsContent
                        value="file"
                        className="flex min-h-0 flex-1 flex-col gap-2 px-5 pb-3 pt-4"
                    >
                        <div className="text-ink-3 text-[12px] leading-relaxed">
                            The same agent as a file: front matter for the settings, the body is the
                            instructions. Paste an agent written for OpenCode or Claude Code here
                            and press <strong>Apply</strong>; export to carry this one elsewhere.
                        </div>
                        <TextArea
                            value={fileText}
                            onChange={e => setFileText(e.target.value)}
                            spellCheck={false}
                            className="min-h-[320px] flex-1 font-mono text-[12px] leading-relaxed"
                        />
                        {fileError && (
                            <div className="bg-danger-soft text-danger rounded-lg px-3 py-2 text-[12.5px]">
                                {fileError}
                            </div>
                        )}
                        <div className="flex items-center gap-2">
                            <Badge variant="secondary">{agentFileName(definition)}</Badge>
                            <div className="flex-1" />
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setFileText(serializeAgentFile(definition))}
                            >
                                <RotateCcw className="size-3.5" /> Regenerate from form
                            </Button>
                            <Button size="sm" onClick={() => applyFile(fileText)}>
                                Apply to form
                            </Button>
                        </div>
                    </TabsContent>
                </Tabs>

                {error && (
                    <div
                        className="bg-danger-soft text-danger mx-5 mb-2 rounded-lg px-3 py-2 text-[12.5px]"
                        role="alert"
                    >
                        {error}
                    </div>
                )}

                <DialogFooter className="border-line bg-line-2 flex-row items-center border-t px-5 py-3">
                    {!isNew && persona.builtin && (
                        <span className="text-ink-3 mr-auto text-[11.5px]">
                            Starter agent — you can always restore the shipped version.
                        </span>
                    )}
                    <Button variant="ghost" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button onClick={() => void save()} disabled={!canSave || saving}>
                        {saving ? "Saving…" : isNew ? "Create agent" : "Save changes"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
