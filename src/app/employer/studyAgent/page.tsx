"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Re-export types for backward compatibility
export type { Subject, Message, Document, StudyPlanItem, Note, UserPreferences, SessionMode } from "./types";

export default function StudyAgentRedirect() {
  const router = useRouter();

  useEffect(() => {
    // Redirect to onboarding page
    router.replace("/employer/studyAgent/onboarding");
  }, [router]);

  return (
    <div className="flex h-screen items-center justify-center bg-gradient-to-br from-purple-600 via-purple-500 to-indigo-600">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
        <p className="text-white/80">Redirecting...</p>
      </div>
    </div>
  );
}
