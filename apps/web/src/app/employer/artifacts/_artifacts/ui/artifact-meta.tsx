/**
 * Display metadata per artifact type — one place for the gallery, the viewer,
 * and the import dialog to agree on icons and labels.
 */

import type { ComponentType } from "react";
import {
    AppWindow,
    Atom,
    FileCode2,
    FileText,
    Shapes,
    Workflow,
    type LucideProps,
} from "lucide-react";

import type { ArtifactType } from "~/lib/artifact-content";

export interface ArtifactTypeMeta {
    label: string;
    Icon: ComponentType<LucideProps>;
    /** Whether the type has a rendered preview (vs. source-only). */
    previewable: boolean;
}

export const ARTIFACT_TYPE_META: Record<ArtifactType, ArtifactTypeMeta> = {
    html: { label: "HTML page", Icon: AppWindow, previewable: true },
    svg: { label: "SVG", Icon: Shapes, previewable: true },
    markdown: { label: "Markdown", Icon: FileText, previewable: true },
    mermaid: { label: "Mermaid", Icon: Workflow, previewable: true },
    react: { label: "React", Icon: Atom, previewable: false },
    code: { label: "Code", Icon: FileCode2, previewable: false },
};

export function artifactTypeMeta(type: string): ArtifactTypeMeta {
    return ARTIFACT_TYPE_META[type as ArtifactType] ?? ARTIFACT_TYPE_META.code;
}

export function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
