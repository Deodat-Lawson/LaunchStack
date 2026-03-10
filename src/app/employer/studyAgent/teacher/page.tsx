"use client";
import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Sidebar } from "../_components/Sidebar";
import { DocumentViewer } from "../_components/DocumentViewer";
import { TeacherPanel } from "../_components/TeacherPanel";
import { ConnectingScreen } from "../_components/ConnectingScreen";
import { WhiteboardPanel } from "../_components/WhiteboardPanel";
import { CollaborativeDocsEditor } from "../_components/CollaborativeDocsEditor";
import { ResizablePanel } from "../_components/ResizablePanel";
import { Toaster } from "../_components/ui/sonner";
import type { Message, Document, StudyPlanItem, UserPreferences } from "../types";

function TeacherPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [isLoading, setIsLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [userPreferences, setUserPreferences] = useState<UserPreferences | null>(null);
  const [teacherView, setTeacherView] = useState<"documents" | "docs" | "whiteboard">("docs");
  const [isDark, setIsDark] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);

  const [documents, setDocuments] = useState<Document[]>([]);
  const [selectedDocument, setSelectedDocument] = useState<Document | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [studyPlan, setStudyPlan] = useState<StudyPlanItem[]>([]);
  
  // Ref to prevent double introduction generation
  const introGeneratedRef = useRef(false);

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
      mode: "teacher",
      aiGender: prefs.aiGender,
      aiPersonality: parseAiPersonality(prefs.aiPersonality),
      aiAvatarUrl: profile.aiAvatarUrl ?? prefs.aiAvatarUrl,
    };
  };

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
          messages?: ServerMessage[];
          preferences?: ServerPreferencesData["preferences"];
          profile?: ServerPreferencesData["profile"];
        }
        const data = await response.json() as SessionDataResponse;

        // Verify this is a teacher session
        if (data.session?.mode && data.session.mode !== "teacher") {
          // Wrong mode, redirect to correct page
          router.push(`/employer/studyAgent/studyBuddy?sessionId=${sessionIdFromUrl}`);
          return;
        }

        if (data.session?.id) {
          setSessionId(Number(data.session.id));
        }

        if (Array.isArray(data.goals)) {
          setStudyPlan(data.goals.map(mapServerGoal));
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, router]);

  // Select the first document once both documents and preferences are available
  useEffect(() => {
    if (userPreferences?.selectedDocuments?.length && documents.length > 0 && !selectedDocument) {
      const firstDoc = documents.find((d) => d.id === userPreferences.selectedDocuments[0]);
      if (firstDoc) {
        setSelectedDocument(firstDoc);
      }
    }
  }, [userPreferences, documents, selectedDocument]);

  const generateIntroduction = async (prefs: UserPreferences | null, plan: StudyPlanItem[]) => {
    try {
      const response = await fetch("/api/study-agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "Please introduce yourself and discuss the study materials. Also mention that I can create a study plan.",
          mode: "teacher",
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
        const originalResponse = data.originalResponse ?? data.response ?? "Hello! I'm your AI teacher. Let's begin our lesson!";
        const ttsResponse = data.response ?? originalResponse;
        
        const introMessage: Message = {
          id: "1",
          role: "teacher",
          content: originalResponse,
          ttsContent: ttsResponse,
          timestamp: new Date(),
          isVoice: true,
        };
        setMessages([introMessage]);
      } else {
        const fallbackContent = `Hello! I'm your AI teacher. I've reviewed your materials on ${prefs?.fieldOfStudy ?? "the selected topics"}. Let's start by going through the key concepts together. I'll use the whiteboard to explain things visually.`;
        
        const welcomeMessage: Message = {
          id: "1",
          role: "teacher",
          content: fallbackContent,
          ttsContent: `[happy] ${fallbackContent}`,
          timestamp: new Date(),
          isVoice: true,
        };
        setMessages([welcomeMessage]);
      }
    } catch (error) {
      console.error("Error generating introduction:", error);
      const fallbackContent = `Hello! I'm your AI teacher. Let's start by going through the key concepts together.`;
      
      const welcomeMessage: Message = {
        id: "1",
        role: "teacher",
        content: fallbackContent,
        ttsContent: `[happy] ${fallbackContent}`,
        timestamp: new Date(),
        isVoice: true,
      };
      setMessages([welcomeMessage]);
    }

    setTimeout(() => {
      setIsConnecting(false);
    }, 3000);
  };

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
    } catch (error) {
      console.error("Error saving study goal", error);
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
          mode: "teacher",
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
      }

      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "teacher",
        content: aiResponse,
        ttsContent: ttsResponse,
        timestamp: new Date(),
        isVoice: true,
      };
      setMessages((prev) => [...prev, aiMessage]);
      void saveMessageToDb(aiMessage);
    } catch (error) {
      console.error("Error getting AI response:", error);
      const fallbackResponse = `Let me explain this on the whiteboard. I'll break down the key concepts step by step.`;
      
      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "teacher",
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
        role: "teacher",
        content: `Let me pull up "${doc.name}" for our lesson. I'll explain the key concepts as we go through it.`,
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

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading your lesson...</p>
        </div>
      </div>
    );
  }

  if (isConnecting) {
    return (
      <ConnectingScreen 
        mode="teacher"
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
        {teacherView === "documents" ? (
          <DocumentViewer document={selectedDocument} isDark={isDark} />
        ) : teacherView === "docs" ? (
          <CollaborativeDocsEditor document={selectedDocument} isDark={isDark} />
        ) : (
          <WhiteboardPanel document={selectedDocument} isDark={isDark} />
        )}
      </div>

      <ResizablePanel
        defaultWidth={384}
        minWidth={320}
        maxWidth={600}
        position="right"
      >
        <TeacherPanel
          messages={messages}
          studyPlan={studyPlan}
          documents={documents}
          selectedDocument={selectedDocument}
          onSendMessage={handleSendMessage}
          onEndCall={handleEndCall}
          onPullUpMaterial={handlePullUpMaterial}
          onToggleStudyItem={handleToggleStudyItem}
          onToggleView={setTeacherView}
          currentView={teacherView}
          onToggleSidebar={() => setShowSidebar(!showSidebar)}
          isDark={isDark}
          avatarUrl={userPreferences?.aiAvatarUrl}
        />
      </ResizablePanel>
      
      <Toaster />
    </div>
  );
}

export default function TeacherPage() {
  return (
    <Suspense fallback={
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading your study session...</p>
        </div>
      </div>
    }>
      <TeacherPageContent />
    </Suspense>
  );
}

