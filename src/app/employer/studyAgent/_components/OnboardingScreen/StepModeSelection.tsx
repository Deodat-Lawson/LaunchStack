"use client";

import React from "react";
import type { LearningMode } from "./types";

interface StepModeSelectionProps {
  mode: LearningMode;
  setMode: React.Dispatch<React.SetStateAction<LearningMode>>;
}

export const StepModeSelection: React.FC<StepModeSelectionProps> = ({
  mode,
  setMode,
}) => {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl mb-2">Choose Your Learning Mode</h2>
        <p className="text-gray-600">
          How would you like to learn today?
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Teacher Mode */}
        <button
          onClick={() => setMode("teacher")}
          className={`p-6 rounded-xl border-2 transition-all text-left ${
            mode === "teacher"
              ? "border-purple-500 bg-purple-50 shadow-lg"
              : "border-gray-200 hover:border-purple-300"
          }`}
        >
          <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl flex items-center justify-center mb-4">
            <span className="text-2xl">👨‍🏫</span>
          </div>
          <h3 className="text-lg mb-2">AI Teacher</h3>
          <p className="text-sm text-gray-600 mb-4">
            Get structured lessons with a teaching agent who explains concepts
            using a collaborative whiteboard
          </p>
          <div className="space-y-1 text-xs text-gray-500">
            <div>✓ Voice-guided lessons</div>
            <div>✓ Interactive whiteboard</div>
            <div>✓ Step-by-step explanations</div>
          </div>
        </button>

        {/* Study Buddy Mode */}
        <button
          onClick={() => setMode("study-buddy")}
          className={`p-6 rounded-xl border-2 transition-all text-left ${
            mode === "study-buddy"
              ? "border-purple-500 bg-purple-50 shadow-lg"
              : "border-gray-200 hover:border-purple-300"
          }`}
        >
          <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center mb-4">
            <span className="text-2xl">🤝</span>
          </div>
          <h3 className="text-lg mb-2">Study Buddy</h3>
          <p className="text-sm text-gray-600 mb-4">
            Work together with a friendly AI companion to create and follow
            personalized study plans
          </p>
          <div className="space-y-1 text-xs text-gray-500">
            <div>✓ Collaborative learning</div>
            <div>✓ Custom study plans</div>
            <div>✓ Flexible pacing</div>
          </div>
        </button>
      </div>
    </div>
  );
};

