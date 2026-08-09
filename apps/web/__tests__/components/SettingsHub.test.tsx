/** @jest-environment jsdom */

/**
 * The unified settings surface.
 *
 * The point of the hub is that five sections share one header and one action
 * area. So the things worth asserting are structural: every section is
 * reachable, old deep links still land on the right one, exactly one primary
 * button exists at a time, and it belongs to the section currently on screen.
 */

import React from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

// Section bodies are exercised by their own tests and by the API tests. Here
// they are replaced with probes that publish known actions, so the assertions
// are about the chrome rather than about five unrelated data fetches.
jest.mock("~/app/employer/documents/_workspace/settings/ProcessingSettings", () => {
  const { usePublishedActions } = jest.requireActual<
    typeof import("~/app/employer/documents/_workspace/settings/contract")
  >("~/app/employer/documents/_workspace/settings/contract");
  return {
    ProcessingSettings: ({ onActions }: { onActions?: unknown }) => {
      usePublishedActions(
        onActions as never,
        { primaryLabel: "Save changes", onPrimary: () => undefined, disabled: false },
        [],
      );
      return <div data-testid="body-processing">processing body</div>;
    },
  };
});

jest.mock("~/app/employer/documents/_workspace/collab/AgentsPanel", () => {
  const { usePublishedActions } = jest.requireActual<
    typeof import("~/app/employer/documents/_workspace/settings/contract")
  >("~/app/employer/documents/_workspace/settings/contract");
  return {
    AgentsPanel: ({ onActions }: { onActions?: unknown }) => {
      usePublishedActions(
        onActions as never,
        { primaryLabel: "New agent", onPrimary: () => undefined },
        [],
      );
      return <div data-testid="body-agents">agents body</div>;
    },
  };
});

jest.mock("~/app/employer/documents/_workspace/settings/IntegrationsPanel", () => ({
  // Deliberately publishes nothing — a read-only section must not leave a
  // stale button behind from whichever section preceded it.
  IntegrationsPanel: () => <div data-testid="body-integrations">integrations body</div>,
}));

jest.mock("~/app/employer/metadata/MetadataView", () => ({
  MetadataView: ({ bare }: { bare?: boolean }) => (
    <div data-testid="body-company" data-bare={String(Boolean(bare))}>
      company body
    </div>
  ),
}));

jest.mock("~/app/employer/statistics/StatisticsView", () => ({
  StatisticsView: ({ bare }: { bare?: boolean }) => (
    <div data-testid="body-analytics" data-bare={String(Boolean(bare))}>
      analytics body
    </div>
  ),
}));

import {
  SettingsHub,
  settingsSectionFromHash,
} from "~/app/employer/documents/_workspace/SettingsHub";

/** `next/dynamic` resolves on a microtask; wait for the real body to land. */
async function findBody(testId: string) {
  return waitFor(() => screen.getByTestId(testId));
}

function setHash(hash: string) {
  window.history.replaceState(null, "", `/employer/settings${hash}`);
}

describe("settingsSectionFromHash", () => {
  it("maps every documented alias, including the ones that used to be routes", () => {
    expect(settingsSectionFromHash("#byok")).toBe("processing");
    expect(settingsSectionFromHash("#embedding")).toBe("processing");
    expect(settingsSectionFromHash("#agents")).toBe("agents");
    expect(settingsSectionFromHash("#nodes")).toBe("agents");
    expect(settingsSectionFromHash("#slack")).toBe("integrations");
    expect(settingsSectionFromHash("#metadata")).toBe("company");
    expect(settingsSectionFromHash("#company")).toBe("company");
    expect(settingsSectionFromHash("#statistics")).toBe("analytics");
    expect(settingsSectionFromHash("#analytics")).toBe("analytics");
  });

  it("is case-insensitive and tolerates a missing #", () => {
    expect(settingsSectionFromHash("BYOK")).toBe("processing");
    expect(settingsSectionFromHash("#Statistics")).toBe("analytics");
  });

  it("returns null for an unknown hash rather than guessing", () => {
    expect(settingsSectionFromHash("#nope")).toBeNull();
    expect(settingsSectionFromHash("")).toBeNull();
  });
});

describe("SettingsHub", () => {
  beforeEach(() => {
    setHash("");
  });

  it("lists every section in one rail", () => {
    render(<SettingsHub />);
    const rail = screen.getByRole("navigation", { name: /settings sections/i });

    for (const label of [
      "Processing",
      "Agents & nodes",
      "Integrations",
      "Company profile",
      "Analytics",
    ]) {
      expect(within(rail).getByText(label)).toBeInTheDocument();
    }
  });

  it("opens on Processing and gives it the one page heading", async () => {
    render(<SettingsHub />);

    await findBody("body-processing");
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent("How documents get indexed");
  });

  it("switches sections from the rail", async () => {
    const user = userEvent.setup();
    render(<SettingsHub />);
    await findBody("body-processing");

    await user.click(screen.getByRole("button", { name: /Agents & nodes/i }));

    await findBody("body-agents");
    expect(screen.queryByTestId("body-processing")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Who shows up to a meeting",
    );
  });

  it("renders exactly one primary action, owned by the visible section", async () => {
    const user = userEvent.setup();
    render(<SettingsHub />);
    await findBody("body-processing");

    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New agent" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Agents & nodes/i }));
    await findBody("body-agents");

    expect(screen.getByRole("button", { name: "New agent" })).toBeInTheDocument();
    // The previous section's Save must not survive the switch.
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
  });

  it("shows no primary action for a read-only section", async () => {
    const user = userEvent.setup();
    render(<SettingsHub />);
    await findBody("body-processing");

    await user.click(screen.getByRole("button", { name: /Integrations/i }));
    await findBody("body-integrations");

    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New agent" })).not.toBeInTheDocument();
  });

  it("opens the section named by the URL hash", async () => {
    setHash("#statistics");
    render(<SettingsHub />);

    const body = await findBody("body-analytics");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "How the workspace is being used",
    );
    // Collapsed views render body-only so the hub owns the column and header.
    expect(body).toHaveAttribute("data-bare", "true");
  });

  it("honours a hash change after mount", async () => {
    render(<SettingsHub />);
    await findBody("body-processing");

    setHash("#metadata");
    act(() => {
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });

    const body = await findBody("body-company");
    expect(body).toHaveAttribute("data-bare", "true");
  });

  it("lets an explicit initialSection win over the hash", async () => {
    setHash("#byok");
    render(<SettingsHub initialSection="agents" />);

    await findBody("body-agents");
  });

  it("marks the open section for assistive tech", async () => {
    const user = userEvent.setup();
    render(<SettingsHub />);

    const rail = screen.getByRole("navigation", { name: /settings sections/i });
    expect(within(rail).getByRole("button", { current: "page" })).toHaveTextContent("Processing");

    await user.click(screen.getByRole("button", { name: /Company profile/i }));
    expect(within(rail).getByRole("button", { current: "page" })).toHaveTextContent(
      "Company profile",
    );
  });
});
