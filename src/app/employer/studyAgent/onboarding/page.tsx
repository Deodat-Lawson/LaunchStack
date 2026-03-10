"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { OnboardingScreen } from "../_components/OnboardingScreen";
import { ConnectingScreen } from "../_components/ConnectingScreen";
import type { Document, UserPreferences } from "../types";

export default function OnboardingPage() {
  const router = useRouter();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(true);
  const [documentsError, setDocumentsError] = useState<string | null>(null);
  const [preferencesError, setPreferencesError] = useState<string | null>(null);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [userPreferences, setUserPreferences] = useState<UserPreferences | null>(null);

  // Fetch documents from database on mount
  useEffect(() => {
    const fetchDocuments = async () => {
      try {
        setDocumentsLoading(true);
        setDocumentsError(null);
        
        const response = await fetch("/api/fetchDocument", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: "current" }),
        });
        
        if (!response.ok) {
          throw new Error("Failed to fetch documents");
        }
        
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
        console.log(`📚 [Onboarding] Loaded ${data.length} documents from database`);
      } catch (error) {
        console.error("Error fetching documents:", error);
        setDocumentsError(error instanceof Error ? error.message : "Failed to load documents");
        setDocuments([]);
      } finally {
        setDocumentsLoading(false);
      }
    };

    void fetchDocuments();
  }, []);

  const handleDocumentUploaded = (newDoc: Document) => {
    setDocuments((prev) => [...prev, newDoc]);
  };

  const handleCompleteOnboarding = async (preferences: UserPreferences) => {
    if (isCreatingSession) {
      console.log("Session creation already in progress");
      return;
    }

    // Immediately show the connecting screen
    setIsCreatingSession(true);
    setUserPreferences(preferences);
    setPreferencesError(null);

    try {
      // Create session with full preferences payload (server will persist profile & prefs)
      const sessionResponse = await fetch("/api/study-agent/me/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          preferences
        }),
      });

      if (!sessionResponse.ok) {
        throw new Error("Failed to start a study session");
      }

      const sessionData = (await sessionResponse.json()) as {
        session?: {
          id?: string | number;
        };
      };
      const sessionId = sessionData.session?.id;

      if (!sessionId) {
        throw new Error("No session ID returned");
      }

      // Generate initial study plan
      const initialPlan = preferences.selectedDocuments.map((docId, index) => {
        const doc = documents.find(d => d.id === docId);
        return {
          id: `plan-${index}`,
          title: doc ? `Study ${doc.name}` : `Topic ${index + 1}`,
          description: doc ? `Review and understand key concepts from ${doc.name}` : "Complete this learning objective",
          completed: false,
          materials: [docId],
        };
      });

      await fetch("/api/study-agent/me/study-goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: initialPlan, sessionId }),
      });

      // Navigate to appropriate page based on mode
      const targetPage = preferences.mode === "teacher" ? "teacher" : "studyBuddy";
      router.push(`/employer/studyAgent/${targetPage}?sessionId=${sessionId}`);
    } catch (error) {
      console.error("Error creating study session", error);
      setPreferencesError("We couldn't start your study session. Please try again.");
      setIsCreatingSession(false);
      setUserPreferences(null);
    }
  };

  // Show connecting screen immediately after form submission
  if (isCreatingSession && userPreferences) {
    return (
      <ConnectingScreen 
        mode={userPreferences.mode}
        fieldOfStudy={userPreferences.fieldOfStudy}
      />
    );
  }

  if (documentsLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading documents...</p>
        </div>
      </div>
    );
  }

  if (documentsError) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="text-center max-w-md">
          <p className="text-red-600 mb-4">Error loading documents: {documentsError}</p>
          <p className="text-sm text-gray-600">You can still proceed, but documents may not be available.</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <OnboardingScreen
      documents={documents}
      onComplete={handleCompleteOnboarding}
      onDocumentUploaded={handleDocumentUploaded}
      errorMessage={preferencesError}
      isSubmitting={isCreatingSession}
    />
  );
}
