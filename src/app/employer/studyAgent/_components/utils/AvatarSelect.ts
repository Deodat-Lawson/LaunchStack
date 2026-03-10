import { type LearningMode } from "../OnboardingScreen/types";

export type AvatarRole = "buddy" | "teacher";
export type AvatarGender = "men" | "women";

const AVATARS: Record<AvatarRole, Record<AvatarGender, readonly string[]>> = {
  buddy: {
    men: [
      "/study-buddy-icon/men/icon1.png",
      "/study-buddy-icon/men/icon2.png",
    ],
    women: [
      "/study-buddy-icon/women/icon1.png",
      "/study-buddy-icon/women/icon2.png",
      "/study-buddy-icon/women/icon3.png",
    ],
  },
  teacher: {
    men: [
      "/teacher-icon/men/icon1.png",
      "/teacher-icon/men/icon2.png",
    ],
    women: [
      "/teacher-icon/women/icon1.png",
    ],
  },
} as const;

function pickAvatar(role: AvatarRole, gender: AvatarGender): string {
  const list = AVATARS[role][gender];
  if (!list || list.length === 0) return "/study-buddy-icon/women/icon1.png";
  const item = list[Math.floor(Math.random() * list.length)];
  return item ?? "/study-buddy-icon/women/icon1.png";
}

export function getAvatarUrl(aiGender: string, mode: LearningMode): string {
  const normalized = aiGender?.toLowerCase?.() ?? "";
  if (mode === "study-buddy") {
    if (normalized.startsWith("male")) return pickAvatar("buddy", "men");
    else return pickAvatar("buddy", "women");
  } else {
    if (normalized.startsWith("male")) return pickAvatar("teacher", "men");
    else return pickAvatar("teacher", "women");
  }
}
