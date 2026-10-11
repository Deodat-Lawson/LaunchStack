/**
 * Every Brand feature follows the scope LinkedIn granted, never an assumed
 * product: the same code serves a self-serve app (profiles only) and a
 * Community Management app (Pages, numbers, comments).
 */
import { channelCapabilities, linkedInGrantFeatures } from "~/server/brand/capabilities";

const SELF_SERVE = "openid profile email w_member_social";
const COMMUNITY =
    "r_basicprofile w_member_social rw_organization_admin w_organization_social r_organization_social r_organization_followers";

describe("linkedInGrantFeatures", () => {
    it("a self-serve app posts as the member and nothing else", () => {
        expect(linkedInGrantFeatures(SELF_SERVE)).toEqual({
            memberPosting: true,
            pages: false,
            pagePosting: false,
            pageAnalytics: false,
            pageComments: false,
        });
    });

    it("a Community Management app manages Pages", () => {
        expect(linkedInGrantFeatures(COMMUNITY)).toEqual({
            memberPosting: true,
            pages: true,
            pagePosting: true,
            pageAnalytics: true,
            pageComments: true,
        });
    });

    it("accepts the newer *_feed scopes and comma-separated lists", () => {
        const features = linkedInGrantFeatures(
            "r_organization_admin,w_organization_social_feed,r_organization_social_feed"
        );
        expect(features.pages).toBe(true);
        expect(features.pagePosting).toBe(true);
        expect(features.pageComments).toBe(true);
        // Numbers need rw_organization_admin.
        expect(features.pageAnalytics).toBe(false);
    });
});

describe("channelCapabilities", () => {
    it("a Page's numbers need the ADMINISTRATOR role as well as the scope", () => {
        expect(channelCapabilities("linkedin", "organization", COMMUNITY, "ADMINISTRATOR")).toEqual(
            {
                publish: true,
                images: true,
                analytics: true,
                comments: true,
            }
        );
        expect(
            channelCapabilities("linkedin", "organization", COMMUNITY, "CONTENT_ADMINISTRATOR")
                .analytics
        ).toBe(false);
    });

    it("a member profile publishes with images but reads nothing back yet", () => {
        expect(channelCapabilities("linkedin", "person", SELF_SERVE)).toEqual({
            publish: true,
            images: true,
            analytics: false,
            comments: false,
        });
    });

    it("a profile without w_member_social cannot publish", () => {
        expect(channelCapabilities("linkedin", "person", "openid profile").publish).toBe(false);
    });

    it("Bluesky does everything with an app password", () => {
        expect(channelCapabilities("bluesky", "account", [])).toEqual({
            publish: true,
            images: true,
            analytics: true,
            comments: true,
        });
    });
});
