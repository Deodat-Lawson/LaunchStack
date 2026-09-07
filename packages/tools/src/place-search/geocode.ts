/**
 * Geocoding — a SearchLocation (coordinates or a place name) to LatLng.
 * Coordinates pass through; names are resolved with a lightweight structured
 * LLM call so no separate geocoding key is needed (the client-prospector
 * origin of this module).
 */
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { invokeStructured, resolveChatModel } from "@launchstack/llm";
import { z } from "zod";

import { ToolError } from "../contract";
import { LatLngSchema } from "./types";
import type { LatLng, SearchLocation } from "./types";

const GeocodingOutputSchema = z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    resolvedName: z.string().describe("The full name of the resolved location"),
});

const SYSTEM_PROMPT = `You are a geocoding assistant. Given a location name (city, region, address, or landmark), return the latitude and longitude coordinates for that location.

RULES:
1. Return the most commonly accepted coordinates for the location.
2. For cities, return the city center coordinates.
3. For regions or states, return the approximate geographic center.
4. If the location is ambiguous, pick the most well-known interpretation.
5. If the location is completely unrecognizable or nonsensical, return lat: 0, lng: 0 and set resolvedName to "UNKNOWN".`;

export async function geocodeLocation(location: SearchLocation): Promise<LatLng> {
    const parsed = LatLngSchema.safeParse(location);
    if (parsed.success) return parsed.data;

    if (typeof location !== "string") {
        throw new ToolError({
            code: "invalid_location",
            status: 400,
            message: "Invalid location: expected a LatLng object or a location string.",
        });
    }
    const trimmed = location.trim();
    if (trimmed.length === 0) {
        throw new ToolError({
            code: "invalid_location",
            status: 400,
            message: "Invalid location: location string cannot be empty.",
        });
    }

    const resolved = resolveChatModel({ route: "fast", temperature: 0 });
    const response = await invokeStructured(
        resolved,
        GeocodingOutputSchema,
        [new SystemMessage(SYSTEM_PROMPT), new HumanMessage(`Geocode this location: "${trimmed}"`)],
        { name: "geocode_location" }
    );

    if (response.resolvedName === "UNKNOWN" || (response.lat === 0 && response.lng === 0)) {
        throw new ToolError({
            code: "location_not_found",
            status: 400,
            message: `Could not geocode location: "${trimmed}". Please provide valid coordinates as { lat, lng } or a recognizable city/region name.`,
        });
    }
    return { lat: response.lat, lng: response.lng };
}
