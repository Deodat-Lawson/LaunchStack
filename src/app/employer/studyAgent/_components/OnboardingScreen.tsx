"use client";
import { useState } from "react";
import type { Document, UserPreferences } from "../types";
import { Button } from "./ui/button";
import { GraduationCap, CheckCircle2 } from "lucide-react";
import { StepDocumentSelection } from "./OnboardingScreen/StepDocumentSelection";
import { StepUserInfo } from "./OnboardingScreen/StepUserInfo";
import { StepModeSelection } from "./OnboardingScreen/StepModeSelection";
import { StepAiPersonality } from "./OnboardingScreen/StepAiPersonality";
import type { AiPersonalitySettings, LearningMode } from "./OnboardingScreen/types";
import { getAvatarUrl} from "./utils/AvatarSelect";

interface OnboardingScreenProps {
  documents: Document[];
  onComplete: (preferences: UserPreferences) => void;
  onDocumentUploaded: (doc: Document) => void;
  errorMessage?: string | null;
  isSubmitting?: boolean;
}

export function OnboardingScreen({ 
  documents, 
  onComplete, 
  onDocumentUploaded, 
  errorMessage,
  isSubmitting = false 
}: OnboardingScreenProps) {
  const [step, setStep] = useState(1);
  const [selectedDocuments, setSelectedDocuments] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [grade, setGrade] = useState("");
  const [gender, setGender] = useState("");
  const [fieldOfStudy, setFieldOfStudy] = useState("");
  const [mode, setMode] = useState<LearningMode>("study-buddy");
  const [customizePersonality, setCustomizePersonality] = useState(false);
  const [aiGender, setAiGender] = useState("");
  const [aiPersonality, setAiPersonality] = useState<AiPersonalitySettings>({
    extroversion: 50,
    intuition: 50,
    thinking: 50,
    judging: 50,
  });
  
  // Search and filter states for document selection
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  const handleContinue = () => {
    if (step === 1 && selectedDocuments.length > 0) {
      setStep(2);
    } else if (step === 2 && grade && fieldOfStudy) {
      setStep(3);
    } else if (step === 3 && mode) {
      setStep(4);
    } else if (step === 4) {
      const avatarUrl = getAvatarUrl(aiGender, mode);
      onComplete({
        selectedDocuments,
        name,
        grade,
        gender,
        fieldOfStudy,
        mode: mode!,
        aiGender,
        aiAvatarUrl: avatarUrl,
        aiPersonality,
      });
    }
  };

  const canContinue = () => {
    if (step === 1) return selectedDocuments.length > 0;
    if (step === 2) return grade && fieldOfStudy;
    if (step === 3) return mode !== null;
    if (step === 4) return true;
    return false;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-600 via-purple-500 to-indigo-600 flex items-center justify-center p-6">
      <div className="w-full max-w-2xl">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center shadow-lg">
              <GraduationCap className="w-7 h-7 text-purple-600" />
            </div>
            <h1 className="text-white text-3xl">AI Learning Assistant</h1>
          </div>
          <p className="text-white/80">
            Let&apos;s set up your personalized learning experience
          </p>
          {errorMessage && (
            <p className="mt-4 text-red-100 text-sm bg-red-500/30 inline-block px-3 py-2 rounded-lg">
              {errorMessage}
            </p>
          )}
        </div>

        {/* Progress Steps */}
        <div className="flex items-center justify-center gap-4 mb-8">
          {[1, 2, 3, 4].map((s) => (
            <div key={s} className="flex items-center gap-2">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                  s < step
                    ? "bg-green-500 text-white"
                    : s === step
                    ? "bg-white text-purple-600"
                    : "bg-white/30 text-white/60"
                }`}
              >
                {s < step ? <CheckCircle2 className="w-5 h-5" /> : s}
              </div>
              {s < 4 && <div className="w-12 h-1 bg-white/30 rounded" />}
            </div>
          ))}
        </div>

        {/* Main Content Card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          {/* Step 1: Select Documents */}
          {step === 1 && (
            <StepDocumentSelection
              documents={documents}
              selectedDocuments={selectedDocuments}
              setSelectedDocuments={setSelectedDocuments}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              selectedCategory={selectedCategory}
              setSelectedCategory={setSelectedCategory}
              onDocumentUploaded={onDocumentUploaded}
            />
          )}

          {/* Step 2: User Information */}
          {step === 2 && (
            <StepUserInfo
              name={name}
              setName={setName}
              grade={grade}
              setGrade={setGrade}
              gender={gender}
              setGender={setGender}
              fieldOfStudy={fieldOfStudy}
              setFieldOfStudy={setFieldOfStudy}
            />
          )}

          {/* Step 3: Choose Mode */}
          {step === 3 && (
            <StepModeSelection
              mode={mode}
              setMode={setMode}
            />
          )}

          {/* Step 4: AI Personality Customization */}
          {step === 4 && (
            <StepAiPersonality
              customizePersonality={customizePersonality}
              setCustomizePersonality={setCustomizePersonality}
              aiGender={aiGender}
              setAiGender={setAiGender}
              aiPersonality={aiPersonality}
              setAiPersonality={setAiPersonality}
            />
          )}

          {/* Navigation Buttons */}
          <div className="flex gap-3 mt-8 pt-6 border-t">
            {step > 1 && (
              <Button
                variant="outline"
                onClick={() => setStep(step - 1)}
                className="flex-1"
                disabled={isSubmitting}
              >
                Back
              </Button>
            )}
            <Button
              onClick={handleContinue}
              disabled={!canContinue() || isSubmitting}
              className="flex-1 bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800"
            >
              {isSubmitting ? (
                <span className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Starting...
                </span>
              ) : (
                step === 4 ? "Start Learning" : "Continue"
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
