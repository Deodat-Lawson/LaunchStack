"use client";

/**
 * The colour menu: text colours above, block backgrounds below.
 *
 * Text colour is a mark on the selection; background is an attribute on the
 * block. Notion presents them as one list, so the split is invisible here —
 * but it is why the two halves call different commands.
 */

import type { Editor } from "@tiptap/react";

import { backgroundColorValue, EDITOR_COLORS, textColorValue } from "../../lib/colors";
import { MenuHeading } from "../../ui/Popover";

export function ColorMenu({
    editor,
    onDone,
}: {
    editor: Editor;
    onDone?: () => void;
}) {
    const applyText = (id: string) => {
        const chain = editor.chain().focus();
        if (id === "default") chain.unsetColor().run();
        else chain.setColor(textColorValue(id) ?? "").run();
        onDone?.();
    };

    const applyBackground = (id: string) => {
        editor.chain().focus().setBlockBackground(id).run();
        onDone?.();
    };

    const activeColor = (editor.getAttributes("textStyle").color as string) ?? null;
    const activeBackground =
        (editor.getAttributes("paragraph").blockBackground as string) ??
        (editor.getAttributes("heading").blockBackground as string) ??
        null;

    return (
        <div className="ntn-menu ntn-menu--color">
            <MenuHeading>Text colour</MenuHeading>
            {EDITOR_COLORS.map((color) => (
                <button
                    key={`text-${color.id}`}
                    type="button"
                    className={`ntn-menu__item${
                        activeColor === textColorValue(color.id) ? " is-active" : ""
                    }`}
                    onClick={() => applyText(color.id)}
                >
                    <span className="ntn-swatch" style={{ color: color.text }}>
                        A
                    </span>
                    <span className="ntn-menu__text">
                        <span className="ntn-menu__title">{color.label}</span>
                    </span>
                </button>
            ))}

            <MenuHeading>Background</MenuHeading>
            {EDITOR_COLORS.map((color) => (
                <button
                    key={`bg-${color.id}`}
                    type="button"
                    className={`ntn-menu__item${
                        activeBackground === color.id ? " is-active" : ""
                    }`}
                    onClick={() => applyBackground(color.id)}
                >
                    <span
                        className="ntn-swatch ntn-swatch--filled"
                        style={{
                            background: backgroundColorValue(color.id) ?? "transparent",
                            borderColor: color.id === "default" ? "var(--line)" : color.swatch,
                        }}
                    >
                        A
                    </span>
                    <span className="ntn-menu__text">
                        <span className="ntn-menu__title">
                            {color.id === "default" ? "Default background" : `${color.label} background`}
                        </span>
                    </span>
                </button>
            ))}
        </div>
    );
}
