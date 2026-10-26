"use client";

import { type ComponentType, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useChangeLocale } from "~/i18n/client";
import { LOCALES } from "~/i18n/locales";
import { canSeeSettingsSection } from "~/lib/settings/sections";
import { isPersonalSection, settingsSectionOfHref } from "~/lib/settings/surfaces";
import { useSettingCopier, useSettingsSearch, useSettingValue } from "~/lib/settings/useSettings";
import { Command as CommandIcon, Languages, Settings, Search as IconSearch } from "lucide-react";
import { ACTION_MENU_ICONS, type ActionMenuItem } from "~/components/ui/action-menu";
import { APP_TARGET_KIND, actionItems, listActions } from "~/lib/context-menu";
import { usableAsPrimary } from "~/lib/agents/definition";
import { AgentAvatar } from "./collab/AgentAvatar";
import type { ChatAgentOption } from "./collab/types";
import { usePermissions } from "~/lib/use-permissions";
import {
    DEMOTED_FEATURES,
    SOURCE_META,
    demotedFeatureDescription,
    demotedFeatureLabel,
    resolveStudioFeature,
    sourceTypeLabel,
    useStudioText,
    type WorkspaceSource,
} from "./types";
import { HISTORY_KIND_ICONS } from "./HistoryRail";
import {
    HISTORY_KIND_META,
    type HistoryEntry,
    historyKindLabel,
    localizedRelativeTime,
    matchesHistoryQuery,
} from "~/lib/workspace-history";
import type { IconProps } from "~/components/icons/types";
import { usePeople } from "~/lib/profile/use-people";

/** An agent's picture as a palette icon — the same avatar the chat shows. */
function AgentPaletteIcon(agent: ChatAgentOption): ComponentType<IconProps> {
    const Icon = ({ size = 14 }: IconProps) => <AgentAvatar agent={agent} size={size} />;
    Icon.displayName = `AgentPaletteIcon(${agent.id})`;
    return Icon;
}

/**
 * The palette's "Actions" group is the action registry, flattened: every
 * app-level verb the context menu offers on empty space is here too, and a
 * submenu (Theme) becomes one row per choice. That is the rule that keeps
 * right-click honest — nothing lives in a context menu alone.
 */
function registryPaletteItems(
    onClose: () => void,
    t: ReturnType<typeof useTranslations<"workspace.commandPalette">>
): PaletteItem[] {
    const ctx = {
        x: 0,
        y: 0,
        via: "keyboard" as const,
        chain: [{ kind: APP_TARGET_KIND }],
        selection: null,
        element: null,
    };
    const actions = listActions().filter(action => action.palette !== false);
    const rows: PaletteItem[] = [];
    const push = (item: ActionMenuItem, prefix?: string) => {
        if (item.type === "submenu") {
            item.items.forEach(child => push(child, item.label));
            return;
        }
        if (item.type !== "item" || item.disabled) return;
        const Icon = item.icon ? ACTION_MENU_ICONS[item.icon] : CommandIcon;
        rows.push({
            kind: "action",
            id: `registry:${item.id}`,
            label: prefix ? t("submenuItem", { menu: prefix, item: item.label }) : item.label,
            sub: item.shortcut ? t("actionWithShortcut", { shortcut: item.shortcut }) : t("action"),
            Icon: Icon as unknown as ComponentType<IconProps>,
            onRun: () => {
                onClose();
                item.onSelect();
            },
        });
    };
    actionItems(ctx.chain[0]!, ctx, actions).forEach(item => push(item));
    return rows;
}

export interface CommandPaletteProps {
    open: boolean;
    onClose: () => void;
    sources: WorkspaceSource[];
    onPickSource: (id: string) => void;
    /** The roster; each agent becomes two rows — ask it, or open it. */
    agents?: ChatAgentOption[];
    /** Picks the agent in the chat composer and shows the chat. */
    onAskAgent?: (agentKey: string) => void;
    /** Opens the Agents app. */
    onOpenAgent?: (agentKey: string) => void;
    /** If provided, feature rows open Studio with this id instead of hard-navigating. */
    onPickFeature?: (featureId: string) => void;
    /** Opens Settings on the row for this registry key. */
    onPickSetting?: (key: string) => void;
    /**
     * Past chats and runs. ⌘K is where you jump to anything, and a past
     * conversation was the one thing it could not reach — only the sidebar's
     * History tab could. Picking one reopens it as the History tab would.
     */
    history?: HistoryEntry[];
    onPickHistory?: (entry: HistoryEntry) => void;
}

/** History rows shown before anything is typed: the latest few, not the whole feed. */
const RECENT_HISTORY = 5;
/** And at most this many matches once something is. */
const MATCHED_HISTORY = 20;

interface PaletteItem {
    kind: "action" | "feature" | "source" | "history" | "setting" | "agent";
    id: string;
    label: string;
    sub?: string;
    /** Matched by the search but never shown — a mindmap's node labels. */
    keywords?: string;
    Icon: ComponentType<IconProps>;
    onRun: () => void;
}

export function CommandPalette({
    open,
    onClose,
    sources,
    onPickSource,
    agents = [],
    onAskAgent,
    onOpenAgent,
    onPickFeature,
    onPickSetting,
    history,
    onPickHistory,
}: CommandPaletteProps) {
    const router = useRouter();
    const t = useTranslations("workspace.commandPalette");
    // Settings rows in the reader's language, found by either language.
    const searchSettings = useSettingsSearch();
    const settingCopy = useSettingCopier();
    const studio = useStudioText();
    const tSourceTypes = useTranslations("sources.sourceTypes");
    const th = useTranslations("workspace.history");
    const locale = useLocale();
    const { changeLocale } = useChangeLocale();
    const [q, setQ] = useState("");
    // The one lab that only surfaces a palette entry: hidden until it is on.
    const predictiveGaps = useSettingValue<boolean>("labs.predictiveGaps");
    const { can } = usePermissions();
    const [idx, setIdx] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (open) {
            setQ("");
            setIdx(0);
            setTimeout(() => inputRef.current?.focus(), 40);
        }
    }, [open]);

    const navigate = useCallback(
        (href: string) => {
            router.push(href);
        },
        [router]
    );

    // Chats shared with you say whose they are (ADR-014); names resolve lazily.
    const sharerIds = useMemo(
        () =>
            (history ?? []).map(entry => entry.sharedBy).filter((id): id is string => Boolean(id)),
        [history]
    );
    const people = usePeople(sharerIds);

    const items = useMemo<PaletteItem[]>(() => {
        // The registry is read when the palette opens, so it reflects what is
        // mounted right now; `open` is in the deps for that reason.
        const base: PaletteItem[] = open ? registryPaletteItems(onClose, t) : [];
        // One row per language, named in its own language so someone who
        // cannot read the current one still finds theirs. Found by "language"
        // and "语言" whatever the interface is in, and by either name.
        for (const option of LOCALES) {
            base.push({
                kind: "action",
                id: `language:${option.code}`,
                label: t("language", { language: option.nativeName }),
                sub: option.code === locale ? t("languageCurrent") : t("languageSwitch"),
                keywords: `language 语言 ${option.englishName} ${option.nativeName} ${option.code}`,
                Icon: Languages as unknown as ComponentType<IconProps>,
                onRun: () => changeLocale(option.code),
            });
        }
        DEMOTED_FEATURES.filter(f => f.id !== "audit" || predictiveGaps)
            // A row for an app the person may not open (Team, for a Guest)
            // would do nothing when picked. Anyone may open Settings and the
            // Workspace tab, so a row for one of their screens ("Agents &
            // nodes") carries that screen's gate instead: picked without it,
            // the row would land on a screen that only says it isn't theirs.
            .filter(f => {
                if (!can(f.requires)) return false;
                const app = resolveStudioFeature(f.id);
                if (app) return can(app.requires);
                const section = settingsSectionOfHref(f.href);
                return section ? canSeeSettingsSection(section, can) : true;
            })
            .forEach(f =>
                base.push({
                    kind: "feature",
                    id: f.id,
                    label: demotedFeatureLabel(studio, f),
                    sub: demotedFeatureDescription(studio, f),
                    // The English name still finds it in any language, and so
                    // does its id ("byok").
                    keywords: `${f.id} ${f.label} ${f.desc}`,
                    Icon: f.Icon,
                    onRun: () => {
                        if (onPickFeature) onPickFeature(f.id);
                        else navigate(f.href);
                    },
                })
            );
        // Agents are searched by name, handle, role and what they are for, so
        // "margin" finds Dana and "pushback" finds Vera.
        agents.forEach(agent => {
            const keywords = `@${agent.id} ${agent.role} ${agent.description}`;
            if (onAskAgent && usableAsPrimary(agent)) {
                base.push({
                    kind: "agent",
                    id: `ask:${agent.id}`,
                    label: t("askAgent", { name: agent.displayName }),
                    sub: `${agent.role} · ${agent.description || `@${agent.id}`}`,
                    keywords,
                    Icon: AgentPaletteIcon(agent),
                    onRun: () => onAskAgent(agent.id),
                });
            }
            if (onOpenAgent) {
                base.push({
                    kind: "agent",
                    id: `open:${agent.id}`,
                    label: t("openAgent", { name: agent.displayName }),
                    sub: t("openAgentSub", { handle: agent.id }),
                    keywords,
                    Icon: AgentPaletteIcon(agent),
                    onRun: () => onOpenAgent(agent.id),
                });
            }
        });
        sources.forEach(s => {
            const type = SOURCE_META[s.type] ? s.type : "doc";
            const meta = SOURCE_META[type];
            base.push({
                kind: "source",
                id: s.id,
                label: s.title,
                sub: `${sourceTypeLabel(tSourceTypes, type)} · ${s.size || s.added}`,
                keywords: s.searchText,
                Icon: meta.Icon,
                onRun: () => onPickSource(s.id),
            });
        });
        const historyItem = (entry: HistoryEntry): PaletteItem => {
            const meta = HISTORY_KIND_META[entry.kind];
            const sharer = entry.sharedBy ? people[entry.sharedBy]?.displayName : undefined;
            const time = localizedRelativeTime(th, locale, entry.at);
            return {
                kind: "history",
                id: entry.id,
                label: entry.title,
                sub: entry.sharedBy
                    ? t("sharedBy", { name: sharer ?? t("aTeammate"), time })
                    : `${historyKindLabel(th, entry.kind)} · ${time}`,
                Icon: HISTORY_KIND_ICONS[meta.icon],
                onRun: () => onPickHistory?.(entry),
            };
        };
        // Only what can be reopened: a run with no surface has nowhere to go.
        const reachable = onPickHistory
            ? (history ?? []).filter(entry => HISTORY_KIND_META[entry.kind].resumable || entry.href)
            : [];
        const qq = q.toLowerCase().trim();
        // Rows run in the order the groups are drawn — actions, features,
        // sources, history, settings — because Enter picks by position.
        if (!qq) return [...base, ...reachable.slice(0, RECENT_HISTORY).map(historyItem)];
        const matched = base.filter(
            i =>
                i.label.toLowerCase().includes(qq) ||
                (i.sub ?? "").toLowerCase().includes(qq) ||
                (i.keywords ?? "").toLowerCase().includes(qq)
        );
        matched.push(
            ...reachable
                .filter(entry => matchesHistoryQuery(entry, qq, historyKindLabel(th, entry.kind)))
                .slice(0, MATCHED_HISTORY)
                .map(historyItem)
        );
        // Settings are searched by what people call them, so "dark mode"
        // finds the theme row even though no label says it. Only rows in a
        // section the person may see: one they may only read still answers
        // "where is that set, and to what?". Every match is ranked before
        // any is dropped, so a Member's six are their best six.
        const visibleSettings = searchSettings(qq, Infinity)
            .filter(definition => canSeeSettingsSection(definition.section, can))
            .slice(0, 6);
        for (const definition of visibleSettings) {
            const copy = settingCopy(definition);
            matched.push({
                kind: "setting",
                id: definition.key,
                label: copy.label,
                // Where picking it goes: Settings, or the Workspace tab.
                sub: t(
                    isPersonalSection(definition.section) ? "settingSub" : "workspaceSettingSub",
                    {
                        description: copy.description,
                    }
                ),
                Icon: Settings,
                onRun: () => {
                    if (onPickSetting) onPickSetting(definition.key);
                    else navigate(`/employer/settings#${definition.key}`);
                },
            });
        }
        return matched;
    }, [
        q,
        open,
        onClose,
        sources,
        onPickSource,
        agents,
        onAskAgent,
        onOpenAgent,
        onPickFeature,
        onPickSetting,
        history,
        onPickHistory,
        navigate,
        predictiveGaps,
        people,
        can,
        t,
        studio,
        tSourceTypes,
        th,
        locale,
        changeLocale,
        searchSettings,
        settingCopy,
    ]);

    useEffect(() => {
        if (idx >= items.length) setIdx(0);
    }, [items, idx]);

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
            else if (e.key === "ArrowDown") {
                e.preventDefault();
                setIdx(i => Math.min(i + 1, items.length - 1));
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIdx(i => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
                e.preventDefault();
                const it = items[idx];
                if (it) {
                    it.onRun();
                    onClose();
                }
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, items, idx, onClose]);

    if (!open) return null;

    const groups = {
        action: { label: t("groups.action"), items: items.filter(i => i.kind === "action") },
        feature: { label: t("groups.feature"), items: items.filter(i => i.kind === "feature") },
        agent: { label: t("groups.agent"), items: items.filter(i => i.kind === "agent") },
        source: { label: t("groups.source"), items: items.filter(i => i.kind === "source") },
        history: { label: t("groups.history"), items: items.filter(i => i.kind === "history") },
        setting: { label: t("groups.setting"), items: items.filter(i => i.kind === "setting") },
    } as const;

    let counter = -1;
    return (
        <div
            onClick={onClose}
            style={{
                position: "fixed",
                inset: 0,
                zIndex: 120,
                background: "var(--scrim)",
                backdropFilter: "blur(4px)",
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "center",
                paddingTop: "12vh",
                animation: "lsw-fadeIn 140ms",
            }}
        >
            <div
                onClick={e => e.stopPropagation()}
                style={{
                    width: 620,
                    maxWidth: "92vw",
                    background: "var(--panel)",
                    borderRadius: 14,
                    boxShadow: "0 30px 80px var(--scrim-shadow), 0 0 0 1px var(--line)",
                    overflow: "hidden",
                    animation: "lsw-modalIn 180ms",
                }}
            >
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "14px 18px",
                        borderBottom: "1px solid var(--line)",
                    }}
                >
                    <IconSearch size={14} />
                    <input
                        ref={inputRef}
                        value={q}
                        onChange={e => {
                            setQ(e.target.value);
                            setIdx(0);
                        }}
                        placeholder={t("placeholder")}
                        style={{
                            flex: 1,
                            border: "none",
                            outline: "none",
                            background: "transparent",
                            fontSize: 15,
                            color: "var(--ink)",
                        }}
                    />
                    <span
                        className="mono"
                        style={{
                            fontSize: 10,
                            color: "var(--ink-3)",
                            padding: "2px 6px",
                            border: "1px solid var(--line)",
                            borderRadius: 4,
                        }}
                    >
                        ESC
                    </span>
                </div>
                <div style={{ maxHeight: 420, overflowY: "auto", padding: "6px 0" }}>
                    {Object.entries(groups).map(([k, g]) =>
                        g.items.length === 0 ? null : (
                            <div key={k}>
                                <div
                                    className="mono"
                                    style={{
                                        fontSize: 10,
                                        fontWeight: 600,
                                        letterSpacing: "0.08em",
                                        color: "var(--ink-3)",
                                        textTransform: "uppercase",
                                        padding: "10px 18px 4px",
                                    }}
                                >
                                    {g.label}
                                </div>
                                {g.items.map(it => {
                                    counter += 1;
                                    const active = counter === idx;
                                    const Icon = it.Icon;
                                    const itemIdx = items.indexOf(it);
                                    return (
                                        <div
                                            key={it.id + k}
                                            onMouseEnter={() => setIdx(itemIdx)}
                                            onClick={() => {
                                                it.onRun();
                                                onClose();
                                            }}
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: 12,
                                                padding: "8px 18px",
                                                cursor: "pointer",
                                                background: active
                                                    ? "var(--accent-soft)"
                                                    : "transparent",
                                            }}
                                        >
                                            <div
                                                style={{
                                                    width: 24,
                                                    height: 24,
                                                    borderRadius: 6,
                                                    background: active
                                                        ? "var(--panel)"
                                                        : "var(--line-2)",
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent: "center",
                                                    color: active
                                                        ? "var(--accent)"
                                                        : "var(--ink-2)",
                                                }}
                                            >
                                                <Icon size={13} />
                                            </div>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div
                                                    style={{
                                                        fontSize: 13,
                                                        fontWeight: 500,
                                                        color: active
                                                            ? "var(--accent-ink)"
                                                            : "var(--ink)",
                                                        whiteSpace: "nowrap",
                                                        overflow: "hidden",
                                                        textOverflow: "ellipsis",
                                                    }}
                                                >
                                                    {it.label}
                                                </div>
                                                <div
                                                    style={{
                                                        fontSize: 11,
                                                        color: "var(--ink-3)",
                                                        whiteSpace: "nowrap",
                                                        overflow: "hidden",
                                                        textOverflow: "ellipsis",
                                                    }}
                                                >
                                                    {it.sub}
                                                </div>
                                            </div>
                                            {active && (
                                                <span
                                                    className="mono"
                                                    style={{
                                                        fontSize: 10,
                                                        color: "var(--accent)",
                                                        padding: "2px 6px",
                                                        border: "1px solid var(--accent)",
                                                        borderRadius: 4,
                                                    }}
                                                >
                                                    ↵
                                                </span>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )
                    )}
                    {items.length === 0 && (
                        <div
                            style={{
                                padding: "30px 18px",
                                textAlign: "center",
                                color: "var(--ink-3)",
                                fontSize: 13,
                            }}
                        >
                            {t.rich("noMatches", {
                                query: q,
                                mono: chunks => <span className="mono">{chunks}</span>,
                            })}
                        </div>
                    )}
                </div>
                <div
                    style={{
                        padding: "9px 18px",
                        borderTop: "1px solid var(--line)",
                        display: "flex",
                        gap: 14,
                        fontSize: 10,
                        color: "var(--ink-3)",
                    }}
                    className="mono"
                >
                    <span>
                        <span
                            style={{
                                padding: "1px 5px",
                                border: "1px solid var(--line)",
                                borderRadius: 4,
                            }}
                        >
                            ↑↓
                        </span>{" "}
                        {t("navigate")}
                    </span>
                    <span>
                        <span
                            style={{
                                padding: "1px 5px",
                                border: "1px solid var(--line)",
                                borderRadius: 4,
                            }}
                        >
                            ↵
                        </span>{" "}
                        {t("open")}
                    </span>
                    <span style={{ marginLeft: "auto" }}>
                        {t("results", { count: items.length })}
                    </span>
                </div>
            </div>
        </div>
    );
}
