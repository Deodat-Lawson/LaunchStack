/** @jest-environment jsdom */

/**
 * The people lookup batches every id asked for in one tick into one request,
 * caches answers (including "not a member"), and forgets them on reset — so a
 * long meeting transcript costs one request, not one per message.
 */

import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

import type { PersonLook } from "~/lib/profile/resolve";
import { resetPeopleCache, usePeople, usePerson } from "~/lib/profile/use-people";

const look = (id: string, displayName: string): PersonLook => ({
    authUserId: id,
    name: `${displayName} Person`,
    email: "",
    displayName,
    title: null,
    pronouns: null,
    avatarUrl: `/api/profile-images/${id}-photo-0000000`,
    member: true,
});

function Probe({ ids, testId }: { ids: string[]; testId: string }) {
    const people = usePeople(ids);
    return (
        <span data-testid={testId}>
            {ids.map(id => people[id]?.displayName ?? `?${id}`).join(",")}
        </span>
    );
}

function OneProbe({ id }: { id: string | null }) {
    const person = usePerson(id);
    return (
        <span data-testid="one">
            {person.status === "member" ? person.look.displayName : person.status}
        </span>
    );
}

describe("usePeople", () => {
    const fetchMock = jest.fn();

    beforeEach(() => {
        fetchMock.mockReset();
        fetchMock.mockImplementation(async (url: string) => {
            const ids = decodeURIComponent(url.split("ids=")[1] ?? "").split(",");
            const people: Record<string, PersonLook> = {};
            // "gone" is not a member: the route leaves them out.
            for (const id of ids) if (id !== "gone") people[id] = look(id, id.toUpperCase());
            return { ok: true, status: 200, json: async () => ({ people }) } as Response;
        });
        global.fetch = fetchMock as unknown as typeof fetch;
        act(() => resetPeopleCache());
    });

    it("batches every id from the same render into one request", async () => {
        render(
            <>
                <Probe ids={["ada", "bob"]} testId="a" />
                <Probe ids={["bob", "cai", "gone"]} testId="b" />
            </>
        );
        await waitFor(() => expect(screen.getByTestId("b")).toHaveTextContent("BOB,CAI,?gone"));
        expect(screen.getByTestId("a")).toHaveTextContent("ADA,BOB");
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const url = String(fetchMock.mock.calls[0]?.[0]);
        expect(url.startsWith("/api/profile/people?ids=")).toBe(true);
    });

    it("answers from cache — including non-members — until reset", async () => {
        const { rerender } = render(<Probe ids={["ada", "gone"]} testId="p" />);
        await waitFor(() => expect(screen.getByTestId("p")).toHaveTextContent("ADA,?gone"));
        rerender(<Probe ids={["gone", "ada"]} testId="p" />);
        expect(fetchMock).toHaveBeenCalledTimes(1);

        act(() => resetPeopleCache());
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    });

    it("does not retry in a loop when the network fails", async () => {
        fetchMock.mockRejectedValue(new Error("offline"));
        render(<Probe ids={["ada"]} testId="p" />);
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 20));
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId("p")).toHaveTextContent("?ada");
    });

    describe("usePerson", () => {
        it("goes from pending to the member's look", async () => {
            render(<OneProbe id="ada" />);
            expect(screen.getByTestId("one")).toHaveTextContent("pending");
            await waitFor(() => expect(screen.getByTestId("one")).toHaveTextContent("ADA"));
        });

        it("tells a non-member apart from a failed lookup", async () => {
            const { unmount } = render(<OneProbe id="gone" />);
            await waitFor(() => expect(screen.getByTestId("one")).toHaveTextContent("gone"));
            unmount();

            fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
            render(<OneProbe id="ada" />);
            await waitFor(() => expect(screen.getByTestId("one")).toHaveTextContent("unknown"));
        });

        it("asks nothing for no id", async () => {
            render(<OneProbe id={null} />);
            expect(screen.getByTestId("one")).toHaveTextContent("unknown");
            await act(async () => {
                await new Promise(resolve => setTimeout(resolve, 10));
            });
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it("shares the batch with usePeople", async () => {
            render(
                <>
                    <Probe ids={["bob"]} testId="list" />
                    <OneProbe id="ada" />
                </>
            );
            await waitFor(() => expect(screen.getByTestId("one")).toHaveTextContent("ADA"));
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });
    });
});
