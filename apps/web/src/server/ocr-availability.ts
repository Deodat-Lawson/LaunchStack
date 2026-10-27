/**
 * Which OCR providers this deployment can run right now — for the settings
 * screen, the upload bootstrap and /api/config/ocr, so all three agree with
 * what ingestion will actually do. Credentials decide Azure, Landing AI and
 * Datalab; Docling counts only while the document converter reports
 * docling-serve answering (a configured URL is not enough). Reads the same
 * shared order the pipeline uses (@launchstack/conversion/ocr/provider-order).
 */

import { ocrAvailability, orderOcrEngines } from "@launchstack/conversion/ocr/provider-order";

import { getEngine } from "~/server/engine";

export interface OcrProviderAvailability {
    azure: boolean;
    datalab: boolean;
    landingAI: boolean;
    docling: boolean;
}

export interface OcrOverview {
    availableProviders: OcrProviderAvailability;
    /** The engines in the order an automatic document tries them. */
    order: string[];
}

export async function ocrOverview(): Promise<OcrOverview> {
    // Registers the OCR config slot on a cold process before it is read.
    getEngine();
    const availability = await ocrAvailability();
    return {
        availableProviders: {
            azure: availability.AZURE,
            datalab: availability.DATALAB,
            landingAI: availability.LANDING_AI,
            docling: availability.DOCLING,
        },
        order: orderOcrEngines(availability),
    };
}
