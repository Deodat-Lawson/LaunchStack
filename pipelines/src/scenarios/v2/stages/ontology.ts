/**
 * `ontology` (graph mode) — PlanOntology. The model reads the scenario goal,
 * the manifest, passages from every selected document and the typed-fact
 * keys, starts from BASE_ONTOLOGY and proposes only the extensions the
 * evidence motivates. Code validates them; errors go back to the model
 * within the repair allowance, and a schema that is still invalid falls back
 * to the base with the errors kept. The result is frozen with its hash.
 */
import { extractJson } from "@launchstack/simulation";

import { SCENARIO_MODELS } from "../../model";
import {
    BASE_ONTOLOGY,
    ONTOLOGY_LIMITS,
    RESERVED_ONTOLOGY_NAMES,
    type OntologyAttribute,
    type OntologyAttributeType,
    type OntologyEdgeType,
    type OntologyEntityType,
    type OntologySchema,
    type OntologySpec,
} from "../contracts";
import { hashOf } from "../hash";
import type { Stage } from "../stage";
import { asArray, asRecord, asString, requireManifest } from "./common";
import { buildOntologyRequest, withRepair } from "./prompts";

const PASCAL = /^[A-Z][A-Za-z0-9]*$/;
const SCREAMING = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;
const SNAKE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const ATTRIBUTE_TYPES: readonly OntologyAttributeType[] = ["string", "number", "boolean"];
const RESERVED = new Set(RESERVED_ONTOLOGY_NAMES.map(n => n.toLowerCase()));

export interface OntologyValidation {
    schema: OntologySchema;
    errors: string[];
}

function text(value: unknown): string {
    return (asString(value) ?? "").trim();
}

/** `named` already names the thing (Entity type "Contract"); `unnamed` is for a missing name. */
function checkName(
    errors: string[],
    named: string,
    unnamed: string,
    name: string,
    pattern: RegExp,
    example: string
): void {
    if (!name) {
        errors.push(`${unnamed} has no name.`);
        return;
    }
    if (name.length > ONTOLOGY_LIMITS.nameMax)
        errors.push(`${named} is longer than ${ONTOLOGY_LIMITS.nameMax} characters.`);
    if (!pattern.test(name)) errors.push(`${named} must be written like "${example}".`);
    if (RESERVED.has(name.toLowerCase()))
        errors.push(`${named} uses a reserved name; pick another.`);
}

function checkDescription(errors: string[], what: string, description: string): void {
    if (!description) errors.push(`${what} has no description.`);
    else if (description.length > ONTOLOGY_LIMITS.descriptionMax)
        errors.push(
            `${what}'s description is longer than ${ONTOLOGY_LIMITS.descriptionMax} characters.`
        );
}

function readAttributes(errors: string[], owner: string, raw: unknown): OntologyAttribute[] {
    if (raw !== undefined && !Array.isArray(raw)) {
        errors.push(`${owner}'s attributes must be a list.`);
        return [];
    }
    const out: OntologyAttribute[] = [];
    const names = new Set<string>();
    const list = asArray(raw);
    if (list.length > ONTOLOGY_LIMITS.attributesPerType)
        errors.push(
            `${owner} has ${list.length} attributes; at most ${ONTOLOGY_LIMITS.attributesPerType} are allowed.`
        );
    for (const item of list) {
        const a = asRecord(item);
        if (!a) {
            errors.push(`${owner} has an attribute that is not an object.`);
            continue;
        }
        const name = text(a.name);
        const what = `Attribute "${name}" of ${owner}`;
        checkName(errors, what, `An attribute of ${owner}`, name, SNAKE, "renewal_date");
        if (name && names.has(name.toLowerCase()))
            errors.push(`${owner} lists the attribute "${name}" twice.`);
        names.add(name.toLowerCase());
        const type = text(a.type) as OntologyAttributeType;
        if (!ATTRIBUTE_TYPES.includes(type))
            errors.push(`${what} has type "${type}"; use "string", "number" or "boolean".`);
        const description = text(a.description);
        checkDescription(errors, what, description);
        out.push({ name, type, description });
    }
    return out;
}

/**
 * Merge proposed extensions into the base schema and list every rule they
 * break. `evidenceIds` are the manifest's ids: an extension must name the
 * passage that motivated it.
 */
export function validateOntology(reply: unknown, evidenceIds: Set<string>): OntologyValidation {
    const errors: string[] = [];
    const root = asRecord(reply);
    if (!root) return { schema: BASE_ONTOLOGY, errors: ["The reply was not a JSON object."] };

    const entityNames = new Map<string, string>(
        BASE_ONTOLOGY.entities.map(e => [e.name.toLowerCase(), e.name])
    );
    const edgeNames = new Map<string, string>(
        BASE_ONTOLOGY.edges.map(e => [e.name.toLowerCase(), e.name])
    );
    const motivation = (what: string, raw: unknown): string | null => {
        const id = text(raw).toUpperCase();
        if (!id) {
            errors.push(`${what} names no motivating evidence id.`);
            return null;
        }
        if (!evidenceIds.has(id))
            errors.push(`${what} names evidence "${id}", which is not in the evidence list.`);
        return id;
    };

    const entities: OntologyEntityType[] = [];
    for (const item of asArray(root.entities)) {
        const e = asRecord(item);
        if (!e) {
            errors.push("An entity type is not an object.");
            continue;
        }
        const name = text(e.name);
        const what = `Entity type "${name}"`;
        checkName(errors, what, "An entity type", name, PASCAL, "Contract");
        const clash = entityNames.get(name.toLowerCase());
        if (name && clash)
            errors.push(
                `${what} repeats the ${BASE_ONTOLOGY.entities.some(b => b.name === clash) ? "base " : ""}type "${clash}".`
            );
        if (name) entityNames.set(name.toLowerCase(), name);
        const description = text(e.description);
        checkDescription(errors, what, description);
        entities.push({
            name,
            description,
            attributes: readAttributes(errors, what, e.attributes),
            origin: "extension",
            motivatingEvidenceId: motivation(what, e.motivatingEvidenceId),
        });
    }

    const defined = new Set([...BASE_ONTOLOGY.entities, ...entities].map(e => e.name));
    const edges: OntologyEdgeType[] = [];
    for (const item of asArray(root.edges)) {
        const e = asRecord(item);
        if (!e) {
            errors.push("An edge type is not an object.");
            continue;
        }
        const name = text(e.name);
        const what = `Edge type "${name}"`;
        checkName(errors, what, "An edge type", name, SCREAMING, "MIGRATES_FROM");
        const clash = edgeNames.get(name.toLowerCase());
        if (name && clash) errors.push(`${what} repeats the type "${clash}".`);
        if (name) edgeNames.set(name.toLowerCase(), name);
        const description = text(e.description);
        checkDescription(errors, what, description);
        const endpoints: OntologyEdgeType["endpoints"] = [];
        const rawEndpoints = asArray(e.endpoints);
        if (rawEndpoints.length === 0) errors.push(`${what} lists no endpoints.`);
        if (rawEndpoints.length > ONTOLOGY_LIMITS.endpointsPerEdge)
            errors.push(
                `${what} lists ${rawEndpoints.length} endpoints; at most ${ONTOLOGY_LIMITS.endpointsPerEdge} are allowed.`
            );
        for (const rawPair of rawEndpoints) {
            const pair = asRecord(rawPair);
            const source = text(pair?.source);
            const target = text(pair?.target);
            for (const end of [source, target]) {
                if (!defined.has(end))
                    errors.push(
                        `${what} has the endpoint "${end}", which is not a defined entity type.`
                    );
            }
            endpoints.push({ source, target });
        }
        edges.push({
            name,
            description,
            attributes: readAttributes(errors, what, e.attributes),
            endpoints,
            origin: "extension",
            motivatingEvidenceId: motivation(what, e.motivatingEvidenceId),
        });
    }

    const schema: OntologySchema = {
        entities: [...BASE_ONTOLOGY.entities, ...entities],
        edges: [...BASE_ONTOLOGY.edges, ...edges],
    };
    if (schema.entities.length > ONTOLOGY_LIMITS.entityTypes)
        errors.push(
            `There are ${schema.entities.length} entity types in all; at most ${ONTOLOGY_LIMITS.entityTypes} are allowed.`
        );
    if (schema.edges.length > ONTOLOGY_LIMITS.edgeTypes)
        errors.push(
            `There are ${schema.edges.length} edge types in all; at most ${ONTOLOGY_LIMITS.edgeTypes} are allowed.`
        );
    return { schema, errors: [...new Set(errors)] };
}

export const ontologyStage: Stage = async ctx => {
    const manifest = await requireManifest(ctx);
    const evidenceIds = new Set(manifest.items.map(i => i.id));
    const request = buildOntologyRequest({ subject: ctx.spec.subject, items: manifest.items });

    let reply = await ctx.model.complete(request);
    let result = validateOntology(extractJson(reply.text), evidenceIds);
    let repairs = 0;
    while (result.errors.length > 0 && repairs < ctx.spec.budget.repairsPerUnit) {
        repairs += 1;
        reply = await ctx.model.complete(withRepair(request, reply.text, result.errors));
        result = validateOntology(extractJson(reply.text), evidenceIds);
    }
    const ok = result.errors.length === 0;
    const schema = ok ? result.schema : BASE_ONTOLOGY;
    if (!ok)
        ctx.ports.log?.("scenario ontology fell back to the base schema", {
            runId: ctx.run.id,
            errors: result.errors.length,
        });
    const spec: OntologySpec = {
        version: 1,
        schema,
        sourceManifestHash: manifest.manifestHash,
        plannerPromptVersion: ctx.spec.policies.versions.ontologyPlanner,
        plannerModel: `route:${SCENARIO_MODELS.ontology.route}`,
        validation: { ok, errors: result.errors, repairs },
        ontologyHash: hashOf(schema),
    };
    return {
        output: {
            ontologyHash: spec.ontologyHash,
            ok,
            repairs,
            extensions:
                schema.entities.filter(e => e.origin === "extension").length +
                schema.edges.filter(e => e.origin === "extension").length,
        },
        writes: [{ type: "ontology_spec", spec }],
    };
};
