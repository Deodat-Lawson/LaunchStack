import { eq } from "drizzle-orm";

import { company } from "@launchstack/store/schema";

import type { DemoLayer, ProgramDetails } from "~/app/employer/tools/accelerators/_lib/demo";
import { db } from "~/server/db";

import { NORTHWIND_FITS } from "./northwind-fits";
import { details as fiveHundredGlobal } from "./programs/500-global";
import { details as a16zSpeedrun } from "./programs/a16z-speedrun";
import { details as aboveA } from "./programs/abovea-startup-accelerator";
import { details as alchemist } from "./programs/alchemist";
import { details as antler } from "./programs/antler";
import { details as berkeleySkydeck } from "./programs/berkeley-skydeck";
import { details as entrepreneursFirst } from "./programs/entrepreneurs-first";
import { details as hax } from "./programs/hax";
import { details as massChallenge } from "./programs/masschallenge";
import { details as southParkCommons } from "./programs/south-park-commons";
import { details as techstarsLondon } from "./programs/techstars-london";
import { details as yCombinator } from "./programs/y-combinator";

/** Researched stand-ins for Workstream 1's richer Program records, keyed by catalogue id. */
const DEMO_DETAILS: Record<string, ProgramDetails> = {
    "500-global": fiveHundredGlobal,
    "a16z-speedrun": a16zSpeedrun,
    "abovea-startup-accelerator": aboveA,
    alchemist,
    antler,
    "berkeley-skydeck": berkeleySkydeck,
    "entrepreneurs-first": entrepreneursFirst,
    hax,
    masschallenge: massChallenge,
    "south-park-commons": southParkCommons,
    "techstars-london": techstarsLondon,
    "y-combinator": yCombinator,
};

/** The seeded workspace the illustrative fit was written for (see scripts/seed-accelerators-demo.ts). */
const NORTHWIND_WORKSPACE = "Accelerators Demo — Northwind fixture";

export async function loadDemoLayer(companyId: bigint): Promise<DemoLayer> {
    const [workspace] = await db
        .select({ name: company.name })
        .from(company)
        .where(eq(company.id, Number(companyId)))
        .limit(1);
    return {
        details: DEMO_DETAILS,
        fits: workspace?.name === NORTHWIND_WORKSPACE ? NORTHWIND_FITS : {},
    };
}
