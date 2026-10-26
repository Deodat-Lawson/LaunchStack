/** @jest-environment jsdom */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
    PersonalContextPanel,
    type PersonalContextClientV0,
} from "~/components/vantage-context/PersonalContextPanel";
// Joseph's standalone page is deliberately not ported over the integrated demo.
import { createPreviewClientV0 } from "../fixtures/vantage-personal-client";

beforeAll(() => {
    if (!globalThis.structuredClone)
        globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));
});
beforeEach(() => {
    localStorage.clear();
});
it("confirms multiple roles and a primary perspective, persisting after a remount", async () => {
    const client = createPreviewClientV0("normal");
    const { unmount } = render(<PersonalContextPanel client={client} />);
    await screen.findByText("Suggested from your profile title. Review and save to confirm.");
    fireEvent.click(screen.getByRole("button", { name: /Make primary.*Engineering/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save roles" }));
    await screen.findByText("Your context choices were saved.");
    expect(
        screen.queryByText("Suggested from your profile title. Review and save to confirm.")
    ).toBeNull();
    unmount();
    render(<PersonalContextPanel client={createPreviewClientV0("normal")} />);
    await screen.findByRole("button", { name: /Primary perspective.*Engineering/ });
    expect(screen.getByRole("checkbox", { name: "Founder" }).getAttribute("aria-checked")).toBe(
        "true"
    );
    expect(screen.getByRole("checkbox", { name: "Engineering" }).getAttribute("aria-checked")).toBe(
        "true"
    );
});
it("stars an old document, exposes exact version/coverage and unstars it", async () => {
    render(<PersonalContextPanel client={createPreviewClientV0("normal")} />);
    fireEvent.click(
        await screen.findByRole("button", { name: "Star Engineering operating constraints" })
    );
    await screen.findByText("Personal Vantage star");
    expect(screen.getByText(/Source 101 · Version 7/)).toBeTruthy();
    expect(screen.getByText(/Updated 2026-01-15/)).toBeTruthy();
    fireEvent.click(
        screen.getByRole("button", { name: "Unstar Engineering operating constraints" })
    );
    await waitFor(() => expect(screen.queryByText("Personal Vantage star")).toBeNull());
});
it("shows revoked coverage without document content and lets the user remove their star", async () => {
    const client = createPreviewClientV0("normal");
    await client.setStar({ documentId: "101", starred: true, expectedRevision: 0 });
    render(<PersonalContextPanel client={createPreviewClientV0("revoked")} />);
    await screen.findByText("Access revoked");
    expect(screen.queryByText("Engineering operating constraints")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove unavailable star" }));
    await screen.findByText("Required context is ready for handoff.");
});
it("distinguishes missing canonical company context", async () => {
    render(<PersonalContextPanel client={createPreviewClientV0("missing-company")} />);
    await screen.findByText("Canonical company context has not been created.");
    expect(screen.getByText("Required context needs attention before generation.")).toBeTruthy();
});
it("prevents double submissions while a save is pending", async () => {
    const base = createPreviewClientV0("normal");
    let release!: () => void;
    const saveRoles = jest.fn(
        () =>
            new Promise<void>(resolve => {
                release = resolve;
            })
    );
    render(<PersonalContextPanel client={{ ...base, saveRoles }} />);
    const button = await screen.findByRole("button", { name: "Save roles" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(saveRoles).toHaveBeenCalledTimes(1);
    release();
    await screen.findByText("Your context choices were saved.");
});
it("distinguishes acknowledged save from a failed refresh and blocks stale edits", async () => {
    const base = createPreviewClientV0("normal");
    let fail = false;
    const client: PersonalContextClientV0 = {
        ...base,
        load: () => (fail ? Promise.reject(new Error("offline")) : base.load()),
        saveRoles: async change => {
            await base.saveRoles(change);
            fail = true;
        },
    };
    render(<PersonalContextPanel client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: "Save roles" }));
    await screen.findByText(/Your changes were saved, but the refreshed context/);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save roles" }).disabled).toBe(
        true
    );
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Reload context" }));
    await screen.findByText("Context refreshed.");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save roles" }).disabled).toBe(
        false
    );
});
it("keeps failed mutation errors separate and permits explicit reload", async () => {
    const base = createPreviewClientV0("normal");
    render(
        <PersonalContextPanel
            client={{
                ...base,
                saveRoles: async () => {
                    throw new Error("409");
                },
            }}
        />
    );
    fireEvent.click(await screen.findByRole("button", { name: "Save roles" }));
    await screen.findByText(/Your access or saved choices may have changed/);
    expect(screen.queryByText(/Your changes were saved, but/)).toBeNull();
});
it("keeps role choices separate from permissions and report generation", async () => {
    render(<PersonalContextPanel client={createPreviewClientV0("normal")} />);
    await screen.findByText("Your roles and documents");
    expect(
        screen.getByText(/Business roles and stars never change document permissions/)
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /generate/i })).toBeNull();
});
