import { linkedInContext, linkedInRequest, readJson } from "./http";
import { LinkedInApiError, type LinkedInClientOptions, type LinkedInMember } from "./types";

interface UserInfo {
    sub?: string;
    name?: string;
    given_name?: string;
    family_name?: string;
    email?: string;
    picture?: string;
}

interface DisplayImageElement {
    identifiers?: Array<{ identifier?: string }>;
}

interface LegacyMe {
    id?: string;
    localizedFirstName?: string;
    localizedLastName?: string;
    profilePicture?: { "displayImage~"?: { elements?: DisplayImageElement[] } };
}

const ME_PROJECTION =
    "(id,localizedFirstName,localizedLastName,profilePicture(displayImage~:playableStreams))";

/**
 * The token's member: OpenID `/v2/userinfo` (scopes `openid profile email`),
 * falling back to `/v2/me` (r_basicprofile) when that is refused or fails.
 * Throws an authFailed LinkedInApiError when either endpoint rejects the
 * token outright; otherwise the `/v2/me` failure, explained.
 */
export async function getLinkedInMember(opts: LinkedInClientOptions): Promise<LinkedInMember> {
    const ctx = linkedInContext(opts);

    let userInfoError: LinkedInApiError | null = null;
    try {
        const res = await linkedInRequest(ctx, {
            path: "/v2/userinfo",
            what: "read who the token belongs to",
            versioned: false,
        });
        const info = await readJson<UserInfo>(res);
        if (info?.sub) {
            const name =
                info.name?.trim() ||
                [info.given_name, info.family_name].filter(Boolean).join(" ").trim() ||
                null;
            return {
                id: info.sub,
                urn: `urn:li:person:${info.sub}`,
                name,
                email: info.email?.trim() || null,
                pictureUrl: info.picture?.trim() || null,
            };
        }
    } catch (err) {
        if (!(err instanceof LinkedInApiError)) throw err;
        userInfoError = err;
    }

    try {
        const res = await linkedInRequest(ctx, {
            path: `/v2/me?projection=${ME_PROJECTION}`,
            what: "read the member profile",
            versioned: false,
            headers: { "X-Restli-Protocol-Version": "2.0.0" },
        });
        const me = await readJson<LegacyMe>(res);
        if (!me?.id) {
            throw new LinkedInApiError(
                "LinkedIn did not say who this token belongs to (no member id).",
                res.status,
                false,
                false
            );
        }
        const name =
            [me.localizedFirstName, me.localizedLastName].filter(Boolean).join(" ").trim() || null;
        return {
            id: me.id,
            urn: `urn:li:person:${me.id}`,
            name,
            email: null,
            pictureUrl: largestPicture(me),
        };
    } catch (err) {
        if (!(err instanceof LinkedInApiError)) throw err;
        if (err.authFailed) throw err;
        if (userInfoError?.authFailed) throw userInfoError;
        if (err.status === 403 && userInfoError?.status === 403) {
            throw new LinkedInApiError(
                "LinkedIn would not say who this token belongs to: it needs the `openid profile` scopes (Sign In with LinkedIn) or r_basicprofile.",
                403,
                false,
                false,
                err.body
            );
        }
        throw err;
    }
}

/** `displayImage~` streams come smallest first; the last is the largest. */
function largestPicture(me: LegacyMe): string | null {
    const elements = me.profilePicture?.["displayImage~"]?.elements ?? [];
    for (let i = elements.length - 1; i >= 0; i--) {
        const url = elements[i]?.identifiers?.[0]?.identifier;
        if (url) return url;
    }
    return null;
}
