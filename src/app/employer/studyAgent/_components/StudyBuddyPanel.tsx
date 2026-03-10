"use client";
import { useState } from "react";
import type { StudyPlanItem, Note } from "../types";
import { Button } from "./ui/button";
import { BookOpen, CheckCircle2, Circle, Plus, Edit2, Trash2, Timer, FileText, Menu } from "lucide-react";
import { VoiceChat } from "./VoiceChat";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Label } from "./ui/label";
import { AIQueryChat } from "./AIQueryChat";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { PomodoroTimer } from "./PomodoroTimer";
import { NotesTab } from "./NotesTab";
import { type StudyBuddyPanelProps } from "./types/StudyBuddyPanelTypes";

export function StudyBuddyPanel({
  messages,
  studyPlan,
  documents,
  notes,
  selectedDocument,
  onSendMessage,
  onEndCall,
  onPullUpMaterial,
  onToggleStudyItem,
  onAddStudyItem,
  onEditStudyItem,
  onDeleteStudyItem,
  onAddNote,
  onUpdateNote,
  onDeleteNote,
  onToggleSidebar,
  isDark = false,
  errorMessage,
  sessionId,
  avatarUrl,
}: StudyBuddyPanelProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    materials: [] as string[],
  });

  // Note-taking state
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteFormData, setNoteFormData] = useState({
    title: "",
    content: "",
    tags: [] as string[],
  });
  const [newTag, setNewTag] = useState("");

  const completedCount = studyPlan.filter((item) => item.completed).length;
  const totalCount = studyPlan.length;

  const handleStartCreate = () => {
    setIsCreating(true);
    setFormData({ title: "", description: "", materials: [] });
  };

  const handleStartEdit = (item: StudyPlanItem) => {
    setEditingId(item.id);
    setFormData({
      title: item.title,
      description: item.description,
      materials: item.materials,
    });
  };

  const handleSave = () => {
    if (!formData.title.trim()) return;

    if (editingId) {
      onEditStudyItem(editingId, formData);
      setEditingId(null);
    } else {
      onAddStudyItem({
        ...formData,
        completed: false,
      });
      setIsCreating(false);
    }
    setFormData({ title: "", description: "", materials: [] });
  };

  const handleCancel = () => {
    setIsCreating(false);
    setEditingId(null);
    setFormData({ title: "", description: "", materials: [] });
  };

  const toggleMaterial = (docId: string) => {
    setFormData((prev) => ({
      ...prev,
      materials: prev.materials.includes(docId)
        ? prev.materials.filter((id) => id !== docId)
        : [...prev.materials, docId],
    }));
  };

  // Note-taking functions
  const handleStartNoteEdit = (note: Note) => {
    setEditingNoteId(note.id);
    setNoteFormData({
      title: note.title,
      content: note.content,
      tags: note.tags,
    });
  };

  const handleNoteSave = () => {
    if (!noteFormData.title.trim()) return;

    if (editingNoteId && editingNoteId !== "new") {
      onUpdateNote(editingNoteId, noteFormData);
    } else {
      onAddNote(noteFormData);
    }
    
    setEditingNoteId(null);
    setNoteFormData({ title: "", content: "", tags: [] });
    setNewTag("");
  };

  const handleNoteCancel = () => {
    setEditingNoteId(null);
    setNoteFormData({ title: "", content: "", tags: [] });
    setNewTag("");
  };

  const handleAddTag = () => {
    if (!newTag.trim()) return;
    setNoteFormData((prev) => ({
      ...prev,
      tags: [...prev.tags, newTag],
    }));
    setNewTag("");
  };

  const handleRemoveTag = (tag: string) => {
    setNoteFormData((prev) => ({
      ...prev,
      tags: prev.tags.filter((t) => t !== tag),
    }));
  };

  return (
    <div className={`h-full border-l flex flex-col ${
      isDark ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
    }`}>
      {/* Header with Sidebar Toggle - Fixed */}
      <div className={`flex-shrink-0 flex items-center justify-between p-3 border-b ${
        isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-50'
      }`}>
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleSidebar}
          className={`h-8 w-8 p-0 ${isDark ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}
        >
          <Menu className="w-4 h-4" />
        </Button>
        <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
          AI Study Buddy
        </span>
      </div>

      {/* Voice Call Interface - Fixed */}
      <div className="flex-shrink-0">
        <VoiceChat 
          messages={messages} 
          onSendMessage={onSendMessage} 
          onEndCall={onEndCall} 
          isBuddy 
          documents={documents} 
          avatarUrl={avatarUrl}
        />
      </div>

      {/* Tabs for Study Plan and AI Query - Scrollable Container */}
      <Tabs defaultValue="plan" className="flex-1 flex flex-col min-h-0">
        <div className={`flex-shrink-0 border-b px-4 py-3 ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
          <TabsList className={`w-full grid grid-cols-4 h-9 ${isDark ? 'bg-slate-800' : ''}`}>
            <TabsTrigger value="plan" className="text-xs">Plan</TabsTrigger>
            <TabsTrigger value="notes" className="text-xs">
              <FileText className="w-3 h-3 mr-1" />
              Notes
            </TabsTrigger>
            <TabsTrigger value="timer" className="text-xs">
              <Timer className="w-3 h-3 mr-1" />
              Timer
            </TabsTrigger>
            <TabsTrigger value="query" className="text-xs">Query</TabsTrigger>
          </TabsList>
        </div>

        {/* Study Plan Tab */}
        <TabsContent value="plan" className="flex-1 overflow-y-auto p-4 mt-0 data-[state=active]:block data-[state=inactive]:hidden">
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className={`text-lg ${isDark ? 'text-white' : 'text-gray-900'}`}>Your Study Plan</h3>
              <Badge variant="secondary">
                {completedCount}/{totalCount}
              </Badge>
            </div>
            <p className={`text-sm mb-3 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
              Customize your learning journey
            </p>
            {errorMessage && (
              <p className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-2">
                {errorMessage}
              </p>
            )}
            <Button
              onClick={handleStartCreate}
              className="w-full bg-blue-600 hover:bg-blue-700"
              disabled={isCreating || editingId !== null}
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Study Goal
            </Button>
          </div>

          {/* Create/Edit Form */}
          {(isCreating || editingId) && (
            <div className={`mb-4 p-4 border rounded-lg space-y-3 ${
              isDark 
                ? 'bg-blue-900/20 border-blue-800' 
                : 'bg-blue-50 border-blue-200'
            }`}>
              <div>
                <Label htmlFor="title" className={`text-xs ${isDark ? 'text-gray-300' : ''}`}>Goal Title</Label>
                <Input
                  id="title"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder="e.g., Master Chapter 5"
                  className={`mt-1 ${isDark ? 'bg-gray-800 border-gray-700 text-white' : ''}`}
                />
              </div>
              <div>
                <Label htmlFor="description" className={`text-xs ${isDark ? 'text-gray-300' : ''}`}>Description</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="What do you want to achieve?"
                  className={`mt-1 min-h-[60px] ${isDark ? 'bg-gray-800 border-gray-700 text-white' : ''}`}
                />
              </div>
              <div>
                <Label className={`text-xs mb-2 block ${isDark ? 'text-gray-300' : ''}`}>Related Materials (Optional)</Label>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {documents.map((doc) => (
                    <label
                      key={doc.id}
                      className={`flex items-center gap-2 text-xs cursor-pointer p-1 rounded ${
                        isDark ? 'hover:bg-gray-800' : 'hover:bg-blue-100'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={formData.materials.includes(doc.id)}
                        onChange={() => toggleMaterial(doc.id)}
                        className="rounded"
                      />
                      <span className={`truncate ${isDark ? 'text-gray-300' : ''}`}>{doc.name}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCancel}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={!formData.title.trim()}
                  className="flex-1 bg-blue-600 hover:bg-blue-700"
                >
                  {editingId ? "Update" : "Add"}
                </Button>
              </div>
            </div>
          )}

          {/* Study Plan Items */}
          <div className="space-y-3">
            {studyPlan.map((item) => (
              <div
                key={item.id}
                className={`border rounded-lg p-4 transition-all ${
                  item.completed
                    ? isDark
                      ? "bg-green-900/20 border-green-800"
                      : "bg-green-50 border-green-200"
                    : isDark
                      ? "bg-gray-800 border-gray-700 hover:border-blue-600"
                      : "bg-white border-gray-200 hover:border-blue-300"
                }`}
              >
                <div className="flex items-start gap-3">
                  <button
                    onClick={() => onToggleStudyItem(item.id)}
                    className="mt-0.5 flex-shrink-0"
                  >
                    {item.completed ? (
                      <CheckCircle2 className="w-5 h-5 text-green-600" />
                    ) : (
                      <Circle className={`w-5 h-5 ${isDark ? 'text-gray-500' : 'text-gray-400'}`} />
                    )}
                  </button>
                  <div className="flex-1 min-w-0">
                    <h4
                      className={`text-sm mb-1 ${
                        item.completed 
                          ? "line-through text-gray-500" 
                          : isDark 
                            ? "text-white" 
                            : "text-gray-900"
                      }`}
                    >
                      {item.title}
                    </h4>
                    <p className={`text-xs mb-3 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>{item.description}</p>
                    {item.materials.length > 0 && (
                      <div className="space-y-1">
                        {item.materials.map((materialId) => {
                          const doc = documents.find((d) => d.id === materialId);
                          if (!doc) return null;
                          return (
                            <button
                              key={materialId}
                              onClick={() => onPullUpMaterial(materialId)}
                              className="flex items-center gap-2 text-xs text-blue-600 hover:text-blue-700 hover:underline"
                            >
                              <BookOpen className="w-3 h-3" />
                              {doc.name}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleStartEdit(item)}
                      className="h-7 w-7 p-0"
                      disabled={isCreating || editingId !== null}
                    >
                      <Edit2 className="w-3 h-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (confirm("Delete this study goal?")) {
                          onDeleteStudyItem(item.id);
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

          {studyPlan.length === 0 && !isCreating && (
            <div className={`text-center py-8 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p className="text-sm">No study goals yet</p>
              <p className="text-xs mt-1">Create your first goal to get started!</p>
            </div>
          )}

          <div className={`mt-6 p-4 rounded-lg border ${
            isDark 
              ? 'bg-blue-900/20 border-blue-800' 
              : 'bg-blue-50 border-blue-200'
          }`}>
            <p className={`text-sm ${isDark ? 'text-blue-300' : 'text-blue-900'}`}>
              <strong>Tip:</strong> Ask your study buddy for help organizing your goals
              or breaking down complex topics!
            </p>
          </div>
        </TabsContent>

        {/* Timer Tab */}
        <TabsContent value="timer" className="flex-1 overflow-y-auto p-4 mt-0 data-[state=active]:block data-[state=inactive]:hidden">
          <div className="h-full flex flex-col">
            <div className="mb-4">
              <h3 className={`text-lg mb-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>Pomodoro Timer</h3>
              <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                Stay focused with the Pomodoro Technique
              </p>
            </div>
            
            <div className="flex-1 flex items-start justify-center pt-4">
              <PomodoroTimer isDark={isDark} sessionId={sessionId} />
            </div>
          </div>
        </TabsContent>

        {/* AI Query Tab */}
        <TabsContent value="query" className="flex-1 flex flex-col mt-0 data-[state=active]:flex data-[state=inactive]:hidden">
          <AIQueryChat 
            isBuddy={true}
            isDark={isDark}
            selectedDocumentId={selectedDocument?.id}
          />
        </TabsContent>

        {/* Notes Tab */}
        <TabsContent value="notes" className="flex-1 overflow-y-auto p-4 mt-0 data-[state=active]:block data-[state=inactive]:hidden">
          <NotesTab
            notes={notes}
            editingNoteId={editingNoteId}
            noteFormData={noteFormData}
            newTag={newTag}
            isDark={isDark}
            onEditingNoteIdChange={setEditingNoteId}
            onNoteFormDataChange={setNoteFormData}
            onNewTagChange={setNewTag}
            onAddTag={handleAddTag}
            onRemoveTag={handleRemoveTag}
            onNoteSave={handleNoteSave}
            onNoteCancel={handleNoteCancel}
            onStartNoteEdit={handleStartNoteEdit}
            onDeleteNote={onDeleteNote}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
