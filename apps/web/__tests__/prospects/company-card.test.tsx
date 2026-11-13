/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";

jest.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
jest.mock("~/components/tool-app/ToolLink", () => ({
    ToolLink: ({ children, href }: { children: React.ReactNode; href: string }) => (
        <a href={href}>{children}</a>
    ),
}));
jest.mock("~/lib/tools/copyText", () => ({
    useCopyText: () => (_copy: unknown, text: string) => text,
}));
jest.mock("~/app/employer/tools/growth/prospects/_components/SourceChip", () => ({
    FoundViaChips: () => null,
}));
jest.mock("~/app/employer/tools/growth/prospects/_components/StagePill", () => ({
    StagePill: ({ stage }: { stage: string }) => <span>{stage}</span>,
}));
jest.mock("~/components/tools/FitMeter", () => ({
    FitMeter: ({ value }: { value: number | null }) => <span>fit {value}</span>,
}));

import {
    CompanyCard,
    CompanyPicture,
} from "~/app/employer/tools/growth/prospects/_components/CompanyCard";
import type { CompanyRow } from "~/app/employer/tools/growth/prospects/api";

const row = (over: Partial<CompanyRow> = {}): CompanyRow => ({
    id: "c1",
    name: "Charm City Roasters",
    domain: "charmcity.example",
    hq: "Baltimore, US",
    country: "US",
    sizeBand: null,
    archetype: "retailer",
    why: "A Baltimore café that sells whole beans.",
    imageUrl: "https://charmcity.example/og.jpg",
    iconUrl: "https://charmcity.example/icon.png",
    fit: 82,
    fitThreshold: 70,
    stage: "lead",
    staleDays: null,
    people: 3,
    lastActivityAt: null,
    foundVia: [],
    isNew: true,
    excluded: false,
    excludedReason: null,
    ...over,
});

describe("CompanyPicture", () => {
    it("falls back from the share image to the icon to the initials, never a broken image", () => {
        const { container } = render(<CompanyPicture c={row()} />);
        const image = container.querySelector("img")!;
        expect(image.getAttribute("src")).toBe("https://charmcity.example/og.jpg");
        expect(image.getAttribute("referrerpolicy")).toBe("no-referrer");
        fireEvent.error(image);
        const icon = container.querySelector("img")!;
        expect(icon.getAttribute("src")).toBe("https://charmcity.example/icon.png");
        fireEvent.error(icon);
        expect(container.querySelector("img")).toBeNull();
        expect(screen.getByText("CC")).toBeTruthy();
    });

    it("shows initials when the company has no pictures yet", () => {
        const { container } = render(
            <CompanyPicture c={row({ imageUrl: null, iconUrl: null, name: "Zeke's" })} />
        );
        expect(container.querySelector("img")).toBeNull();
        expect(screen.getByText("Z")).toBeTruthy();
    });
});

describe("CompanyCard", () => {
    it("shows who, where, why, fit, stage and people, and opens on click", () => {
        const onOpen = jest.fn();
        render(
            <CompanyCard
                c={row()}
                index={0}
                focused={false}
                checked={false}
                onToggle={jest.fn()}
                onOpen={onOpen}
                href="/companies/c1"
            />
        );
        expect(screen.getByText("Charm City Roasters").closest("a")!.getAttribute("href")).toBe(
            "/companies/c1"
        );
        expect(screen.getByText("Baltimore, US · charmcity.example")).toBeTruthy();
        expect(screen.getByText("A Baltimore café that sells whole beans.")).toBeTruthy();
        expect(screen.getByText("fit 82")).toBeTruthy();
        expect(screen.getByText("lead")).toBeTruthy();
        expect(screen.getByText("companies.newBadge")).toBeTruthy();
        fireEvent.click(screen.getByText("A Baltimore café that sells whole beans."));
        expect(onOpen).toHaveBeenCalled();
    });
});
