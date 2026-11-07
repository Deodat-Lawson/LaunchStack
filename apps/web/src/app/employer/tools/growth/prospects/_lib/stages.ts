import type { SalesStage } from "../api";

/** Forward order of the funnel; lost and nurture are side exits. */
export const FUNNEL_STAGES: SalesStage[] = [
    "lead",
    "qualified",
    "contacted",
    "meeting",
    "proposal",
    "negotiating",
    "won",
];

export const EXIT_STAGES: SalesStage[] = ["lost", "nurture"];

/*
 * A stage's name is `growth.prospects.stages.<stage>` in the catalogue:
 * `useTranslations("growth.prospects.stages")(stage)`.
 */

export type StageTone = "quiet" | "info" | "active" | "won" | "lost";

/** Which dot a stage gets. Accent is reserved for deals in motion. */
export function stageTone(stage: SalesStage): StageTone {
    switch (stage) {
        case "lead":
        case "nurture":
            return "quiet";
        case "qualified":
            return "info";
        case "contacted":
        case "meeting":
        case "proposal":
        case "negotiating":
            return "active";
        case "won":
            return "won";
        case "lost":
            return "lost";
    }
}

export function isInMotion(stage: SalesStage): boolean {
    return stageTone(stage) === "active";
}
