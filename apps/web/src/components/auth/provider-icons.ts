/**
 * The mark beside each sign-in provider, on the sign-in page and in
 * Settings › Account. The deployment's own OIDC provider is a company's
 * identity provider with no brand of ours to draw, so it gets a key.
 */
import { KeyRound } from "lucide-react";

import { IconGithub, IconGoogle, IconMicrosoft } from "~/components/icons/brand";
import type { IconComponent } from "~/components/icons/types";
import type { SocialProviderId } from "~/lib/auth/providers";

export const PROVIDER_ICONS: Record<SocialProviderId, IconComponent> = {
    google: IconGoogle,
    microsoft: IconMicrosoft,
    github: IconGithub,
    oidc: KeyRound,
};

/** The mark for a provider id from an account row; a key for anything unknown. */
export function providerIcon(providerId: string): IconComponent {
    return PROVIDER_ICONS[providerId as SocialProviderId] ?? KeyRound;
}
