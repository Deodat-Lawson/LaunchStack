import { inviteDestination } from "~/lib/invite-link";

describe("inviteDestination", () => {
    const code = "3f9a2b7c0d1e4f5a6b7c8d9e0f1a2b3c";

    it("takes a join link from any host and keeps only its path", () => {
        expect(inviteDestination(`https://app.example.com/join/${code}`)).toBe(`/join/${code}`);
        expect(inviteDestination(`app.example.com/join/${code.toUpperCase()}/`)).toBe(
            `/join/${code}`
        );
    });

    it("takes a bare code, dashed or spaced as people retype it", () => {
        expect(inviteDestination("ABCD-1234")).toBe("/join/abcd1234");
        expect(inviteDestination(` ${code} `)).toBe(`/join/${code}`);
    });

    it("takes the legacy /signup?code= link", () => {
        expect(inviteDestination("http://localhost:3000/signup?code=ABCD1234")).toBe(
            "/join/abcd1234"
        );
    });

    it("takes an invitation link with its case-sensitive token intact", () => {
        const token = "Ab_cD-ef0123456789xyzQRS";
        expect(inviteDestination(`https://x.test/invite/${token}`)).toBe(`/invite/${token}`);
    });

    it("refuses anything else", () => {
        expect(inviteDestination("")).toBeNull();
        expect(inviteDestination("hello there")).toBeNull();
        expect(inviteDestination("https://x.test/employer/documents")).toBeNull();
        expect(inviteDestination("https://x.test/join/../../etc")).toBeNull();
    });
});
