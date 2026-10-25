/** @jest-environment jsdom */
import React from "react";
import { fireEvent, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { renderWithLocale } from "~/i18n/testing/render";

const mockChange = jest.fn();
jest.mock("next/navigation", () => ({
    useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}));
jest.mock("~/i18n/client", () => ({
    useChangeLocale: () => ({ changeLocale: mockChange, locale: "en", pending: false }),
}));
jest.mock("~/lib/settings/useSettings", () => ({
    useSettingValue: () => false,
    useSettingsSearch: () => () => [],
    useSettingCopier: () => (definition: unknown) => definition,
}));
jest.mock("~/lib/context-menu", () => ({
    APP_TARGET_KIND: "app",
    actionItems: () => [],
    listActions: () => [],
}));
jest.mock("~/lib/profile/use-people", () => ({ usePeople: () => ({}) }));
jest.mock("~/lib/use-permissions", () => ({
    usePermissions: () => ({ loaded: true, can: () => true }),
}));

import { CommandPalette } from "../CommandPalette";

function palette(locale: "en" | "zh-CN") {
    renderWithLocale(
        <CommandPalette open onClose={jest.fn()} sources={[]} onPickSource={jest.fn()} />,
        locale
    );
    return screen.getByRole("textbox");
}

describe.each(["en", "zh-CN"] as const)("language rows in %s", locale => {
    it.each(["language", "语言", "chinese", "中文"])("finds 简体中文 by %s", query => {
        fireEvent.change(palette(locale), { target: { value: query } });
        const row = screen.getByText(locale === "en" ? "Language: 简体中文" : "语言：简体中文");
        fireEvent.click(row);
        expect(mockChange).toHaveBeenLastCalledWith("zh-CN");
    });
    it("finds English by english", () => {
        fireEvent.change(palette(locale), { target: { value: "english" } });
        fireEvent.click(screen.getByText(locale === "en" ? "Language: English" : "语言：English"));
        expect(mockChange).toHaveBeenLastCalledWith("en");
    });
});

it("reads in Chinese", () => {
    const input = palette("zh-CN");
    expect(input).toHaveAttribute("placeholder", "跳转到任何内容——来源、功能、设置…");
    fireEvent.change(input, { target: { value: "团队" } });
    expect(screen.getByText("团队")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "team" } });
    expect(screen.getByText("团队")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "zzzz" } });
    expect(screen.getByText(/没有与/)).toBeInTheDocument();
});
