/**
 * Trace what one policy asks, request by request, next to the oracle.
 *
 *   pnpm exec tsx experiments/company-search/e1-where-to-look/debug.ts <segment-id> <policy-id> [requests] [seed]
 *
 * Each entry reads word@box:results (a star marks a full page) => places known.
 */
import { policySet } from "../lib/bandits";
import { simulate, simulateOracle } from "../lib/discovery";
import { createEnv } from "./env";
import { loadWorld } from "./world";

const world = loadWorld(process.argv[2] ?? "dk-bicycle");
if (!world) throw new Error("No recording for that segment; run record.ts first.");
const policy = policySet().find(p => p.id === (process.argv[3] ?? "mined-thompson"));
if (!policy) throw new Error("Unknown policy id.");
const budget = Number(process.argv[4] ?? 24);
const seed = Number(process.argv[5] ?? 5);

const log: string[] = [];
const trace = simulate(
    createEnv(world, line => log.push(line)),
    policy,
    { budget, seed }
);
console.log(policy.id, log.map((line, i) => `${line}=>${trace.found[i]}`).join("  "));
log.length = 0;
const oracle = simulateOracle(
    createEnv(world, line => log.push(line)),
    budget
);
console.log("oracle", log.map((line, i) => `${line}=>${oracle.found[i]}`).join("  "));
