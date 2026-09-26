/** Serializable workspace chip for employer chrome (the account menu, the Settings card). */
export type WorkspaceSwitcherPayload = {
    name: string;
    initials: string;
    swatch: number | null;
    membershipCount: number;
};
