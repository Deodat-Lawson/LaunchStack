"use client";

import { useEffect } from "react";

import { writeTimeZone } from "./client";

/**
 * Writes the browser's time zone into the cookie ./request.ts reads, so a
 * date rendered on the server reads the same as it will after hydration.
 * The first visit renders in the server's zone; every one after is right.
 * Renders nothing. Mounted once, in the root layout.
 */
export function TimeZoneSync() {
    useEffect(() => {
        writeTimeZone();
    }, []);
    return null;
}
