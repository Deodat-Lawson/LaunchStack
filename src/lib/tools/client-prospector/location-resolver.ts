// Location resolver for the Client Prospector pipeline.
//
// Converts a SearchLocation (either LatLng or a city/region string)
// into concrete lat/lng coordinates. LatLng inputs pass through unchanged.
// String inputs are geocoded via a lightweight OpenAI call — this avoids
// needing a separate geocoding API key.

import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { LatLngSchema } from "~/lib/tools/client-prospector/types";
import type { LatLng, SearchLocation } from "~/lib/tools/client-prospector/types";

// ─── Structured output schema for geocoding ──────────────────────────────────

const GeocodingOutputSchema = z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    resolvedName: z.string().describe("The full name of the resolved location"),
});

// ─── Prompts ─────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a geocoding assistant. Given a location name (city, region, address, or landmark), return the latitude and longitude coordinates for that location.

RULES:
1. Return the most commonly accepted coordinates for the location.
2. For cities, return the city center coordinates.
3. For regions or states, return the approximate geographic center.
4. If the location is ambiguous, pick the most well-known interpretation.
5. If the location is completely unrecognizable or nonsensical, return lat: 0, lng: 0 and set resolvedName to "UNKNOWN".`;

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Resolves a SearchLocation to concrete LatLng coordinates.
 *
 * - If the input is already a LatLng object, returns it unchanged.
 * - If the input is a string, geocodes it via an LLM call.
 * - Throws a descriptive error if geocoding fails.
 */
export async function resolveLocation(location: SearchLocation): Promise<LatLng> {
    // Fast path: already lat/lng coordinates
    const parsed = LatLngSchema.safeParse(location);
    if (parsed.success) {
        return parsed.data;
    }

    // Must be a string — geocode it
    if (typeof location !== "string") {
        throw new Error("Invalid location: expected a LatLng object or a location string.");
    }

    const trimmed = location.trim();
    if (trimmed.length === 0) {
        throw new Error("Invalid location: location string cannot be empty.");
    }

    const chat = new ChatOpenAI({
        openAIApiKey: process.env.OPENAI_API_KEY,
        modelName: "gpt-4o-mini",
        temperature: 0,
    });

    const structuredModel = chat.withStructuredOutput(GeocodingOutputSchema, {
        name: "geocode_location",
    });

    const response = await structuredModel.invoke([
        new SystemMessage(SYSTEM_PROMPT),
        new HumanMessage(`Geocode this location: "${trimmed}"`),
    ]);

    // Check for the "UNKNOWN" sentinel
    if (response.resolvedName === "UNKNOWN" || (response.lat === 0 && response.lng === 0)) {
        throw new Error(
            `Could not geocode location: "${trimmed}". Please provide valid coordinates as { lat, lng } or a recognizable city/region name.`
        );
    }

    return { lat: response.lat, lng: response.lng };
}
