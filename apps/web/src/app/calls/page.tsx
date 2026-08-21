import { CallsWorkspace } from "./_components/CallsWorkspace";
import { sampleCalls } from "./_fixtures/callSnapshots";

export default function CallsPage() {
    return <CallsWorkspace calls={sampleCalls} />;
}
