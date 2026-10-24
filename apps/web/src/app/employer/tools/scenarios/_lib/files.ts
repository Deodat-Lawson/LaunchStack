import { SCENARIO_LIMITS, type ScenarioFileOption } from "~/lib/scenarios/types";

/**
 * The new-scenario form's files, as plain functions: what kind a file is
 * (for its icon and label), which files are the company's own, which
 * uploads the form takes, and the size presets. Pinned by a unit test.
 */

/**
 * Where an upload from the form goes: beside the company's other files, the
 * folder onboarding fills, so the company profile and Ask can read it too.
 */
export const UPLOAD_FOLDER = "Company";

/** The documents a company keeps about itself: decks, plans, policies, price lists. */
export const UPLOAD_ACCEPT =
    ".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.md,.markdown,.txt,.html,.htm,.csv";

const ACCEPTED = new Set(UPLOAD_ACCEPT.split(","));

export function extensionOf(name: string): string {
    const clean = name.split(/[?#]/)[0] ?? name;
    const dot = clean.lastIndexOf(".");
    return dot > 0 ? clean.slice(dot).toLowerCase() : "";
}

export function acceptsUpload(name: string): boolean {
    return ACCEPTED.has(extensionOf(name));
}

export type FileKind =
    | "pdf"
    | "doc"
    | "slides"
    | "sheet"
    | "web"
    | "text"
    | "transcript"
    | "image"
    | "file";

export const FILE_KIND_LABEL: Record<FileKind, string> = {
    pdf: "PDF",
    doc: "Document",
    slides: "Slides",
    sheet: "Spreadsheet",
    web: "Web page",
    text: "Text",
    transcript: "Transcript",
    image: "Image",
    file: "File",
};

const KIND_BY_EXTENSION: Record<string, FileKind> = {
    ".pdf": "pdf",
    ".doc": "doc",
    ".docx": "doc",
    ".odt": "doc",
    ".rtf": "doc",
    ".pages": "doc",
    ".ppt": "slides",
    ".pptx": "slides",
    ".odp": "slides",
    ".key": "slides",
    ".xls": "sheet",
    ".xlsx": "sheet",
    ".ods": "sheet",
    ".csv": "sheet",
    ".tsv": "sheet",
    ".numbers": "sheet",
    ".html": "web",
    ".htm": "web",
    ".md": "text",
    ".markdown": "text",
    ".txt": "text",
    ".png": "image",
    ".jpg": "image",
    ".jpeg": "image",
    ".gif": "image",
    ".webp": "image",
};

function kindOfMime(mime: string): FileKind | null {
    if (mime === "application/pdf") return "pdf";
    if (mime.includes("presentation") || mime.includes("powerpoint")) return "slides";
    if (mime.includes("spreadsheet") || mime.includes("excel") || mime === "text/csv")
        return "sheet";
    if (mime.includes("wordprocessing") || mime === "application/msword" || mime.includes("rtf"))
        return "doc";
    if (mime === "text/html") return "web";
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("audio/") || mime.startsWith("video/")) return "transcript";
    if (mime === "text/markdown" || mime === "text/plain") return "text";
    return null;
}

/** The title's extension wins over a generic stored type ("text/plain" for a Markdown file). */
export function fileKind(file: Pick<ScenarioFileOption, "mimeType" | "title">): FileKind {
    if (/\(transcription\)/i.test(file.title)) return "transcript";
    const byName = KIND_BY_EXTENSION[extensionOf(file.title)];
    if (byName) return byName;
    if (/^https?:\/\//i.test(file.title)) return "web";
    const mime = file.mimeType?.split(";")[0]?.trim().toLowerCase();
    return mime ? (kindOfMime(mime) ?? "file") : "file";
}

/**
 * The company's own files: what the company profile counts as written by or
 * about the company, and anything filed in the Company folder.
 */
export function isCompanyFile(file: Pick<ScenarioFileOption, "aboutCompany" | "folder">): boolean {
    if (file.aboutCompany) return true;
    const folder = file.folder ?? "";
    return folder === UPLOAD_FOLDER || folder.startsWith(`${UPLOAD_FOLDER}/`);
}

export function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Find a file by its title or folder, company files first, then newest. */
export function filterFiles<T extends ScenarioFileOption>(files: readonly T[], query: string): T[] {
    const q = query.trim().toLowerCase();
    const shown = q
        ? files.filter(
              f => f.title.toLowerCase().includes(q) || (f.folder ?? "").toLowerCase().includes(q)
          )
        : [...files];
    return shown.sort((a, b) => Number(isCompanyFile(b)) - Number(isCompanyFile(a)));
}

export interface SizePreset {
    id: string;
    label: string;
    agents: number;
    rounds: number;
}

const L = SCENARIO_LIMITS;

export const SIZE_PRESETS: readonly SizePreset[] = [
    { id: "quick", label: "Quick read", agents: 15, rounds: 4 },
    { id: "standard", label: "Standard", agents: L.agents.default, rounds: L.rounds.default },
    { id: "deep", label: "Deep dive", agents: 80, rounds: 15 },
];

export function presetFor(agents: number, rounds: number): SizePreset | null {
    return SIZE_PRESETS.find(p => p.agents === agents && p.rounds === rounds) ?? null;
}

/** Situations to start from when the box is empty. */
export const SITUATION_STARTERS: readonly string[] = [
    "We raise prices 20% for new customers in January.",
    "A competitor launches a free version of our product.",
    "We move support from phone to chat only.",
    "We announce we are shutting down our oldest plan.",
];
