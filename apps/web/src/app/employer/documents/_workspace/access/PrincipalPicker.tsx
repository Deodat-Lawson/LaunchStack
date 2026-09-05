"use client";

/**
 * Search-and-pick for people, groups, and roles. Results render in flow
 * under the input (no floating layer), grouped, with anything already
 * granted left out.
 */

import React, { useEffect, useId, useState } from "react";
import { Search, ShieldCheck, User, Users } from "lucide-react";

import { Input } from "~/components/ui/input";
import type { PrincipalType } from "~/lib/authz/permissions";
import { errorMessage, peopleApi, type Principals } from "../settings/people/api";

export interface PickedPrincipal {
    principalType: PrincipalType;
    principalId: string;
    principalName: string;
}

export function principalKey(type: PrincipalType, id: string): string {
    return `${type}:${id}`;
}

export function PrincipalPicker({
    exclude,
    disabled = false,
    onPick,
}: {
    /** `principalKey(type, id)` for everyone already in the list. */
    exclude: ReadonlySet<string>;
    disabled?: boolean;
    onPick: (principal: PickedPrincipal) => void;
}) {
    const [query, setQuery] = useState("");
    const [focused, setFocused] = useState(false);
    const [results, setResults] = useState<Principals | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const listId = useId();

    const active = focused || query.trim().length > 0;

    useEffect(() => {
        if (!active || disabled) return;
        let cancelled = false;
        setLoading(true);
        const timer = setTimeout(() => {
            void (async () => {
                try {
                    const res = await peopleApi.access.principals(query.trim());
                    if (cancelled) return;
                    setResults(res);
                    setError(null);
                } catch (err) {
                    if (!cancelled) setError(errorMessage(err, "Search didn't work."));
                } finally {
                    if (!cancelled) setLoading(false);
                }
            })();
        }, 180);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [query, active, disabled]);

    const pick = (principal: PickedPrincipal) => {
        onPick(principal);
        setQuery("");
    };

    const groups: { label: string; Icon: typeof User; items: PickedPrincipal[] }[] = results
        ? [
              {
                  label: "People",
                  Icon: User,
                  items: results.users.map(u => ({
                      principalType: "user" as const,
                      principalId: String(u.id),
                      principalName: u.name || u.email,
                  })),
              },
              {
                  label: "Groups",
                  Icon: Users,
                  items: results.groups.map(g => ({
                      principalType: "group" as const,
                      principalId: String(g.id),
                      principalName: g.name,
                  })),
              },
              {
                  label: "Roles",
                  Icon: ShieldCheck,
                  items: results.roles.map(r => ({
                      principalType: "role" as const,
                      principalId: r.slug,
                      principalName: r.name,
                  })),
              },
          ]
              .map(g => ({
                  ...g,
                  items: g.items.filter(
                      p => !exclude.has(principalKey(p.principalType, p.principalId))
                  ),
              }))
              .filter(g => g.items.length > 0)
        : [];

    const emailFor = (p: PickedPrincipal): string | null => {
        if (p.principalType !== "user" || !results) return null;
        const user = results.users.find(u => String(u.id) === p.principalId);
        return user && user.email !== p.principalName ? user.email : null;
    };

    return (
        <div>
            <div className="relative">
                <Search className="text-ink-3 pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2" />
                <Input
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    disabled={disabled}
                    placeholder="Add a person, group, or role…"
                    aria-label="Add a person, group, or role"
                    aria-controls={listId}
                    aria-expanded={active && !disabled}
                    className="pl-8"
                    autoComplete="off"
                />
            </div>
            {active && !disabled && (
                <div
                    id={listId}
                    role="listbox"
                    aria-label="Matches"
                    className="border-line bg-panel mt-1.5 max-h-56 overflow-y-auto rounded-lg border"
                    // Keep the list open while a click lands on it.
                    onMouseDown={e => e.preventDefault()}
                >
                    {error ? (
                        <div className="text-danger px-3 py-2 text-[12.5px]">{error}</div>
                    ) : loading && !results ? (
                        <div className="text-ink-3 px-3 py-2 text-[12.5px]">Searching…</div>
                    ) : groups.length === 0 ? (
                        <div className="text-ink-3 px-3 py-2 text-[12.5px]">
                            {query.trim() ? "No one matches." : "Type a name, group, or role."}
                        </div>
                    ) : (
                        groups.map(group => (
                            <div key={group.label}>
                                <div className="mono text-ink-3 px-3 pb-0.5 pt-2 text-[10px] font-bold uppercase tracking-[0.08em]">
                                    {group.label}
                                </div>
                                {group.items.map(p => (
                                    <button
                                        key={principalKey(p.principalType, p.principalId)}
                                        type="button"
                                        role="option"
                                        aria-selected={false}
                                        onClick={() => pick(p)}
                                        className="text-ink hover:bg-brand-soft hover:text-brand-ink focus-visible:bg-brand-soft flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] outline-none"
                                    >
                                        <group.Icon className="text-ink-3 h-3.5 w-3.5 shrink-0" />
                                        <span className="truncate">{p.principalName}</span>
                                        {emailFor(p) && (
                                            <span className="text-ink-3 truncate text-[12px]">
                                                {emailFor(p)}
                                            </span>
                                        )}
                                    </button>
                                ))}
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    );
}
