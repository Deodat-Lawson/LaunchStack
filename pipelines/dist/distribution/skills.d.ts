export declare const DISTRIBUTION_PLAYBOOK_VERSION = "distribution-playbook/v1";
export type PlaybookName = "research" | "plan" | "score";
export interface Playbook {
    name: PlaybookName;
    version: string;
    /** sha256 over version + name + content. */
    hash: string;
    content: string;
}
export declare function loadPlaybook(name: PlaybookName): Playbook;
//# sourceMappingURL=skills.d.ts.map