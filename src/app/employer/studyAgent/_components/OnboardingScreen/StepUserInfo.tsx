"use client";

import React from "react";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

interface StepUserInfoProps {
  name: string;
  setName: React.Dispatch<React.SetStateAction<string>>;
  grade: string;
  setGrade: React.Dispatch<React.SetStateAction<string>>;
  gender: string;
  setGender: React.Dispatch<React.SetStateAction<string>>;
  fieldOfStudy: string;
  setFieldOfStudy: React.Dispatch<React.SetStateAction<string>>;
}

export const StepUserInfo: React.FC<StepUserInfoProps> = ({
  name,
  setName,
  grade,
  setGrade,
  gender,
  setGender,
  fieldOfStudy,
  setFieldOfStudy,
}) => {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl mb-2">Tell Us About Yourself</h2>
        <p className="text-gray-600">
          This helps us personalize your learning experience
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <Label htmlFor="name">Name (Optional)</Label>
          <Input
            id="name"
            placeholder="e.g., John Doe"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1.5"
          />
        </div>

        <div>
          <Label htmlFor="grade">Grade Level / Education Level</Label>
          <Input
            id="grade"
            placeholder="e.g., 10th Grade, College Sophomore, Graduate"
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
            className="mt-1.5"
          />
        </div>

        <div>
          <Label htmlFor="gender">Gender (Optional)</Label>
          <select
            id="gender"
            value={gender}
            onChange={(e) => setGender(e.target.value)}
            className="w-full mt-1.5 h-10 px-3 rounded-md border border-gray-200 bg-white"
          >
            <option value="">Select...</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="non-binary">Non-binary</option>
            <option value="prefer-not-to-say">Prefer not to say</option>
          </select>
        </div>

        <div>
          <Label htmlFor="field">Field of Study</Label>
          <Input
            id="field"
            placeholder="e.g., Mathematics, Biology, History, Computer Science"
            value={fieldOfStudy}
            onChange={(e) => setFieldOfStudy(e.target.value)}
            className="mt-1.5"
          />
        </div>
      </div>
    </div>
  );
};

