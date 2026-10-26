/** @jest-environment node */
/** Synthetic transport doubles only; authenticated backend/SQL are tested separately. */
import { createDemoPersonalContextClient } from "~/app/employer/tools/vantage/demo-personal-client";

const originalFetch = globalThis.fetch;
const response = (body: unknown, status = 200) =>
    ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
afterEach(() => {
    globalThis.fetch = originalFetch;
});

it("loads the chosen week through same-origin authenticated requests without browser persistence", async () => {
    const view = { ready: false, blocker: "Canonical company context is unreviewed." };
    const fetch = jest.fn().mockResolvedValue(response(view));
    globalThis.fetch = fetch;
    const observer = { loaded: jest.fn(), invalidated: jest.fn(), unavailable: jest.fn() };
    expect(await createDemoPersonalContextClient("2026-10-12", observer).load()).toEqual(view);
    expect(fetch).toHaveBeenCalledWith("/api/vantage/demo/personal?week=2026-10-12", {
        credentials: "same-origin",
        cache: "no-store",
    });
    expect(observer.loaded).toHaveBeenCalledWith(view);
    expect(observer.unavailable).not.toHaveBeenCalled();
});

it("sends only controlled role choices and the exact CAS revision, never client identity", async () => {
    const fetch = jest.fn().mockResolvedValue(response({}));
    globalThis.fetch = fetch;
    const observer = { loaded: jest.fn(), invalidated: jest.fn(), unavailable: jest.fn() };
    const client = createDemoPersonalContextClient(undefined, observer);
    await client.saveRoles(
        Object.assign(
            {
                roleIds: ["founder", "engineering"],
                primaryRoleId: "engineering",
                expectedRevision: 4,
            },
            { companyId: "foreign-company", principalRef: "foreign-actor" }
        )
    );
    expect(JSON.parse(fetch.mock.calls[0]![1].body)).toEqual({
        operation: "roles",
        roleIds: ["founder", "engineering"],
        primaryRoleId: "engineering",
        expectedRevision: 4,
    });
    expect(observer.invalidated).toHaveBeenCalledTimes(1);
    expect(observer.loaded).not.toHaveBeenCalled();
});

it("preserves the full V0 document ID on star and unstar rather than inventing an ev ID", async () => {
    const fetch = jest.fn().mockResolvedValue(response({}));
    globalThis.fetch = fetch;
    const client = createDemoPersonalContextClient("2026-10-12");
    await client.setStar({
        documentId: "workspace-document/12",
        starred: true,
        expectedRevision: 2,
    });
    await client.setStar({
        documentId: "workspace-document/12",
        starred: false,
        expectedRevision: 3,
    });
    expect(fetch.mock.calls.map(call => JSON.parse(call[1].body))).toEqual([
        {
            operation: "star",
            documentId: "workspace-document/12",
            starred: true,
            expectedRevision: 2,
        },
        {
            operation: "star",
            documentId: "workspace-document/12",
            starred: false,
            expectedRevision: 3,
        },
    ]);
});

it("does not retry stale or unauthorized writes or expose the backend error body", async () => {
    const fetch = jest.fn().mockResolvedValue(response({ error: "PRIVATE_PROVIDER_DETAIL" }, 409));
    globalThis.fetch = fetch;
    const observer = { loaded: jest.fn(), invalidated: jest.fn(), unavailable: jest.fn() };
    await expect(
        createDemoPersonalContextClient(undefined, observer).saveRoles({
            roleIds: [],
            expectedRevision: 8,
        })
    ).rejects.toThrow("Personal context could not be saved. Reload before editing again.");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(observer.invalidated).toHaveBeenCalledTimes(1);
    expect(observer.unavailable).toHaveBeenCalledTimes(1);
});

it("fails a denied load without retaining or rendering the previous context body", async () => {
    const fetch = jest.fn().mockResolvedValue(response({ error: "PRIVATE_PROVIDER_DETAIL" }, 403));
    globalThis.fetch = fetch;
    const observer = { loaded: jest.fn(), invalidated: jest.fn(), unavailable: jest.fn() };
    await expect(createDemoPersonalContextClient(undefined, observer).load()).rejects.toThrow(
        "Personal context could not be loaded. Reload to check current access."
    );
    expect(observer.loaded).not.toHaveBeenCalled();
    expect(observer.unavailable).toHaveBeenCalledTimes(1);
});

it("does not let an older readiness response override a newer required-context failure", async () => {
    let resolveOld!: (response: Response) => void;
    globalThis.fetch = jest
        .fn()
        .mockImplementationOnce(
            () =>
                new Promise<Response>(resolve => {
                    resolveOld = resolve;
                })
        )
        .mockResolvedValueOnce(response({ ready: false, blocker: "Required source was revoked." }));
    const observer = { loaded: jest.fn(), invalidated: jest.fn(), unavailable: jest.fn() };
    const client = createDemoPersonalContextClient(undefined, observer);
    const old = client.load();
    await client.load();
    resolveOld(response({ ready: true }));
    await old;
    expect(observer.loaded).toHaveBeenCalledTimes(1);
    expect(observer.loaded).toHaveBeenCalledWith({
        ready: false,
        blocker: "Required source was revoked.",
    });
});
