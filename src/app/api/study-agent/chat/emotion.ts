/**
 * Emotion Detection Utilities
 * Detects and manages emotion tags for ElevenLabs TTS
 */

import type { EmotionTag } from "./types";

/**
 * Detect emotion from text content for ElevenLabs TTS emotion tags
 * Returns emotion tag like "happy", "excited", "calm", "sad", etc.
 */
export function detectEmotion(text: string): EmotionTag | null {
  const lowerText = text.toLowerCase();

  // Happy indicators - positive, encouraging, celebratory
  const happyPatterns = [
    "great",
    "excellent",
    "wonderful",
    "amazing",
    "fantastic",
    "awesome",
    "congratulations",
    "well done",
    "perfect",
    "brilliant",
    "outstanding",
    "good job",
    "nice work",
    "you got it",
    "that's right",
    "exactly",
    "proud of you",
    "you're doing",
    "keep it up",
    "virtual hug",
    "send you a hug",
    "sending you a hug",
    "here's a hug",
    "consider yourself hugged",
    "so happy",
  ];

  // Excited indicators - enthusiastic, energetic
  const excitedPatterns = [
    "let's",
    "let us",
    "ready to",
    "excited",
    "can't wait",
    "awesome",
    "brilliant",
    "here we go",
    "let me show you",
    "check this out",
    "yes!",
    "woo",
    "yay",
  ];

  // Calm indicators - reassuring, supportive, patient
  const calmPatterns = [
    "don't worry",
    "it's okay",
    "take your time",
    "no problem",
    "that's fine",
    "no rush",
    "relax",
    "breathe",
    "step by step",
    "let's take it slow",
    "you're doing fine",
    "it's alright",
    "i'm here",
    "here for you",
    "i'm with you",
    "right beside you",
  ];

  // Empathetic/Sad indicators - comforting, understanding
  const sadPatterns = [
    "i understand",
    "i'm sorry",
    "that's tough",
    "that happens",
    "it's normal",
    "i hear you",
    "that's hard",
  ];

  // Check for patterns (order matters - more specific first)
  for (const pattern of excitedPatterns) {
    if (lowerText.includes(pattern)) {
      console.log(`😊 [Emotion Detection] Excited detected from: "${pattern}"`);
      return "excited";
    }
  }

  for (const pattern of happyPatterns) {
    if (lowerText.includes(pattern)) {
      console.log(`😊 [Emotion Detection] Happy detected from: "${pattern}"`);
      return "happy";
    }
  }

  for (const pattern of calmPatterns) {
    if (lowerText.includes(pattern)) {
      console.log(`😌 [Emotion Detection] Calm detected from: "${pattern}"`);
      return "calm";
    }
  }

  for (const pattern of sadPatterns) {
    if (lowerText.includes(pattern)) {
      console.log(`😔 [Emotion Detection] Sad (empathetic) detected from: "${pattern}"`);
      return "sad";
    }
  }

  // Check for exclamation marks with positive words (excited/happy)
  if (
    text.includes("!") &&
    (lowerText.includes("yes") ||
      lowerText.includes("right") ||
      lowerText.includes("correct") ||
      lowerText.includes("good"))
  ) {
    console.log(`😊 [Emotion Detection] Happy detected from exclamation`);
    return "happy";
  }

  console.log(`😐 [Emotion Detection] No emotion detected, using neutral voice`);
  return null;
}

/**
 * Check if text starts with an emotion tag
 */
export function startsWithEmotionTag(text: string): boolean {
  return /^\s*\[(happy|sad|angry|fearful|surprised|disgusted|excited|calm)\]/i.test(
    text
  );
}

/**
 * Check if text contains any emotion tag
 */
export function hasAnyEmotionTag(text: string): boolean {
  return /\[(happy|sad|angry|fearful|surprised|disgusted|excited|calm)\]/i.test(
    text
  );
}

/**
 * Extract the first emotion tag from text
 */
export function extractFirstEmotionTag(text: string): EmotionTag | null {
  const m = /^\s*\[(happy|sad|angry|fearful|surprised|disgusted|excited|calm)\]/i.exec(text);
  return m ? (m[1]?.toLowerCase() as EmotionTag) : null;
}

/**
 * Remove emotion tags from text for display
 */
export function stripEmotionTags(text: string): string {
  const without = text.replace(
    /\s*\[(happy|sad|angry|fearful|surprised|disgusted|excited|calm)\]\s*/gi,
    " "
  );
  return without.replace(/\s+/g, " ").trim();
}

