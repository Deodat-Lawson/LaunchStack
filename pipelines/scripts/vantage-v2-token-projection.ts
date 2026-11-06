import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { GenerationCompoundSchemaV2 } from "../src/vantage/generation-v2-schema";

const require = createRequire(import.meta.url);
const core = require.resolve("@langchain/core", { paths: [path.resolve("pipelines")] });
const tokenizer = require(require.resolve("js-tiktoken", { paths: [path.dirname(core)] })) as {
    getEncoding(name: string): { encode(value: string): number[] };
};
const enc = tokenizer.getEncoding("o200k_base");
const root = path.resolve("fixtures/vantage-generation-v2");
const read = (n: string) => GenerationCompoundSchemaV2.parse(JSON.parse(fs.readFileSync(path.join(root, n + ".compound.json"), "utf8")) as unknown);
const cases = ["C02", "C05", "V2-04"];
const count = (value: unknown) => enc.encode(JSON.stringify(value)).length;
const results = cases.map(id => ({ id, tokens: count(read(id)) }));
const projection = read("C05");
projection.experimental.topics = cases.map(id => {
    const topic = read(id).experimental.topics[0];
    if (!topic) throw new Error("Missing projection topic: " + id);
    return topic;
});
for (const topic of projection.experimental.topics) {
    topic.whyItMatters += " This decision affects timing and feasibility and depends on evidence available to the reviewer.";
    topic.rationale = (topic.rationale + " The question is timely and its current status needs confirmation before choosing a response.").slice(0, 240);
    if (topic.recommendation) topic.recommendation.because = (topic.recommendation.because + " This is provisional; the proposed check may support a different choice.").slice(0, 240);
    topic.unknowns.push("Current status, practical constraints and the evidence available to the reviewer need confirmation.");
}
const maxTopicTokens = count(projection);
console.log(JSON.stringify({tokenizer:"js-tiktoken/o200k_base",providerMappingVerified:false,cap:2400,warningAt:2040,serialization:"entire compact native+experimental JSON",examples:results,threeTopicSizingOnly:{tokens:maxTopicTokens,fractionOfCap:maxTopicTokens/2400,warning:maxTopicTokens>2040,note:"Distinct mixed-case topics at realistic lengths. Sizing only; not a coherent or validated evidence report."}},null,2));
