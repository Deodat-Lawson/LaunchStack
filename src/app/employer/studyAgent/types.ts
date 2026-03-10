export type Subject = "general" | "math" | "science" | "history" | "literature";

export interface Message {
  id: string;
  role: "user" | "teacher" | "buddy";
  content: string;
  ttsContent?: string; // Text with emotion tags for TTS
  timestamp: Date;
  attachedDocument?: string; // Document name
  attachedDocumentId?: string; // Document ID
  attachedDocumentUrl?: string; // Document URL for PDF display
  isVoice?: boolean;
  isPlaying?: boolean;
}

export interface Document {
  id: string;
  name: string;
  type: "pdf" | "image" | "text";
  url: string;
  folder?: string;
  uploadedAt: Date;
}

export interface StudyPlanItem {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  materials: string[]; // document IDs
}

export interface Note {
  id: string;
  title: string;
  content: string;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface UserPreferences {
  selectedDocuments: string[];
  name?: string;
  grade: string;
  gender: string;
  fieldOfStudy: string;
  mode: "teacher" | "study-buddy";
  aiGender?: string;
  aiAvatarUrl?: string;
  aiPersonality?: {
    extroversion: number;
    intuition: number;
    thinking: number;
    judging: number;
  };
}

export type SessionMode = "teacher" | "study-buddy";

