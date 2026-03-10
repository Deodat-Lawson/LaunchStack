"use client";
import type { Subject } from "../page";
import { MessageCircle } from "lucide-react";
import { Button } from "./ui/button";

interface ExampleQuestionsProps {
  subject: Subject;
  onQuestionClick: (question: string) => void;
}

const exampleQuestions: Record<Subject, string[]> = {
  general: [
    "How can I improve my study habits?",
    "What's the best way to take notes?",
    "How do I stay motivated while learning?",
    "Can you help me understand critical thinking?",
  ],
  math: [
    "How do I solve quadratic equations?",
    "What is the Pythagorean theorem?",
    "Can you explain derivatives?",
    "How do percentages work?",
  ],
  science: [
    "How does photosynthesis work?",
    "What is the structure of an atom?",
    "Explain Newton's laws of motion",
    "How does the water cycle work?",
  ],
  history: [
    "What caused World War II?",
    "Tell me about the Renaissance",
    "How did the Industrial Revolution change society?",
    "What was the significance of the French Revolution?",
  ],
  literature: [
    "What are common literary devices?",
    "How do I analyze a poem?",
    "What makes a story compelling?",
    "Explain the hero's journey",
  ],
};

export function ExampleQuestions({ subject, onQuestionClick }: ExampleQuestionsProps) {
  const questions = exampleQuestions[subject] ?? exampleQuestions.general;

  return (
    <div className="bg-white rounded-2xl shadow-md p-6 border border-gray-200">
      <div className="flex items-center gap-2 mb-4">
        <MessageCircle className="w-5 h-5 text-blue-600" />
        <h3 className="text-lg">Example Questions</h3>
      </div>
      <div className="space-y-2">
        {questions.map((question, index) => (
          <Button
            key={index}
            variant="ghost"
            className="w-full justify-start text-left h-auto py-3 px-3 hover:bg-blue-50 hover:text-blue-700"
            onClick={() => onQuestionClick(question)}
          >
            <span className="text-sm">{question}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}
