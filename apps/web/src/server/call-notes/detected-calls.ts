import type {
    CallListQuery,
    DetectedCallCandidate,
    DetectedCallSource,
} from "@launchstack/features/call-notes";

/**
 * Local audio capture creates Calls directly, so there are no external
 * occurrences to surface in the detected-calls list.
 */
export class LocalDetectedCallSource implements DetectedCallSource {
    async list(_query: CallListQuery): Promise<readonly DetectedCallCandidate[]> {
        return [];
    }
}
