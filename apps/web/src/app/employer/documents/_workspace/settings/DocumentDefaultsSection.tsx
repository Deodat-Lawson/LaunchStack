"use client";

/**
 * Document defaults — what a new document gets unless someone says otherwise.
 *
 * Body only. Gathers settings that used to live on the upload screen (the
 * storage preference) and in nobody's hands (processing method, destination
 * folder, Google Doc on create) into registry rows. The processing options
 * are narrowed to the OCR providers this server actually has — Docling only
 * while docling-serve answers — read from the same bootstrap the upload
 * dialog uses, and Automatic spells out the order those providers run in.
 * The method is applied server-side to every new PDF that arrives without an
 * explicit choice (uploads, Drive and Gmail imports, new versions).
 */

import React, { useEffect, useState } from "react";

import { Card, Section } from "~/components/layout/page-shell";
import { getSetting, type SettingDefinition } from "~/lib/settings/registry";
import type { SettingOption } from "~/lib/settings/types";
import { usePermissions } from "~/lib/use-permissions";

import type { SettingsSectionProps } from "./contract";
import { SettingRow } from "./SettingRow";
import { StatusNote } from "./ui";

interface Bootstrap {
    categories: { id: string; name: string }[];
    isUploadThingConfigured: boolean;
    availableProviders: { azure: boolean; datalab: boolean; landingAI: boolean; docling: boolean };
    storageProvider: "s3" | "database";
}

const PROCESSING_DEFINITION = getSetting("documents.defaultProcessingMethod")!;

/** The automatic order as it runs on this server (the converter's order, minus what is not set up). */
function automaticDescription(providers: Bootstrap["availableProviders"]): string {
    const order = [
        providers.azure && "Azure",
        providers.docling && "Docling",
        providers.landingAI && "Landing AI",
        providers.datalab && "Datalab",
    ].filter((name): name is string => Boolean(name));
    if (order.length === 0) {
        return "No OCR service is set up on this server, so this reads only the text already inside the PDF.";
    }
    const [first, ...rest] = order;
    const fallback = rest.length > 0 ? `, then ${rest.join(", then ")} if it fails` : "";
    return `${first} reads every page${fallback}. The PDF's own text is the last resort.`;
}

export function DocumentDefaultsSection(_: SettingsSectionProps) {
    const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
    // The narrowed options matter only to someone who may pick one, and the
    // bootstrap is refused to everyone else; their read-only rows keep the
    // registry's full lists.
    const { loaded, can } = usePermissions();
    const mayEdit = loaded && can("settings.manage");

    useEffect(() => {
        if (!mayEdit) return;
        let cancelled = false;
        void (async () => {
            try {
                const res = await fetch("/api/employer/upload/bootstrap");
                if (!res.ok) return;
                const body = (await res.json()) as Bootstrap;
                if (!cancelled) setBootstrap(body);
            } catch {
                // Rows fall back to the registry's full option lists.
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [mayEdit]);

    const providers = bootstrap?.availableProviders;
    const hasAnyOcr = providers
        ? providers.azure || providers.landingAI || providers.datalab || providers.docling
        : true;

    const processingOptions = (
        definition: SettingDefinition
    ): readonly SettingOption[] | undefined => {
        if (definition.control.kind !== "select" || !providers) return undefined;
        const allowed = new Set<string>(["auto", "standard"]);
        if (providers.azure) allowed.add("azure");
        if (providers.landingAI) allowed.add("landing_ai");
        if (providers.datalab) allowed.add("datalab");
        if (providers.docling) allowed.add("docling");
        return definition.control.options
            .filter(option => allowed.has(String(option.value)))
            .map(option =>
                option.value === "auto"
                    ? { ...option, description: automaticDescription(providers) }
                    : option
            );
    };

    const s3 = bootstrap?.storageProvider === "s3";

    return (
        <>
            <Section
                title="Storage"
                description="Where the bytes of a new upload go. Existing documents stay where they are."
            >
                <Card>
                    {s3 && (
                        <StatusNote tone="muted">
                            This server stores uploads in S3; the preference below is ignored while
                            that is configured.
                        </StatusNote>
                    )}
                    <SettingRow
                        settingKey="documents.uploadStorage"
                        disabledReason={
                            s3
                                ? "S3 is configured on the server."
                                : bootstrap && !bootstrap.isUploadThingConfigured
                                  ? "UPLOADTHING_TOKEN is not set on the server, so only the built-in storage is available."
                                  : null
                        }
                    />
                </Card>
            </Section>

            <Section
                title="Processing and destination"
                description="The processing method applies to new PDFs — uploads, Drive and Gmail imports, and new versions — unless the person adding one picks otherwise or a folder overrides it for what lands there."
            >
                <Card>
                    {providers && !hasAnyOcr && (
                        <StatusNote tone="muted">
                            No OCR service is reachable on this server, so every method reads only
                            the text already inside a PDF. Set AZURE_DOC_INTELLIGENCE_ENDPOINT and
                            AZURE_DOC_INTELLIGENCE_KEY, or run docling-serve, to turn OCR on.
                        </StatusNote>
                    )}
                    <SettingRow
                        settingKey="documents.defaultProcessingMethod"
                        options={processingOptions(PROCESSING_DEFINITION)}
                    />
                    <SettingRow settingKey="documents.defaultFolder">
                        {bootstrap && bootstrap.categories.length > 0 && (
                            <div className="text-ink-3 mt-1.5 text-[11.5px]">
                                Existing folders:{" "}
                                {bootstrap.categories
                                    .slice(0, 8)
                                    .map(c => c.name)
                                    .join(", ")}
                                {bootstrap.categories.length > 8 ? ", …" : ""}
                            </div>
                        )}
                    </SettingRow>
                </Card>
            </Section>

            <Section title="Creating" description="What the Create menu opens on.">
                <Card>
                    <SettingRow settingKey="documents.createNativeGoogleDoc" />
                </Card>
            </Section>
        </>
    );
}
