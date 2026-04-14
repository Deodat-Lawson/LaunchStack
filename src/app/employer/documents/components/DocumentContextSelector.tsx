"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Building2,
  FileText,
  Search,
  X,
  ListFilter,
  Check,
} from "lucide-react";
import { Input } from "~/app/employer/documents/components/ui/input";
import { Checkbox } from "~/app/employer/documents/components/ui/checkbox";
import { Button } from "~/app/employer/documents/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "~/app/employer/documents/components/ui/dialog";
import { cn } from "~/lib/utils";
import { DISPLAY_TYPE_ICONS } from "./DocumentViewer";
import { getDocumentDisplayType } from "../types/document";
import type { DocumentType } from "../types";

export interface DocumentContextSelectorProps {
  documents: DocumentType[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
}

export function DocumentContextSelector({
  documents,
  selectedIds,
  onChange,
}: DocumentContextSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

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
        onChange(next.length === 0 || next.length === processed.length ? [] : next);
      } else {
        const next = [...selectedIds, id];
        onChange(next.length === processed.length ? [] : next);
      }
    },
    [allSelected, selectedIds, selectedSet, processed, onChange],
  );

  const resetAll = useCallback(() => onChange([]), [onChange]);

  const selectedCount = allSelected ? processed.length : selectedIds.length;

  return (
    <>
      {/* Trigger button */}
      <button
        onClick={() => setOpen(true)}
        className={cn(
          "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-medium transition-all duration-150",
          "text-muted-foreground hover:bg-muted hover:text-foreground",
          !allSelected && "text-purple-600 dark:text-purple-400",
        )}
      >
        <ListFilter className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="flex-1 text-left">Sources</span>
        <span
          className={cn(
            "text-[9px] font-mono font-bold px-1.5 py-0.5 rounded",
            allSelected
              ? "bg-muted text-muted-foreground"
              : "bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300",
          )}
        >
          {selectedCount}/{processed.length}
        </span>
      </button>

      {/* Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md max-h-[80vh] flex flex-col gap-0 p-0 overflow-hidden">
          <DialogHeader className="px-5 pt-5 pb-3 border-b border-border space-y-1">
            <DialogTitle className="text-base">Knowledge sources</DialogTitle>
            <DialogDescription className="text-xs">
              Choose which indexed files are eligible for retrieval. When you narrow the list, Q&amp;A and search
              only pull text from those files—not from every upload. The row below is your company profile (name,
              industry, etc.); it is not a substitute for the text inside your selected files.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col flex-1 overflow-hidden">
            {/* Company Context — always on */}
            <div className="flex items-center gap-3 px-5 py-3 bg-emerald-50/60 dark:bg-emerald-900/10 border-b border-border">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
                <Building2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                  Company profile (directory)
                </div>
                <div className="text-[11px] text-emerald-600/70 dark:text-emerald-400/60">
                  Basic org fields — separate from file contents above
                </div>
              </div>
              <div className="flex items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-full">
                <Check className="w-3 h-3" />
                Always on
              </div>
            </div>

            {/* Search */}
            {processed.length > 5 && (
              <div className="relative px-5 py-3 border-b border-border">
                <Search className="absolute left-8 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search documents..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 pl-8 text-xs bg-muted/50 border-none focus-visible:ring-1 focus-visible:ring-purple-500 rounded-lg"
                />
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    className="absolute right-8 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            )}

            {/* Document list */}
            <div className="flex-1 overflow-y-auto px-2 py-2">
              {filtered.length === 0 && search ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No documents matching &quot;{search}&quot;
                </div>
              ) : (
                <div className="space-y-0.5">
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
                          "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all cursor-pointer group",
                          isChecked
                            ? "bg-purple-50/60 dark:bg-purple-900/10 hover:bg-purple-50 dark:hover:bg-purple-900/15"
                            : "hover:bg-muted/50",
                        )}
                      >
                        <Checkbox
                          checked={isChecked}
                          onCheckedChange={() => toggle(doc.id)}
                          className="flex-shrink-0 h-4 w-4"
                          aria-label={`Include ${doc.title} as context`}
                        />
                        <DocIcon
                          className={cn(
                            "w-4 h-4 flex-shrink-0 transition-colors",
                            isChecked
                              ? "text-purple-500"
                              : "text-muted-foreground/40",
                          )}
                        />
                        <div className="flex-1 min-w-0">
                          <div
                            className={cn(
                              "text-sm truncate transition-colors",
                              isChecked
                                ? "text-foreground font-medium"
                                : "text-muted-foreground line-through decoration-muted-foreground/30",
                            )}
                          >
                            {doc.title}
                          </div>
                          <div className="text-[10px] text-muted-foreground truncate">
                            {doc.category}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <DialogFooter className="px-5 py-3 border-t border-border bg-muted/30 sm:justify-between">
            <div className="text-xs text-muted-foreground">
              {allSelected
                ? `All ${processed.length} documents selected`
                : `${selectedIds.length} of ${processed.length} selected`}
            </div>
            <div className="flex items-center gap-2">
              {!allSelected && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={resetAll}
                  className="h-7 text-xs text-purple-600 dark:text-purple-400 hover:text-purple-700"
                >
                  <X className="w-3 h-3 mr-1" />
                  Reset to all
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => setOpen(false)}
                className="h-7 text-xs bg-purple-600 hover:bg-purple-700 text-white"
              >
                Done
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
