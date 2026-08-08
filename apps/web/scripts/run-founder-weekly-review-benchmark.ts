import dotenv from "dotenv";
import path from "path";

dotenv.config({
  path: path.resolve(import.meta.dirname, "../../../.env"),
});

import { generateFounderWeeklyReviewStructured } from "../src/server/founder-weekly-review/generation-adapter";
import { main } from "@launchstack/features/founder-weekly-review/benchmarks/run";

console.log(
  "OPENAI:",
  process.env.OPENAI_API_KEY ? "loaded" : "missing"
);

await main(generateFounderWeeklyReviewStructured);