"use client";

/**
 * Document defaults — what a new document gets unless someone says otherwise.
 *
 * Body only. Gathers settings that used to live on the upload screen (the
 * storage preference) and in nobody's hands (processing method, destination
 * folder, Google Doc on create) into registry rows. The processing options
 * are narrowed to the OCR providers this server actually has, read from the
 * same bootstrap the upload dialog uses.
 */

import React, { useEffect, useState } from "react";

import { Card, Section } from "~/components/layout/page-shell";
import { getSetting, type SettingDefinition } from "~/lib/settings/registry";
import type { SettingOption } from "~/lib/settings/types";

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

export function DocumentDefaultsSection(_: SettingsSectionProps) {
    const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);

    useEffect(() => {
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
    }, []);

    const providers = bootstrap?.availableProviders;
    const hasAnyOcr = providers
        ? providers.azure || providers.landingAI || providers.datalab || providers.docling
        : true;

    const processingOptions = (
        definition: SettingDefinition
    ): readonly SettingOption[] | undefined => {
        if (definition.control.kind !== "select" || !providers) return undefined;
        const allowed = new Set<string>(["standard"]);
        if (hasAnyOcr) allowed.add("auto");
        if (providers.azure) allowed.add("azure");
        if (providers.landingAI) allowed.add("landing_ai");
        if (providers.datalab) allowed.add("datalab");
        if (providers.docling) allowed.add("docling");
        return definition.control.options.filter(option => allowed.has(String(option.value)));
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
                description="Pre-filled in the upload dialog; the person uploading can still change either per batch. Folders may override the processing method for what lands in them."
            >
                <Card>
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
