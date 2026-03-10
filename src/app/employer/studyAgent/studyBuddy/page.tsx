"use client";
import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Sidebar } from "../_components/Sidebar";
import { DocumentViewer } from "../_components/DocumentViewer";
import { StudyBuddyPanel } from "../_components/StudyBuddyPanel";
import { ConnectingScreen } from "../_components/ConnectingScreen";
import { ResizablePanel } from "../_components/ResizablePanel";
import { Toaster } from "../_components/ui/sonner";
import type { Message, Document, StudyPlanItem, Note, UserPreferences } from "../types";

interface ServerNote {
  id?: string | number;
  title?: string;
  content?: string;
  tags?: string[];
  createdAt?: string | number | Date;
  updatedAt?: string | number | Date;
}

interface ServerMessage {
  id?: string | number;
  originalId?: string;
  role?: string;
  content?: string;
  ttsContent?: string;
  attachedDocument?: string;
  attachedDocumentId?: string;
  attachedDocumentUrl?: string;
  isVoice?: boolean;
  createdAt?: string | number | Date;
}

interface ServerGoal {
  id?: string | number;
  title?: string;
  description?: string;
  completed?: boolean;
  materials?: string[];
}

interface AiPersonalityObject {
  extroversion: number;
  intuition: number;
  thinking: number;
  judging: number;
}

interface ServerPreferencesData {
  preferences?: {
    selectedDocuments?: string[];
    name?: string;
    grade?: string;
    gender?: string;
    fieldOfStudy?: string;
    aiGender?: string;
    aiAvatarUrl?: string;
    aiPersonality?: string | AiPersonalityObject;
  };
  profile?: {
    name?: string;
    grade?: string;
    gender?: string;
    fieldOfStudy?: string;
    aiAvatarUrl?: string;
  };
}

const parseAiPersonality = (value: string | AiPersonalityObject | undefined): AiPersonalityObject | undefined => {
  if (!value) return undefined;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value) as AiPersonalityObject;
  } catch {
    return undefined;
  }
};

const mapServerNote = (note: ServerNote, index: number): Note => {
  const parseDate = (dateValue: string | number | Date | undefined): Date => {
    if (!dateValue) return new Date();
    const parsed = new Date(dateValue);
    return isNaN(parsed.getTime()) ? new Date() : parsed;
  };
  
  const createdAt = parseDate(note.createdAt);
  const updatedAt = note.updatedAt ? parseDate(note.updatedAt) : createdAt;
  
  return {
    id: typeof note.id === "number" ? note.id.toString() : note.id ?? `note-${Date.now()}-${index}`,
    title: note.title ?? "",
    content: note.content ?? "",
    tags: note.tags ?? [],
    createdAt,
    updatedAt,
  };
};

const mapServerMessage = (message: ServerMessage, index: number): Message => ({
  id: typeof message.id === "number" ? message.id.toString() : message.originalId ?? `message-${Date.now()}-${index}`,
  role: message.role === "teacher" || message.role === "buddy" ? message.role : "user",
  content: message.content ?? "",
  ttsContent: message.ttsContent ?? undefined,
  timestamp: new Date(message.createdAt ?? Date.now()),
  attachedDocument: message.attachedDocument ?? undefined,
  attachedDocumentId: message.attachedDocumentId ?? undefined,
  attachedDocumentUrl: message.attachedDocumentUrl ?? undefined,
  isVoice: Boolean(message.isVoice),
});

const mapServerGoal = (goal: ServerGoal): StudyPlanItem => ({
  id: typeof goal.id === "number" ? goal.id.toString() : goal.id ?? Date.now().toString(),
  title: goal.title ?? "",
  description: goal.description ?? "",
  completed: Boolean(goal.completed),
  materials: goal.materials ?? [],
});

const buildPreferencesFromServer = (data: ServerPreferencesData): UserPreferences | null => {
  const prefs = data?.preferences ?? {};
  const profile = data?.profile ?? {};
  const hasPrefs = prefs && Object.keys(prefs).length > 0;
  const hasProfile = profile && Object.keys(profile).length > 0;
  if (!hasPrefs && !hasProfile) return null;

  return {
    selectedDocuments: prefs.selectedDocuments ?? [],
    name: profile.name ?? prefs.name,
    grade: profile.grade ?? prefs.grade ?? "",
    gender: profile.gender ?? prefs.gender ?? "",
    fieldOfStudy: profile.fieldOfStudy ?? prefs.fieldOfStudy ?? "",
    mode: "study-buddy",
    aiGender: prefs.aiGender,
    aiPersonality: parseAiPersonality(prefs.aiPersonality),
    aiAvatarUrl: profile.aiAvatarUrl ?? prefs.aiAvatarUrl,
  };
};

function StudyBuddyPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [isLoading, setIsLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [userPreferences, setUserPreferences] = useState<UserPreferences | null>(null);
  const [isDark, setIsDark] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);

  const [documents, setDocuments] = useState<Document[]>([]);
  const [selectedDocument, setSelectedDocument] = useState<Document | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [studyPlan, setStudyPlan] = useState<StudyPlanItem[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [studyPlanError, setStudyPlanError] = useState<string | null>(null);
  
  // Ref to prevent double introduction generation
  const introGeneratedRef = useRef(false);

  // Save new messages to database
  const saveMessageToDb = useCallback(async (message: Message) => {
    if (!sessionId) return;
    try {
      await fetch("/api/study-agent/me/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          originalId: message.id,
          role: message.role,
          content: message.content,
          ttsContent: message.ttsContent,
          attachedDocument: message.attachedDocument,
          attachedDocumentId: message.attachedDocumentId,
          attachedDocumentUrl: message.attachedDocumentUrl,
          isVoice: message.isVoice,
          createdAt: message.timestamp.toISOString(),
        }),
      });
    } catch (e) {
      console.error("Error saving message to database:", e);
    }
  }, [sessionId]);

  // Generate introduction message for new sessions
  const generateIntroduction = useCallback(async (prefs: UserPreferences | null, plan: StudyPlanItem[]) => {
    try {
      const response = await fetch("/api/study-agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "Please introduce yourself and discuss the study materials. Also mention that I can create a study plan.",
          mode: "study-buddy",
          fieldOfStudy: prefs?.fieldOfStudy,
          selectedDocuments: prefs?.selectedDocuments ?? [],
          studyPlan: plan,
          conversationHistory: [],
          sessionId,
        }),
      });

      if (response.ok) {
        interface ChatResponse {
          originalResponse?: string;
          response?: string;
        }
        const data = await response.json() as ChatResponse;
        const originalResponse = data.originalResponse ?? data.response ?? "Hey! I'm your AI study buddy. Let's learn together!";
        const ttsResponse = data.response ?? originalResponse;
        
        const introMessage: Message = {
          id: "1",
          role: "buddy",
          content: originalResponse,
          ttsContent: ttsResponse,
          timestamp: new Date(),
          isVoice: true,
        };
        setMessages([introMessage]);
      } else {
        const fallbackContent = `Hey! I'm your AI study buddy! I see you're studying ${prefs?.fieldOfStudy ?? "new topics"}. I've created a study plan based on your materials. Let's work through this together!`;
        
        const welcomeMessage: Message = {
          id: "1",
          role: "buddy",
          content: fallbackContent,
          ttsContent: `[happy] ${fallbackContent}`,
          timestamp: new Date(),
          isVoice: true,
        };
        setMessages([welcomeMessage]);
      }
    } catch (error) {
      console.error("Error generating introduction:", error);
      const fallbackContent = `Hey! I'm your AI study buddy! Let's work through your study materials together!`;
      
      const welcomeMessage: Message = {
        id: "1",
        role: "buddy",
        content: fallbackContent,
        ttsContent: `[happy] ${fallbackContent}`,
        timestamp: new Date(),
        isVoice: true,
      };
      setMessages([welcomeMessage]);
    } finally {
      setIsConnecting(false);
    }
  }, [sessionId, setMessages, setIsConnecting]);

  // Fetch documents on mount
  useEffect(() => {
    const fetchDocuments = async () => {
      try {
        const response = await fetch("/api/fetchDocument", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: "current" }),
        });
        
        if (!response.ok) throw new Error("Failed to fetch documents");
        
        interface FetchDocumentResponse {
          id: number;
          title: string;
          url: string;
          category: string;
          createdAt: string | Date;
        }
        const rawDocs = await response.json() as FetchDocumentResponse[];
        const data: Document[] = rawDocs.map((doc) => ({
          id: doc.id.toString(),
          name: doc.title,
          type: "pdf" as const,
          url: doc.url,
          folder: doc.category,
          uploadedAt: new Date(doc.createdAt),
        }));
        
        setDocuments(data);
      } catch (error) {
        console.error("Error fetching documents:", error);
        setDocuments([]);
      }
    };

    void fetchDocuments();
  }, []);

  // Load session data on mount
  useEffect(() => {
    const loadSessionData = async () => {
      const sessionIdFromUrl = searchParams.get("sessionId");
      
      if (!sessionIdFromUrl) {
        // No session ID, redirect to onboarding
        router.push("/employer/studyAgent/onboarding");
        return;
      }

      try {
        const url = new URL("/api/study-agent/me", window.location.origin);
        url.searchParams.set("sessionId", sessionIdFromUrl);

        const response = await fetch(url.toString());
        if (!response.ok) {
          console.error("Failed to load study agent data");
          router.push("/employer/studyAgent/onboarding");
          return;
        }

        interface SessionDataResponse {
          session?: {
            id?: string | number;
            mode?: string;
          };
          goals?: ServerGoal[];
          notes?: ServerNote[];
          messages?: ServerMessage[];
          preferences?: ServerPreferencesData["preferences"];
          profile?: ServerPreferencesData["profile"];
        }
        const data = await response.json() as SessionDataResponse;

        // Verify this is a study-buddy session
        if (data.session?.mode && data.session.mode !== "study-buddy") {
          // Wrong mode, redirect to correct page
          router.push(`/employer/studyAgent/teacher?sessionId=${sessionIdFromUrl}`);
          return;
        }

        if (data.session?.id) {
          setSessionId(Number(data.session.id));
        }

        if (Array.isArray(data.goals)) {
          setStudyPlan(data.goals.map(mapServerGoal));
        }

        if (Array.isArray(data.notes)) {
          setNotes(data.notes.map(mapServerNote));
        }

        if (Array.isArray(data.messages)) {
          setMessages(data.messages.map(mapServerMessage));
        }

        const prefs = buildPreferencesFromServer(data);
        if (prefs) {
          setUserPreferences(prefs);
        }

        // If this is a new session (no messages) and we haven't already generated intro
        if ((!data.messages || data.messages.length === 0) && !introGeneratedRef.current) {
          introGeneratedRef.current = true;
          setIsConnecting(true);
          await generateIntroduction(prefs, data.goals?.map(mapServerGoal) ?? []);
        }

        setIsLoading(false);
      } catch (error) {
        console.error("Error loading session data", error);
        router.push("/employer/studyAgent/onboarding");
      }
    };

    void loadSessionData();
  }, [searchParams, router, generateIntroduction]);

  // Select the first document once both documents and preferences are available
  useEffect(() => {
    if (userPreferences?.selectedDocuments?.length && documents.length > 0 && !selectedDocument) {
      const firstDoc = documents.find((d) => d.id === userPreferences.selectedDocuments[0]);
      if (firstDoc) {
        setSelectedDocument(firstDoc);
      }
    }
  }, [userPreferences, documents, selectedDocument]);

  const persistGoalUpdate = async (goalId: string, updates: Partial<StudyPlanItem>) => {
    try {
      const response = await fetch("/api/study-agent/me/study-goals", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: goalId, ...updates, sessionId }),
      });

      if (!response.ok) throw new Error("Failed to update goal");

      interface GoalUpdateResponse {
        goal?: ServerGoal;
      }
      const data = await response.json() as GoalUpdateResponse;
      if (data.goal) {
        setStudyPlan((prev) =>
          prev.map((item) => (item.id === goalId ? mapServerGoal(data.goal!) : item))
        );
      }
      setStudyPlanError(null);
    } catch (error) {
      console.error("Error saving study goal", error);
      setStudyPlanError("We couldn't save your study goals. Changes are local only.");
    }
  };

  const persistGoalCreate = async (item: StudyPlanItem) => {
    try {
      const response = await fetch("/api/study-agent/me/study-goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: item.title,
          description: item.description,
          materials: item.materials,
          completed: item.completed,
          sessionId,
        }),
      });

      if (!response.ok) throw new Error("Failed to create goal");

      interface GoalCreateResponse {
        goal?: ServerGoal;
      }
      const data = await response.json() as GoalCreateResponse;
      if (data.goal) {
        setStudyPlan((prev) =>
          prev.map((goal) => (goal.id === item.id ? mapServerGoal(data.goal!) : goal))
        );
      }
      setStudyPlanError(null);
    } catch (error) {
      console.error("Error creating study goal", error);
      setStudyPlanError("We couldn't save your study goals. Changes are local only.");
    }
  };

  const persistGoalDelete = async (goalId: string) => {
    try {
      const response = await fetch("/api/study-agent/me/study-goals", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: goalId, sessionId }),
      });

      if (!response.ok) throw new Error("Failed to delete goal");
      setStudyPlanError(null);
    } catch (error) {
      console.error("Error deleting study goal", error);
      setStudyPlanError("We couldn't sync the removal with the server. Try again later.");
    }
  };

  const handleEndCall = () => {
    router.push("/employer/studyAgent/onboarding");
  };

  const handleSendMessage = async (content: string) => {
    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content,
      timestamp: new Date(),
      isVoice: true,
    };

    setMessages((prev) => [...prev, userMessage]);
    void saveMessageToDb(userMessage);

    const currentMessages = [...messages, userMessage];

    try {
      const response = await fetch("/api/study-agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: content,
          mode: "study-buddy",
          fieldOfStudy: userPreferences?.fieldOfStudy,
          selectedDocuments: userPreferences?.selectedDocuments ?? [],
          studyPlan: studyPlan,
          conversationHistory: currentMessages.slice(-5).map((msg) => ({
            role: msg.role,
            content: msg.content,
          })),
          sessionId,
        }),
      });

      if (!response.ok) throw new Error("Failed to get AI response");

      interface ChatResponse {
        originalResponse?: string;
        response?: string;
        isAgenticResponse?: boolean;
        updatedStudyPlan?: Array<{
          id: string;
          title: string;
          description: string;
          completed: boolean;
        }>;
        toolsUsed?: string[];
      }

      const data = await response.json() as ChatResponse;
      const aiResponse = data.originalResponse ?? data.response ?? "I'm sorry, I couldn't generate a response right now.";
      const ttsResponse = data.response ?? aiResponse;

      if (data.isAgenticResponse) {
        if (data.updatedStudyPlan && data.updatedStudyPlan.length > 0) {
          const newItems: StudyPlanItem[] = data.updatedStudyPlan.map((item) => ({
            id: item.id,
            title: item.title,
            description: item.description,
            completed: item.completed,
            materials: [],
          }));
          setStudyPlan((prev) => {
            const existingIds = new Set(prev.map((p) => p.id));
            const uniqueNewItems = newItems.filter((item) => !existingIds.has(item.id));
            return [...prev, ...uniqueNewItems];
          });
        }

        if (data.toolsUsed?.includes("pomodoro_timer")) {
          window.dispatchEvent(new CustomEvent("pomodoro-sync"));
        }

        if (data.toolsUsed?.includes("take_notes") && sessionId) {
          try {
            const notesUrl = new URL("/api/study-agent/me", window.location.origin);
            notesUrl.searchParams.set("sessionId", sessionId.toString());
            const notesResponse = await fetch(notesUrl.toString());
            if (notesResponse.ok) {
              interface NotesResponse {
                notes?: ServerNote[];
              }
              const notesData = await notesResponse.json() as NotesResponse;
              if (Array.isArray(notesData.notes)) {
                setNotes(notesData.notes.map(mapServerNote));
              }
            }
          } catch (err) {
            console.error("Error refreshing notes:", err);
          }
        }
      }

      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "buddy",
        content: aiResponse,
        ttsContent: ttsResponse,
        timestamp: new Date(),
        isVoice: true,
      };
      setMessages((prev) => [...prev, aiMessage]);
      void saveMessageToDb(aiMessage);
    } catch (error) {
      console.error("Error getting AI response:", error);
      const fallbackResponse = `Let me help you with that! What specific aspect would you like to focus on?`;
      
      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "buddy",
        content: fallbackResponse,
        ttsContent: `[calm] ${fallbackResponse}`,
        timestamp: new Date(),
        isVoice: true,
      };
      setMessages((prev) => [...prev, aiMessage]);
      void saveMessageToDb(aiMessage);
    }
  };

  const handleDocumentUploaded = (newDoc: Document) => {
    setDocuments((prev) => [...prev, newDoc]);
  };

  const handlePullUpMaterial = (docId: string) => {
    const doc = documents.find(d => d.id === docId);
    if (doc) {
      setSelectedDocument(doc);
      const aiMessage: Message = {
        id: Date.now().toString(),
        role: "buddy",
        content: `Let me pull up "${doc.name}" for us to review together. What specific part would you like to focus on?`,
        timestamp: new Date(),
        attachedDocument: doc.name,
        attachedDocumentId: doc.id,
        attachedDocumentUrl: doc.url,
        isVoice: true,
      };
      setMessages((prev) => [...prev, aiMessage]);
    }
  };

  const handleToggleStudyItem = (itemId: string) => {
    setStudyPlan((prev) => {
      const target = prev.find((item) => item.id === itemId);
      const nextCompleted = target ? !target.completed : false;
      void persistGoalUpdate(itemId, { completed: nextCompleted });
      return prev.map((item) =>
        item.id === itemId ? { ...item, completed: nextCompleted } : item
      );
    });
  };

  const handleAddStudyItem = async (item: Omit<StudyPlanItem, "id">) => {
    const tempId = Date.now().toString();
    const newItem: StudyPlanItem = { ...item, id: tempId };
    setStudyPlan((prev) => [...prev, newItem]);
    void persistGoalCreate(newItem);
  };

  const handleEditStudyItem = (itemId: string, updates: Partial<StudyPlanItem>) => {
    setStudyPlan((prev) => {
      void persistGoalUpdate(itemId, updates);
      return prev.map((item) =>
        item.id === itemId ? { ...item, ...updates } : item
      );
    });
  };

  const handleDeleteStudyItem = (itemId: string) => {
    setStudyPlan((prev) => prev.filter((item) => item.id !== itemId));
    void persistGoalDelete(itemId);
  };

  const handleAddNote = async (note: Omit<Note, "id" | "createdAt" | "updatedAt">) => {
    const tempId = `temp-${Date.now()}`;
    const optimisticNote: Note = {
      ...note,
      id: tempId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    setNotes((prev) => [...prev, optimisticNote]);

    try {
      const res = await fetch("/api/study-agent/me/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          title: note.title,
          content: note.content,
          tags: note.tags,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to save note");
      }

      const data = (await res.json()) as { note?: { id?: string | number } };
      const newId =
        typeof data.note?.id === "number" || typeof data.note?.id === "string"
          ? data.note.id.toString()
          : tempId;

      setNotes((prev) =>
        prev.map((n) => (n.id === tempId ? { ...n, id: newId } : n))
      );
    } catch (error) {
      console.error("Error saving note:", error);
      setNotes((prev) => prev.filter((n) => n.id !== tempId));
    }
  };

  const handleUpdateNote = async (noteId: string, updates: Partial<Note>) => {
    setNotes((prev) =>
      prev.map((note) =>
        note.id === noteId ? { ...note, ...updates, updatedAt: new Date() } : note
      )
    );

    try {
      await fetch("/api/study-agent/sync/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          noteId,
          data: updates,
          sessionId,
        }),
      });
    } catch (error) {
      console.error("Error syncing note update to backend:", error);
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    setNotes((prev) => prev.filter((note) => note.id !== noteId));

    try {
      await fetch("/api/study-agent/sync/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete",
          noteId,
          sessionId,
        }),
      });
    } catch (error) {
      console.error("Error syncing note deletion to backend:", error);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading your study session...</p>
        </div>
      </div>
    );
  }

  if (isConnecting) {
    return (
      <ConnectingScreen 
        mode="study-buddy"
        fieldOfStudy={userPreferences?.fieldOfStudy ?? ""}
      />
    );
  }

  return (
    <div className={`flex h-screen overflow-hidden ${isDark ? 'bg-gray-900' : 'bg-gray-50'}`}>
      {showSidebar && (
        <ResizablePanel
          defaultWidth={280}
          minWidth={200}
          maxWidth={400}
          position="left"
        >
          <Sidebar
            documents={documents}
            selectedDocument={selectedDocument}
            onSelectDocument={setSelectedDocument}
            onDocumentUploaded={handleDocumentUploaded}
            isDark={isDark}
            onToggleDark={() => setIsDark(!isDark)}
            onCloseSidebar={() => setShowSidebar(false)}
          />
        </ResizablePanel>
      )}

      <div className="flex-1 min-w-0">
        <DocumentViewer document={selectedDocument} isDark={isDark} />
      </div>

      <ResizablePanel
        defaultWidth={384}
        minWidth={320}
        maxWidth={600}
        position="right"
      >
        <StudyBuddyPanel
          messages={messages}
          studyPlan={studyPlan}
          documents={documents}
          notes={notes}
          selectedDocument={selectedDocument}
          onSendMessage={handleSendMessage}
          onEndCall={handleEndCall}
          onPullUpMaterial={handlePullUpMaterial}
          onToggleStudyItem={handleToggleStudyItem}
          onAddStudyItem={handleAddStudyItem}
          onEditStudyItem={handleEditStudyItem}
          onDeleteStudyItem={handleDeleteStudyItem}
          onAddNote={handleAddNote}
          onUpdateNote={handleUpdateNote}
          onDeleteNote={handleDeleteNote}
          onToggleSidebar={() => setShowSidebar(!showSidebar)}
          isDark={isDark}
          errorMessage={studyPlanError}
          avatarUrl={userPreferences?.aiAvatarUrl}
        />
      </ResizablePanel>
      
      <Toaster />
    </div>
  );
}

export default function StudyBuddyPage() {
  return (
    <Suspense fallback={
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading your study session...</p>
        </div>
      </div>
    }>
      <StudyBuddyPageContent />
    </Suspense>
  );
}

