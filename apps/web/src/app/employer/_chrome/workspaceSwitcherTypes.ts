/** Serializable workspace chip for employer chrome (e.g. AvatarMenu). */
export type WorkspaceSwitcherPayload = {
  name: string;
  initials: string;
  swatch: number | null;
  membershipCount: number;
};
