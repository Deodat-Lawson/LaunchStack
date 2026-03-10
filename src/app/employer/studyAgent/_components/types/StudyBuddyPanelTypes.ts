import { type Note, type StudyPlanItem, type Document, type Message } from "../../types";

export interface StudyBuddyPanelProps {
  messages: Message[];
  studyPlan: StudyPlanItem[];
  documents: Document[];
  notes: Note[];
  sessionId?: number | null;
  selectedDocument: Document | null;
  onSendMessage: (content: string) => void;
  onEndCall?: () => void;
  onPullUpMaterial: (docId: string) => void;
  onToggleStudyItem: (itemId: string) => void;
  onAddStudyItem: (item: Omit<StudyPlanItem, "id">) => void;
  onEditStudyItem: (itemId: string, updates: Partial<StudyPlanItem>) => void;
  onDeleteStudyItem: (itemId: string) => void;
  onAddNote: (note: Omit<Note, "id" | "createdAt" | "updatedAt">) => void;
  onUpdateNote: (noteId: string, updates: Partial<Note>) => void;
  onDeleteNote: (noteId: string) => void;
  onToggleSidebar?: () => void;
  isDark?: boolean;
  errorMessage?: string | null;
  avatarUrl?: string;
}
