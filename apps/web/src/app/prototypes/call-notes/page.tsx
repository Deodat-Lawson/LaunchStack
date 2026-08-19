import { CallNotesPrototype } from "./CallNotesPrototype";

type SearchParams = {
    scenario?: string | string[];
};

export default async function CallNotesPrototypePage({
    searchParams,
}: {
    searchParams: Promise<SearchParams>;
}) {
    const params = await searchParams;
    const routeScenario = Array.isArray(params.scenario) ? params.scenario[0] : params.scenario;
    const initialScenario =
        routeScenario === "failure" || routeScenario === "review" || routeScenario === "detected"
            ? routeScenario
            : undefined;
    return <CallNotesPrototype initialScenario={initialScenario} />;
}
