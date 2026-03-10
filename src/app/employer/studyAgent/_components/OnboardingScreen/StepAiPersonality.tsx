"use client";

import React from "react";
import { Sparkles } from "lucide-react";
import { Label } from "../ui/label";
import type { AiPersonalitySettings } from "./types";
import { getPersonalityTypeAndRole } from "./types";

interface StepAiPersonalityProps {
  customizePersonality: boolean;
  setCustomizePersonality: React.Dispatch<React.SetStateAction<boolean>>;
  aiGender: string;
  setAiGender: React.Dispatch<React.SetStateAction<string>>;
  aiPersonality: AiPersonalitySettings;
  setAiPersonality: React.Dispatch<React.SetStateAction<AiPersonalitySettings>>;
}

export const StepAiPersonality: React.FC<StepAiPersonalityProps> = ({
  customizePersonality,
  setCustomizePersonality,
  aiGender,
  setAiGender,
  aiPersonality,
  setAiPersonality,
}) => {
  const { type, role } = getPersonalityTypeAndRole(aiPersonality);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl mb-2 flex items-center gap-2">
          <Sparkles className="w-6 h-6 text-purple-600" />
          Customize Your AI Personality
        </h2>
        <p className="text-gray-600">
          Optional: Personalize your AI assistant&apos;s voice and personality
        </p>
      </div>

      {/* Customize Toggle */}
      <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={customizePersonality}
            onChange={(e) => setCustomizePersonality(e.target.checked)}
            className="w-5 h-5 text-purple-600 rounded border-gray-300 focus:ring-purple-500 cursor-pointer"
          />
          <div className="flex-1">
            <div className="text-sm font-medium">Customize AI Personality</div>
            <div className="text-xs text-gray-600">
              Fine-tune voice and personality traits for your assistant
            </div>
          </div>
        </label>
      </div>

      {/* Customization Options - Only shown when enabled */}
      {customizePersonality && (
        <div className="space-y-6 bg-gray-50 p-5 rounded-lg border border-gray-200">
          {/* Voice Gender */}
          <div>
            <Label htmlFor="ai-gender" className="mb-2">AI Voice Gender</Label>
            <select
              id="ai-gender"
              value={aiGender}
              onChange={(e) => setAiGender(e.target.value)}
              className="w-full mt-1.5 h-10 px-3 rounded-md border border-gray-200 bg-white"
            >
              <option value="">Any (Default)</option>
              <option value="male">Male Voice</option>
              <option value="female">Female Voice</option>
              <option value="neutral">Neutral Voice</option>
            </select>
          </div>

          {/* Personality Sliders */}
          <div className="space-y-5">
            <div>
              <Label className="block mb-2">Personality Type (Myers-Briggs)</Label>
              <p className="text-xs text-gray-500 mb-4">
                Adjust each dimension to create your ideal AI personality
              </p>
            </div>
            
            {/* Introversion/Extroversion Slider */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm">Social Energy</span>
                <span className="text-xs text-gray-500 font-mono">{aiPersonality.extroversion}%</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-500 w-20">Introverted (I)</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={aiPersonality.extroversion}
                  onChange={(e) => setAiPersonality({ ...aiPersonality, extroversion: parseInt(e.target.value) })}
                  className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
                />
                <span className="text-xs text-gray-500 w-20 text-right">Extroverted (E)</span>
              </div>
            </div>

            {/* Sensing/Intuition Slider */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm">Information Processing</span>
                <span className="text-xs text-gray-500 font-mono">{aiPersonality.intuition}%</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-500 w-20">Sensing (S)</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={aiPersonality.intuition}
                  onChange={(e) => setAiPersonality({ ...aiPersonality, intuition: parseInt(e.target.value) })}
                  className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
                <span className="text-xs text-gray-500 w-20 text-right">Intuitive (N)</span>
              </div>
            </div>

            {/* Feeling/Thinking Slider */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm">Decision Making</span>
                <span className="text-xs text-gray-500 font-mono">{aiPersonality.thinking}%</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-500 w-20">Feeling (F)</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={aiPersonality.thinking}
                  onChange={(e) => setAiPersonality({ ...aiPersonality, thinking: parseInt(e.target.value) })}
                  className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-green-600"
                />
                <span className="text-xs text-gray-500 w-20 text-right">Thinking (T)</span>
              </div>
            </div>

            {/* Perceiving/Judging Slider */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm">Structure & Planning</span>
                <span className="text-xs text-gray-500 font-mono">{aiPersonality.judging}%</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-500 w-20">Perceiving (P)</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={aiPersonality.judging}
                  onChange={(e) => setAiPersonality({ ...aiPersonality, judging: parseInt(e.target.value) })}
                  className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-orange-600"
                />
                <span className="text-xs text-gray-500 w-20 text-right">Judging (J)</span>
              </div>
            </div>

            {/* Personality Type Display */}
            <div className="mt-4 text-center bg-white p-4 rounded-lg border border-gray-200">
              <div className="text-xs text-gray-500 mb-1">Your AI&apos;s Personality Type</div>
              <div className="text-2xl font-mono mb-1">
                {type}
              </div>
              <div className="text-sm text-purple-600">
                {role}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Skip Hint */}
      <div className="text-center bg-purple-50 p-4 rounded-lg border border-purple-100">
        <p className="text-sm text-purple-700">
          💡 Default personality works great - skip if you&apos;re unsure!
        </p>
      </div>
    </div>
  );
};

