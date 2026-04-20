"use client";

import { useState, useEffect, useCallback } from "react";
import { FileText, Tag, X, Plus, Edit2, Trash2 } from "lucide-react";
import type { DocumentNote } from "@launchstack/core/db/schema/document-notes";

interface NotesPanelProps {
  documentId?: string | null;
}

export function NotesPanel({ documentId }: NotesPanelProps) {
  const [notes, setNotes] = useState<DocumentNote[]>([]);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteFormData, setNoteFormData] = useState({ title: "", content: "", tags: [] as string[] });
  const [newTag, setNewTag] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  const fetchNotes = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (documentId) params.set("documentId", documentId);
      const response = await fetch(`/api/notes?${params.toString()}`);
      if (!response.ok) throw new Error("Failed to fetch notes");
      const data = (await response.json()) as { notes: DocumentNote[] };
      setNotes(data.notes);
    } catch (error) {
      console.error("Error fetching notes:", error);
    } finally {
      setIsLoading(false);
    }
  }, [documentId]);

  useEffect(() => {
    void fetchNotes();
  }, [fetchNotes]);

  const handleSave = async () => {
    if (!noteFormData.title.trim()) return;

    try {
      if (editingNoteId === "new") {
        const response = await fetch("/api/notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            documentId: documentId ?? undefined,
            title: noteFormData.title,
            content: noteFormData.content,
            tags: noteFormData.tags,
          }),
        });
        if (!response.ok) throw new Error("Failed to create note");
      } else if (editingNoteId) {
        const response = await fetch(`/api/notes/${editingNoteId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: noteFormData.title,
            content: noteFormData.content,
            tags: noteFormData.tags,
          }),
        });
        if (!response.ok) throw new Error("Failed to update note");
      }

      setEditingNoteId(null);
      setNoteFormData({ title: "", content: "", tags: [] });
      void fetchNotes();
    } catch (error) {
      console.error("Error saving note:", error);
    }
  };

  const handleDelete = async (noteId: number) => {
    if (!confirm("Delete this note?")) return;
    try {
      const response = await fetch(`/api/notes/${noteId}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Failed to delete note");
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
    } catch (error) {
      console.error("Error deleting note:", error);
    }
  };

  const handleAddTag = () => {
    if (!newTag.trim() || noteFormData.tags.includes(newTag.trim())) return;
    setNoteFormData((prev) => ({ ...prev, tags: [...prev.tags, newTag.trim()] }));
    setNewTag("");
  };

  const handleRemoveTag = (tag: string) => {
    setNoteFormData((prev) => ({ ...prev, tags: prev.tags.filter((t) => t !== tag) }));
  };

  const handleStartEdit = (note: DocumentNote) => {
    setEditingNoteId(String(note.id));
    setNoteFormData({
      title: note.title ?? "",
      content: note.content ?? "",
      tags: (note.tags ?? []) as string[],
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-5 h-5 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-border">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-semibold text-foreground">Notes</h3>
          <span className="text-[10px] font-mono font-bold bg-muted text-muted-foreground rounded px-1.5 py-0.5">
            {notes.length}
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {documentId ? "Notes for this document" : "All your notes"}
        </p>
        <button
          onClick={() => {
            setEditingNoteId("new");
            setNoteFormData({ title: "", content: "", tags: [] });
          }}
          disabled={editingNoteId !== null}
          className="mt-2 w-full flex items-center justify-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-all"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Note
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 custom-scrollbar">
        {/* Create/Edit Form */}
        {editingNoteId && (
          <div className="p-3 border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/20 rounded-lg space-y-2.5">
            <div>
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Title</label>
              <input
                value={noteFormData.title}
                onChange={(e) => setNoteFormData({ ...noteFormData, title: e.target.value })}
                placeholder="Note title..."
                className="mt-1 w-full px-2.5 py-1.5 text-xs border border-border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-purple-500"
              />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Content</label>
              <textarea
                value={noteFormData.content}
                onChange={(e) => setNoteFormData({ ...noteFormData, content: e.target.value })}
                placeholder="Write your notes..."
                className="mt-1 w-full px-2.5 py-1.5 text-xs border border-border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-purple-500 min-h-[80px] resize-none"
              />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Tags</label>
              <div className="flex items-center gap-1.5 mt-1">
                <input
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddTag();
                    }
                  }}
                  placeholder="Add tag..."
                  className="flex-1 px-2 py-1 text-xs border border-border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-purple-500"
                />
                <button
                  onClick={handleAddTag}
                  disabled={!newTag.trim()}
                  className="px-2 py-1 text-xs bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-md"
                >
                  Add
                </button>
              </div>
              {noteFormData.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {noteFormData.tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300"
                    >
                      <Tag className="w-2.5 h-2.5" />
                      {tag}
                      <button onClick={() => handleRemoveTag(tag)} className="hover:text-red-600">
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => {
                  setEditingNoteId(null);
                  setNoteFormData({ title: "", content: "", tags: [] });
                }}
                className="flex-1 px-3 py-1.5 text-xs border border-border rounded-md hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleSave()}
                disabled={!noteFormData.title.trim()}
                className="flex-1 px-3 py-1.5 text-xs bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-md transition-colors"
              >
                {editingNoteId !== "new" ? "Update" : "Save"}
              </button>
            </div>
          </div>
        )}

        {/* Notes List */}
        {notes.map((note) => (
          <div
            key={note.id}
            className="border border-border rounded-lg p-3 bg-card hover:border-purple-300 dark:hover:border-purple-700 transition-all"
          >
            <div className="flex items-start gap-2.5">
              <FileText className="w-4 h-4 text-purple-500 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <h4 className="text-xs font-semibold text-foreground">{note.title}</h4>
                {note.content && (
                  <p className="text-[11px] text-muted-foreground mt-0.5 whitespace-pre-wrap line-clamp-3">
                    {note.content}
                  </p>
                )}
                {note.tags && (note.tags as string[]).length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {(note.tags as string[]).map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400"
                      >
                        <Tag className="w-2.5 h-2.5" />
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground/60 mt-1.5">
                  {note.createdAt ? new Date(note.createdAt).toLocaleDateString() : ""}
                </p>
              </div>
              <div className="flex gap-0.5 flex-shrink-0">
                <button
                  onClick={() => handleStartEdit(note)}
                  disabled={editingNoteId !== null}
                  className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                >
                  <Edit2 className="w-3 h-3" />
                </button>
                <button
                  onClick={() => void handleDelete(note.id)}
                  className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-muted-foreground hover:text-red-600 transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          </div>
        ))}

        {notes.length === 0 && !editingNoteId && (
          <div className="text-center py-8">
            <FileText className="w-10 h-10 mx-auto mb-2 text-muted-foreground/30" />
            <p className="text-xs text-muted-foreground">No notes yet</p>
            <p className="text-[10px] text-muted-foreground/60 mt-0.5">Click &quot;Add Note&quot; to get started</p>
          </div>
        )}
      </div>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar { width: 3px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: hsl(var(--border)); border-radius: 10px; }
      `}</style>
    </div>
  );
}
