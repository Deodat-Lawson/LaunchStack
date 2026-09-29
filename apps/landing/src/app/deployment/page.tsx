import { DeploymentGuide } from "./DeploymentGuide";
import { resolveGuide } from "./deploymentContent";

export default async function DeploymentPage({
    searchParams,
}: {
    searchParams: Promise<{ section?: string | string[] }>;
}) {
    const params = await searchParams;
    const section = Array.isArray(params.section) ? params.section[0] : params.section;
    return <DeploymentGuide guideId={resolveGuide(section).id} />;
}
