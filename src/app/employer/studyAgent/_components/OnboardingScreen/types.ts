import type { Document, UserPreferences } from "../../types";

export interface OnboardingScreenProps {
  documents: Document[];
  onComplete: (preferences: UserPreferences) => void;
  onDocumentUploaded: (doc: Document) => void;
  errorMessage?: string | null;
  isSubmitting?: boolean;
}

export interface AiPersonalitySettings {
  extroversion: number; // 0 = Introverted, 100 = Extroverted
  intuition: number; // 0 = Sensing, 100 = Intuitive
  thinking: number; // 0 = Feeling, 100 = Thinking
  judging: number; // 0 = Perceiving, 100 = Judging
}

export type LearningMode = "teacher" | "study-buddy" | null;

export const PERSONALITY_ROLES: Record<string, string> = {
  'INTJ': 'The Architect',
  'INTP': 'The Logician',
  'ENTJ': 'The Commander',
  'ENTP': 'The Debater',
  'INFJ': 'The Advocate',
  'INFP': 'The Mediator',
  'ENFJ': 'The Protagonist',
  'ENFP': 'The Campaigner',
  'ISTJ': 'The Logistician',
  'ISFJ': 'The Defender',
  'ESTJ': 'The Executive',
  'ESFJ': 'The Consul',
  'ISTP': 'The Virtuoso',
  'ISFP': 'The Adventurer',
  'ESTP': 'The Entrepreneur',
  'ESFP': 'The Entertainer',
};

export function getPersonalityTypeAndRole(personality: AiPersonalitySettings) {
  const type = 
    (personality.extroversion < 50 ? 'I' : 'E') +
    (personality.intuition < 50 ? 'S' : 'N') +
    (personality.thinking < 50 ? 'F' : 'T') +
    (personality.judging < 50 ? 'P' : 'J');
  
  return { type, role: PERSONALITY_ROLES[type] ?? 'The Analyst' };
}

