"use client";

import type { Note } from "../page";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Label } from "./ui/label";
import { FileText, Tag, X, Plus, Edit2, Trash2 } from "lucide-react";

interface NotesTabProps {
  notes: Note[];
  editingNoteId: string | null;
  noteFormData: { title: string; content: string; tags: string[] };
  newTag: string;
  isDark: boolean;
  onEditingNoteIdChange: (id: string | null) => void;
  onNoteFormDataChange: (data: { title: string; content: string; tags: string[] }) => void;
  onNewTagChange: (tag: string) => void;
  onAddTag: () => void;
  onRemoveTag: (tag: string) => void;
  onNoteSave: () => void;
  onNoteCancel: () => void;
  onStartNoteEdit: (note: Note) => void;
  onDeleteNote: (noteId: string) => void;
}

export function NotesTab({
  notes,
  editingNoteId,
  noteFormData,
  newTag,
  isDark,
  onEditingNoteIdChange,
  onNoteFormDataChange,
  onNewTagChange,
  onAddTag,
  onRemoveTag,
  onNoteSave,
  onNoteCancel,
  onStartNoteEdit,
  onDeleteNote,
}: NotesTabProps) {
  return (
    <div className="space-y-4">
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className={`text-lg ${isDark ? 'text-white' : 'text-gray-900'}`}>Your Notes</h3>
          <Badge variant="secondary">{notes.length} note{notes.length !== 1 ? 's' : ''}</Badge>
        </div>
        <p className={`text-sm mb-3 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
          Keep track of your thoughts and insights
        </p>
        <Button
          onClick={() => {
            onEditingNoteIdChange("new");
            onNoteFormDataChange({ title: "", content: "", tags: [] });
          }}
          className="w-full bg-blue-600 hover:bg-blue-700"
          disabled={editingNoteId !== null}
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Note
        </Button>
      </div>

      {/* Create/Edit Form */}
      {editingNoteId && (
        <div className={`mb-4 p-4 border rounded-lg space-y-3 ${
          isDark 
            ? 'bg-blue-900/20 border-blue-800' 
            : 'bg-blue-50 border-blue-200'
        }`}>
          <div>
            <Label htmlFor="noteTitle" className={`text-xs ${isDark ? 'text-gray-300' : ''}`}>Note Title</Label>
            <Input
              id="noteTitle"
              value={noteFormData.title}
              onChange={(e) => onNoteFormDataChange({ ...noteFormData, title: e.target.value })}
              placeholder="e.g., Key Concepts from Chapter 5"
              className={`mt-1 ${isDark ? 'bg-gray-800 border-gray-700 text-white' : ''}`}
            />
          </div>
          <div>
            <Label htmlFor="noteContent" className={`text-xs ${isDark ? 'text-gray-300' : ''}`}>Content</Label>
            <Textarea
              id="noteContent"
              value={noteFormData.content}
              onChange={(e) => onNoteFormDataChange({ ...noteFormData, content: e.target.value })}
              placeholder="Write your notes here..."
              className={`mt-1 min-h-[100px] ${isDark ? 'bg-gray-800 border-gray-700 text-white' : ''}`}
            />
          </div>
          <div>
            <Label className={`text-xs mb-2 block ${isDark ? 'text-gray-300' : ''}`}>Tags (Optional)</Label>
            <div className="flex items-center gap-2 mb-2">
              <Input
                value={newTag}
                onChange={(e) => onNewTagChange(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    onAddTag();
                  }
                }}
                placeholder="Add a tag..."
                className={`flex-1 h-8 ${isDark ? 'bg-gray-800 border-gray-700 text-white' : ''}`}
              />
              <Button
                size="sm"
                onClick={onAddTag}
                disabled={!newTag.trim()}
                className="bg-blue-600 hover:bg-blue-700 h-8"
              >
                Add
              </Button>
            </div>
            {noteFormData.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {noteFormData.tags.map((tag) => (
                  <span
                    key={tag}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs ${
                      isDark 
                        ? 'bg-blue-900/40 text-blue-300 border border-blue-800' 
                        : 'bg-blue-50 text-blue-700 border border-blue-200'
                    }`}
                  >
                    <Tag className="w-3 h-3" />
                    {tag}
                    <button
                      onClick={() => onRemoveTag(tag)}
                      className="hover:text-red-600"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onNoteCancel}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={onNoteSave}
              disabled={!noteFormData.title.trim()}
              className="flex-1 bg-blue-600 hover:bg-blue-700"
            >
              {editingNoteId && editingNoteId !== "new" ? "Update" : "Save"}
            </Button>
          </div>
        </div>
      )}

      {/* Notes List */}
      <div className="space-y-3">
        {notes.map((note) => (
          <div
            key={note.id}
            className={`border rounded-lg p-4 transition-all ${
              isDark
                ? "bg-slate-800 border-slate-700 hover:border-blue-500"
                : "bg-white border-gray-200 hover:border-blue-300"
            }`}
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex-shrink-0">
                <FileText className={`w-5 h-5 ${isDark ? 'text-blue-400' : 'text-blue-600'}`} />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className={`text-sm mb-1 ${isDark ? "text-white" : "text-gray-900"}`}>
                  {note.title}
                </h4>
                <p className={`text-xs mb-2 whitespace-pre-wrap ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                  {note.content}
                </p>
                {note.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {note.tags.map((tag) => (
                      <span
                        key={tag}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${
                          isDark 
                            ? 'bg-blue-900/30 text-blue-300' 
                            : 'bg-blue-50 text-blue-700'
                        }`}
                      >
                        <Tag className="w-3 h-3" />
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                <p className={`text-xs mt-2 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                  Updated {note.updatedAt.toLocaleDateString()}
                </p>
              </div>
              <div className="flex gap-1 flex-shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onStartNoteEdit(note)}
                  className="h-7 w-7 p-0"
                  disabled={editingNoteId !== null}
                >
                  <Edit2 className="w-3 h-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (confirm("Delete this note?")) {
                      onDeleteNote(note.id);
                    }
                  }}
                  className={`h-7 w-7 p-0 text-red-600 hover:text-red-700 ${isDark ? 'hover:bg-red-900/20' : 'hover:bg-red-50'}`}
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {notes.length === 0 && !editingNoteId && (
        <div className={`text-center py-8 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
          <FileText className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p className="text-sm">No notes yet</p>
          <p className="text-xs mt-1">Click &quot;Add Note&quot; to get started!</p>
        </div>
      )}
    </div>
  );
}

