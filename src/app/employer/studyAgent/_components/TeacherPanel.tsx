"use client";
import type { Message, Document, StudyPlanItem } from "../page";
import { BookOpen, CheckCircle2, Circle, FileText, Presentation, Eye, Menu } from "lucide-react";
import { VoiceChat } from "./VoiceChat";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { AIQueryChat } from "./AIQueryChat";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

interface TeacherPanelProps {
  messages: Message[];
  studyPlan: StudyPlanItem[];
  documents: Document[];
  selectedDocument?: Document | null;
  onSendMessage: (content: string) => void;
  onEndCall?: () => void;
  onPullUpMaterial: (docId: string) => void;
  onToggleStudyItem: (itemId: string) => void;
  onToggleView?: (view: "documents" | "docs" | "whiteboard") => void;
  currentView?: "documents" | "docs" | "whiteboard";
  onToggleSidebar?: () => void;
  isDark?: boolean;
  avatarUrl?: string;
}

export function TeacherPanel({
  messages,
  studyPlan,
  documents,
  selectedDocument,
  onSendMessage,
  onEndCall,
  onPullUpMaterial,
  onToggleStudyItem,
  onToggleView,
  currentView = "docs",
  onToggleSidebar,
  isDark = false,
  avatarUrl,
}: TeacherPanelProps) {
  const completedCount = studyPlan.filter((item) => item.completed).length;
  const totalCount = studyPlan.length;

  return (
    <div className={`h-full border-l flex flex-col ${
      isDark ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
    }`}>
      {/* Header with Sidebar Toggle and View Switcher - Fixed */}
      <div className={`flex-shrink-0 flex items-center justify-between p-3 border-b ${
        isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-50'
      }`}>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleSidebar}
            className={`h-8 w-8 p-0 ${isDark ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}
          >
            <Menu className="w-4 h-4" />
          </Button>
          {onToggleView && (
            <>
              <div className={`w-px h-4 ${isDark ? 'bg-gray-700' : 'bg-gray-300'}`} />
              <div className={`flex gap-0.5 rounded-md p-0.5 ${isDark ? 'bg-gray-700' : 'bg-gray-200'}`}>
                <Button
                  variant={currentView === "documents" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => onToggleView("documents")}
                  className={`h-7 px-2 text-xs ${
                    currentView === "documents" 
                      ? "bg-purple-600 hover:bg-purple-700 text-white" 
                      : isDark ? "text-gray-300" : ""
                  }`}
                >
                  <Eye className="w-3 h-3 mr-1" />
                  View
                </Button>
                <Button
                  variant={currentView === "docs" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => onToggleView("docs")}
                  className={`h-7 px-2 text-xs ${
                    currentView === "docs" 
                      ? "bg-purple-600 hover:bg-purple-700 text-white" 
                      : isDark ? "text-gray-300" : ""
                  }`}
                >
                  <FileText className="w-3 h-3 mr-1" />
                  Edit
                </Button>
                <Button
                  variant={currentView === "whiteboard" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => onToggleView("whiteboard")}
                  className={`h-7 px-2 text-xs ${
                    currentView === "whiteboard" 
                      ? "bg-purple-600 hover:bg-purple-700 text-white" 
                      : isDark ? "text-gray-300" : ""
                  }`}
                >
                  <Presentation className="w-3 h-3 mr-1" />
                  Draw
                </Button>
              </div>
            </>
          )}
        </div>
        <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
          AI Teacher
        </span>
      </div>

      {/* Voice Call Interface - Fixed */}
      <div className="flex-shrink-0">
        <VoiceChat 
          messages={messages} 
          onSendMessage={onSendMessage} 
          onEndCall={onEndCall} 
          documents={documents}
          avatarUrl={avatarUrl}
        />
      </div>

      {/* Tabs for Study Plan and AI Query - Scrollable Container */}
      <Tabs defaultValue="plan" className="flex-1 flex flex-col min-h-0">
        <div className={`flex-shrink-0 border-b px-4 py-3 ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
          <TabsList className={`w-full grid grid-cols-2 h-9 ${isDark ? 'bg-slate-800' : ''}`}>
            <TabsTrigger value="plan">Study Plan</TabsTrigger>
            <TabsTrigger value="query">AI Query</TabsTrigger>
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
              Your personalized learning path created by your AI teacher
            </p>
          </div>

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
                      ? "bg-gray-800 border-gray-700 hover:border-purple-600"
                      : "bg-white border-gray-200 hover:border-purple-300"
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
                              className="flex items-center gap-2 text-xs text-purple-600 hover:text-purple-700 hover:underline"
                            >
                              <BookOpen className="w-3 h-3" />
                              {doc.name}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {studyPlan.length === 0 && (
            <div className={`text-center py-8 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p className="text-sm">Your teacher is preparing your study plan</p>
            </div>
          )}

          <div className={`mt-6 p-4 rounded-lg border ${
            isDark 
              ? 'bg-purple-900/20 border-purple-800' 
              : 'bg-purple-50 border-purple-200'
          }`}>
            <p className={`text-sm ${isDark ? 'text-purple-300' : 'text-purple-900'}`}>
              <strong>Tip:</strong> Click on any material to view it, or ask your teacher
              questions during your call!
            </p>
          </div>
        </TabsContent>

        {/* Chat Tab */}
        <TabsContent value="query" className="flex-1 flex flex-col mt-0 data-[state=active]:flex data-[state=inactive]:hidden">
          <AIQueryChat 
            isBuddy={false}
            isDark={isDark}
            selectedDocumentId={selectedDocument?.id}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
