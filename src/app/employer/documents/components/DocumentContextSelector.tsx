"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Building2,
  FileText,
  Search,
  ChevronDown,
  ChevronRight,
  X,
} from "lucide-react";
import { Input } from "~/app/employer/documents/components/ui/input";
import { Checkbox } from "~/app/employer/documents/components/ui/checkbox";
import { cn } from "~/lib/utils";
import { DISPLAY_TYPE_ICONS } from "./DocumentViewer";
import { getDocumentDisplayType } from "../types/document";
import type { DocumentType } from "../types";

export interface DocumentContextSelectorProps {
  documents: DocumentType[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  compact?: boolean;
}

export function DocumentContextSelector({
  documents,
  selectedIds,
  onChange,
}: DocumentContextSelectorProps) {
  const [search, setSearch] = useState("");
  const [isExpanded, setIsExpanded] = useState(true);

  const processed = useMemo(
    () => documents.filter((d) => d.ocrProcessed !== false),
    [documents],
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return processed;
    const q = search.toLowerCase();
    return processed.filter(
      (d) =>
        d.title.toLowerCase().includes(q) ||
        d.category.toLowerCase().includes(q),
    );
  }, [processed, search]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allSelected = selectedIds.length === 0;

  const toggle = useCallback(
    (id: number) => {
      if (allSelected) {
        const allExcept = processed.filter((d) => d.id !== id).map((d) => d.id);
        onChange(allExcept);
      } else if (selectedSet.has(id)) {
        const next = selectedIds.filter((x) => x !== id);
        if (next.length === 0 || next.length === processed.length) {
          onChange([]);
        } else {
          onChange(next);
        }
      } else {
        const next = [...selectedIds, id];
        if (next.length === processed.length) {
          onChange([]);
        } else {
          onChange(next);
        }
      }
    },
    [allSelected, selectedIds, selectedSet, processed, onChange],
  );

  const resetAll = useCallback(() => onChange([]), [onChange]);

  const selectedCount = allSelected ? processed.length : selectedIds.length;

  return (
    <div className="space-y-1">
      {/* Header — collapsible */}
      <button
        onClick={() => setIsExpanded((v) => !v)}
        className="w-full flex items-center gap-1.5 px-1 py-1 hover:bg-muted/50 rounded-md transition-colors"
      >
        {isExpanded ? (
          <ChevronDown className="w-2.5 h-2.5 text-purple-500 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-2.5 h-2.5 flex-shrink-0 text-muted-foreground" />
        )}
        <span className="text-[9px] font-black text-muted-foreground tracking-[0.15em] uppercase">
          Sources
        </span>
        <span className="text-[9px] font-mono font-bold bg-muted text-muted-foreground rounded px-1 py-0.5 ml-auto">
          {selectedCount}/{processed.length}
        </span>
      </button>

      {isExpanded && (
        <div className="space-y-0.5">
          {/* Company Knowledge — always on */}
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-emerald-50/60 dark:bg-emerald-900/15">
            <div className="w-3.5 h-3.5 rounded-sm bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
              <Building2 className="w-2.5 h-2.5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-300 flex-1">
              Company Context
            </span>
            <span className="text-[9px] text-emerald-600/60 dark:text-emerald-400/60 font-medium">
              Always on
            </span>
          </div>

          {/* Search (only for many docs) */}
          {processed.length > 8 && (
            <div className="relative px-0.5 pt-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 mt-0.5 w-3 h-3 text-muted-foreground" />
              <Input
                placeholder="Filter documents..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-6 pl-7 text-[10px] bg-muted/50 border-none focus-visible:ring-1 focus-visible:ring-purple-500 rounded-md"
              />
            </div>
          )}

          {/* Document rows */}
          <div className="space-y-0.5 max-h-[200px] overflow-y-auto custom-scrollbar">
            {filtered.map((doc) => {
              const isChecked = allSelected || selectedSet.has(doc.id);
              const displayType = getDocumentDisplayType(doc);
              const DocIcon = DISPLAY_TYPE_ICONS[displayType] ?? FileText;

              return (
                <div
                  key={doc.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => toggle(doc.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggle(doc.id);
                    }
                  }}
                  className={cn(
                    "flex items-center gap-2 px-2 py-1.5 rounded-md text-[11px] transition-all cursor-pointer group",
                    isChecked
                      ? "text-foreground"
                      : "text-muted-foreground/50 hover:text-muted-foreground",
                  )}
                >
                  <Checkbox
                    checked={isChecked}
                    onCheckedChange={() => toggle(doc.id)}
                    className="flex-shrink-0 h-3.5 w-3.5"
                    aria-label={`Include ${doc.title} as context`}
                  />
                  <DocIcon
                    className={cn(
                      "w-3 h-3 flex-shrink-0 transition-colors",
                      isChecked
                        ? "text-purple-500"
                        : "text-muted-foreground/40",
                    )}
                  />
                  <span className={cn(
                    "flex-1 truncate transition-colors",
                    !isChecked && "line-through decoration-muted-foreground/30",
                  )}>
                    {doc.title}
                  </span>
                </div>
              );
            })}

            {filtered.length === 0 && search && (
              <div className="py-3 text-center text-[10px] text-muted-foreground">
                No match for &quot;{search}&quot;
              </div>
            )}
          </div>

          {/* Footer — reset when filtered */}
          {!allSelected && (
            <div className="flex items-center justify-between px-2 pt-1">
              <span className="text-[9px] text-muted-foreground">
                {selectedIds.length} of {processed.length} selected
              </span>
              <button
                onClick={resetAll}
                className="text-[9px] text-purple-600 dark:text-purple-400 font-semibold hover:underline flex items-center gap-0.5"
              >
                <X className="w-2.5 h-2.5" />
                Use all
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
