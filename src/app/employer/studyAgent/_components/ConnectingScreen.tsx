"use client";
import { useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";

interface ConnectingScreenProps {
  mode: "teacher" | "study-buddy";
  fieldOfStudy: string;
}

export function ConnectingScreen({ mode, fieldOfStudy }: ConnectingScreenProps) {
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("Analyzing your materials...");

  useEffect(() => {
    // Simulate connection progress
    const statuses = [
      "Analyzing your materials...",
      mode === "teacher" 
        ? "Finding the best teaching approach..."
        : "Preparing your study plan...",
      mode === "teacher"
        ? "Setting up the whiteboard..."
        : "Organizing your learning path...",
      `Connecting to your AI ${mode === "teacher" ? "teacher" : "study buddy"}...`,
    ];

    let currentStatus = 0;
    const interval = setInterval(() => {
      setProgress((prev) => Math.min(prev + 25, 100));
      if (currentStatus < statuses.length) {
        setStatusText(statuses[currentStatus] ?? "");
        currentStatus++;
      }
    }, 750);

    return () => clearInterval(interval);
  }, [mode]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-600 via-purple-500 to-indigo-600 flex items-center justify-center p-6">
      <div className="text-center">
        {/* Animated Icon */}
        <div className="relative inline-block mb-8">
          <div className="w-32 h-32 bg-white rounded-full flex items-center justify-center shadow-2xl">
            <span className="text-6xl">
              {mode === "teacher" ? "👨‍🏫" : "🤝"}
            </span>
          </div>
          
          {/* Pulsing rings */}
          <div className="absolute inset-0 rounded-full border-4 border-white animate-ping opacity-20" />
          <div className="absolute inset-0 rounded-full border-4 border-white animate-pulse opacity-40" />
          
          {/* Sparkles */}
          <Sparkles className="absolute -top-2 -right-2 w-8 h-8 text-yellow-300 animate-pulse" />
          <Sparkles className="absolute -bottom-2 -left-2 w-6 h-6 text-yellow-200 animate-pulse" style={{ animationDelay: "0.5s" }} />
        </div>

        {/* Text */}
        <h2 className="text-white text-3xl mb-4">
          Connecting to Your AI {mode === "teacher" ? "Teacher" : "Study Buddy"}
        </h2>
        <p className="text-white/80 text-lg mb-8">
          Specializing in {fieldOfStudy}
        </p>

        {/* Status */}
        <div className="inline-flex items-center gap-3 bg-white/20 backdrop-blur-md px-6 py-3 rounded-full text-white mb-8">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>{statusText}</span>
        </div>

        {/* Progress Bar */}
        <div className="w-80 mx-auto bg-white/20 rounded-full h-2 overflow-hidden">
          <div
            className="h-full bg-white rounded-full transition-all duration-300 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );
}
