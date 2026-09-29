/** @jest-environment node */

import { providerPhotoSource } from "~/server/profile/provider-photo";

describe("providerPhotoSource", () => {
    it("asks Google for a 512px square instead of the 96px sign-up size", () => {
        expect(
            providerPhotoSource("https://lh3.googleusercontent.com/a/ACg8ocK-abc=s96-c")?.href
        ).toBe("https://lh3.googleusercontent.com/a/ACg8ocK-abc=s512-c");
        expect(providerPhotoSource("https://lh5.googleusercontent.com/a/xyz")?.href).toBe(
            "https://lh5.googleusercontent.com/a/xyz"
        );
    });

    it("asks GitHub for 512px", () => {
        expect(providerPhotoSource("https://avatars.githubusercontent.com/u/42?v=4")?.href).toBe(
            "https://avatars.githubusercontent.com/u/42?v=4&s=512"
        );
    });

    it.each([
        ["plain http", "http://lh3.googleusercontent.com/a/abc"],
        ["another host", "https://example.com/me.jpg"],
        ["a look-alike host", "https://lh3.googleusercontent.com.evil.test/a/abc"],
        ["a subdomain trick", "https://evil.test/lh3.googleusercontent.com/a"],
        ["an internal address", "https://169.254.169.254/latest/meta-data"],
        ["credentials in the URL", "https://user:pw@avatars.githubusercontent.com/u/1"],
        ["an explicit port", "https://avatars.githubusercontent.com:8443/u/1"],
        ["our own image route", "/api/profile-images/abc"],
        ["garbage", "not a url"],
    ])("refuses %s", (_label, raw) => {
        expect(providerPhotoSource(raw)).toBeNull();
    });

    it("refuses nothing at all", () => {
        expect(providerPhotoSource(null)).toBeNull();
        expect(providerPhotoSource("")).toBeNull();
    });
});
