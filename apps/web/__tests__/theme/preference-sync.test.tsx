/** @jest-environment jsdom */

/**
 * PreferenceSync's theme rules, against fake next-themes and settings stores:
 * the first server answer goes to the later of the account setting and this
 * browser's choice; after that, a change made in the app is saved once, and
 * a change made in Settings (or a reset) is applied without being re-saved.
 */

import React from "react";
import type * as MockReact from "react";
import { act, render } from "@testing-library/react";

type Listener = () => void;
function mockStore<T>(initial: T) {
    let value = initial;
    const listeners = new Set<Listener>();
    return {
        get: () => value,
        set(next: T) {
            value = next;
            for (const l of listeners) l();
        },
        subscribe(l: Listener) {
            listeners.add(l);
            return () => listeners.delete(l);
        },
    };
}

const mockThemeStore = mockStore<string | undefined>("dark");
const mockPayloadStore = mockStore<unknown>(null);
const mockSetTheme = jest.fn((t: string) => mockThemeStore.set(t));
const mockWrite = jest.fn(
    (_request: { key: string; scope: string; value?: unknown }) => new Promise(() => undefined)
);

jest.mock("next-themes", () => {
    const { useSyncExternalStore } = jest.requireActual<typeof MockReact>("react");
    return {
        useTheme: () => ({
            theme: useSyncExternalStore(mockThemeStore.subscribe, mockThemeStore.get),
            setTheme: mockSetTheme,
        }),
    };
});
jest.mock("~/lib/settings/useSettings", () => {
    const { useSyncExternalStore } = jest.requireActual<typeof MockReact>("react");
    return {
        useSettingsPayload: () => ({
            loaded: true,
            error: null,
            payload: useSyncExternalStore(mockPayloadStore.subscribe, mockPayloadStore.get),
        }),
        writeSettingValue: (request: { key: string; scope: string; value?: unknown }) =>
            mockWrite(request),
    };
});

import { PreferenceSync } from "~/app/employer/_chrome/PreferenceSync";

function answer(value: string, updatedAt: string | null) {
    return {
        settings: {
            "appearance.theme": {
                key: "appearance.theme",
                value,
                source: updatedAt ? "member" : "default",
                sourceId: null,
                updatedBy: null,
                updatedAt,
                canEdit: { workspace: false, folder: false, member: true },
                stored: {},
            },
        },
        viewer: { authUserId: "u1", permissions: [] },
        folder: null,
    };
}

function setCookie(value: string | null) {
    document.cookie = value === null ? "ls-theme=; Max-Age=0; Path=/" : `ls-theme=${value}; Path=/`;
}

beforeEach(() => {
    mockSetTheme.mockClear();
    mockWrite.mockClear();
    setCookie(null);
    mockThemeStore.set("dark");
    mockPayloadStore.set(null);
});

const saves = () => mockWrite.mock.calls.map(([r]) => r.value);

describe("PreferenceSync theme", () => {
    it("keeps a new account dark and saves nothing", () => {
        render(<PreferenceSync />);
        act(() => mockPayloadStore.set(answer("dark", null)));
        expect(mockThemeStore.get()).toBe("dark");
        expect(mockWrite).not.toHaveBeenCalled();
    });

    it("opens in the theme picked on the landing site and saves it to the account", () => {
        setCookie(`light.${Date.parse("2026-10-17T10:00:00Z")}`);
        mockThemeStore.set("light"); // the boot script already handed it to next-themes
        render(<PreferenceSync />);
        act(() => mockPayloadStore.set(answer("dark", "2026-10-01T00:00:00Z")));
        expect(mockThemeStore.get()).toBe("light");
        expect(saves()).toEqual(["light"]);
    });

    it("follows the account when it was saved after this browser's choice", () => {
        setCookie(`light.${Date.parse("2026-10-01T00:00:00Z")}`);
        mockThemeStore.set("light");
        render(<PreferenceSync />);
        act(() => mockPayloadStore.set(answer("dark", "2026-10-10T00:00:00Z")));
        expect(mockThemeStore.get()).toBe("dark");
        expect(mockWrite).not.toHaveBeenCalled();
    });

    it("saves a theme changed from any control in the app, once", () => {
        render(<PreferenceSync />);
        act(() => mockPayloadStore.set(answer("dark", null)));
        act(() => mockThemeStore.set("light")); // account menu, right-click menu, palette…
        expect(saves()).toEqual(["light"]);
        // The save comes back from the server: nothing more to do.
        act(() => mockPayloadStore.set(answer("light", "2026-10-17T12:00:00Z")));
        expect(saves()).toEqual(["light"]);
        expect(mockThemeStore.get()).toBe("light");
    });

    it("applies a change made in Settings without saving it again", () => {
        render(<PreferenceSync />);
        act(() => mockPayloadStore.set(answer("dark", "2026-10-01T00:00:00Z")));
        act(() => mockPayloadStore.set(answer("system", "2026-10-17T12:00:00Z")));
        expect(mockThemeStore.get()).toBe("system");
        expect(mockWrite).not.toHaveBeenCalled();
    });

    it("applies a reset to the default even though this browser chose more recently", () => {
        setCookie(`light.${Date.parse("2026-10-17T10:00:00Z")}`);
        mockThemeStore.set("light");
        render(<PreferenceSync />);
        act(() => mockPayloadStore.set(answer("light", "2026-10-17T09:00:00Z")));
        act(() => mockPayloadStore.set(answer("dark", null))); // Settings › Reset
        expect(mockThemeStore.get()).toBe("dark");
        expect(mockWrite).not.toHaveBeenCalled();
    });

    it("does not save the theme the page loaded with when the settings are already cached", () => {
        // Back from the workspace picker: the settings store kept its answer.
        mockThemeStore.set("system");
        mockPayloadStore.set(answer("dark", "2026-10-10T00:00:00Z"));
        render(<PreferenceSync />);
        expect(mockThemeStore.get()).toBe("dark");
        expect(mockWrite).not.toHaveBeenCalled();
    });

    it("does not save the theme the page loaded with while the answer is pending", () => {
        mockThemeStore.set("system"); // left in localStorage by the old "system" default
        render(<PreferenceSync />);
        act(() => mockPayloadStore.set(answer("dark", null)));
        expect(mockThemeStore.get()).toBe("dark");
        expect(mockWrite).not.toHaveBeenCalled();
    });
});
