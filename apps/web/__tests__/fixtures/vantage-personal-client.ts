/** Joseph's synthetic preview client, retained only as an isolated component-test fixture. */
import {
    createPersonalContextFixtureV0,
    parsePersonalContextFixtureSeedV0,
    fixtureDocumentsV0,
    fixtureRequestV0,
} from "@launchstack/pipelines/vantage/role-context-v0/fixtures";
import {
    RequiredContextErrorV0,
    type PersonalContextStateV0,
} from "@launchstack/pipelines/vantage/role-context-v0";
import type { PersonalContextClientV0 } from "~/components/vantage-context/PersonalContextPanel";
const storageKey = "launchstack:synthetic-vantage-context:v0";
export function createPreviewClientV0(scenario: string, _instance = 0): PersonalContextClientV0 {
    void _instance; // New instance invalidates the prior synthetic in-memory snapshot on reset.
    let fixture: ReturnType<typeof createPersonalContextFixtureV0> | undefined;
    function getFixture() {
        if (!fixture) {
            let seed: PersonalContextStateV0[] = [];
            try {
                const saved = localStorage.getItem(storageKey);
                if (saved) {
                    const parsed: unknown = JSON.parse(saved);
                    seed = parsePersonalContextFixtureSeedV0(parsed);
                }
            } catch {
                /* Optional synthetic storage may be unavailable. */
            }
            fixture = createPersonalContextFixtureV0(seed);
            fixture.controls.architectureMissing = scenario === "missing-company";
            if (scenario === "revoked") fixture.controls.revoked.add("101");
        }
        return fixture;
    }
    function persist() {
        localStorage.setItem(storageKey, JSON.stringify(getFixture().store.snapshot()));
    }
    return {
        async load() {
            const f = getFixture();
            const state = await f.provider.readPersonalState(fixtureRequestV0);
            const roles = await f.provider.resolveBusinessRoles(fixtureRequestV0);
            let ready = true,
                diagnostics;
            try {
                diagnostics = (
                    await f.provider.prepareRequiredContext({
                        ...fixtureRequestV0,
                        roleContext: roles,
                    })
                ).diagnostics;
            } catch (error) {
                if (!(error instanceof RequiredContextErrorV0)) throw error;
                ready = false;
                diagnostics = error.diagnostics;
            }
            return {
                state,
                roles,
                diagnostics,
                ready,
                documents: fixtureDocumentsV0
                    .filter(doc => !f.controls.revoked.has(doc.id))
                    .map(doc => ({
                        id: doc.id,
                        title: doc.title,
                        version: doc.version,
                        sourceDate: doc.date,
                    })),
            };
        },
        async saveRoles(change) {
            await getFixture().provider.saveRoles(fixtureRequestV0, change);
            persist();
        },
        async setStar(change) {
            await getFixture().provider.setStar(fixtureRequestV0, change);
            persist();
        },
    };
}
