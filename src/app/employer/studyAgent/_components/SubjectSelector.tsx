"use client";
import type { Subject } from "../page";
import { Calculator, Microscope, BookOpen, Library, Sparkles } from "lucide-react";
import { Button } from "./ui/button";

interface SubjectSelectorProps {
  selectedSubject: Subject;
  onSubjectChange: (subject: Subject) => void;
}

const subjects: Array<{ id: Subject; name: string; icon: React.ReactNode; color: string }> = [
  { 
    id: "general", 
    name: "General", 
    icon: <Sparkles className="w-5 h-5" />,
    color: "from-purple-500 to-pink-500"
  },
  { 
    id: "math", 
    name: "Mathematics", 
    icon: <Calculator className="w-5 h-5" />,
    color: "from-blue-500 to-cyan-500"
  },
  { 
    id: "science", 
    name: "Science", 
    icon: <Microscope className="w-5 h-5" />,
    color: "from-green-500 to-emerald-500"
  },
  { 
    id: "history", 
    name: "History", 
    icon: <Library className="w-5 h-5" />,
    color: "from-orange-500 to-red-500"
  },
  { 
    id: "literature", 
    name: "Literature", 
    icon: <BookOpen className="w-5 h-5" />,
    color: "from-violet-500 to-purple-500"
  },
];

export function SubjectSelector({ selectedSubject, onSubjectChange }: SubjectSelectorProps) {
  return (
    <div className="bg-white rounded-2xl shadow-md p-6 border border-gray-200">
      <h2 className="text-lg mb-4">Select a Subject</h2>
      <div className="flex flex-wrap gap-3">
        {subjects.map((subjectItem) => {
          const isSelected = selectedSubject === subjectItem.id;
          return (
            <Button
              key={subjectItem.id}
              onClick={() => onSubjectChange(subjectItem.id)}
              variant={isSelected ? "default" : "outline"}
              className={`flex items-center gap-2 ${
                isSelected
                  ? `bg-gradient-to-r ${subjectItem.color} text-white hover:opacity-90 border-none`
                  : "hover:border-gray-400"
              }`}
            >
              {subjectItem.icon}
              {subjectItem.name}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
