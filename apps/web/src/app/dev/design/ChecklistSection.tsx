"use client";

import { Checkbox } from "~/components/ui/checkbox";
import { Label } from "~/components/ui/label";

import { Code, DocSection } from "./parts";

/** Mirrors DESIGN.md § "Review checklist" — keep the two in step. */
const CHECKS: { group: string; items: string[] }[] = [
    {
        group: "Place",
        items: [
            "It lives on the right surface (Where it goes); nothing new in the sidebar unless it is about sources.",
            "A new area is a Studio tab on ToolFrame; its views are screens in the bar, not tabs or a rail of its own.",
            "Files are where the repo map says; nothing imported across route areas.",
        ],
    },
    {
        group: "Look",
        items: [
            "Kit and shared pieces only; no raw <button>, no hand-rolled overlay or menu.",
            "Colours are semantic classes; no hex, no palette colour, no inline style colour.",
            "Titles from PageHeader (30 or 26px), sections from SectionHeading; text at 14/13/12px, nothing smaller.",
            "One left edge; ToolFrame's padding, no extra; radii sm/md/lg/full only; no shadows in the page flow.",
            "One filled button per view, next to what it acts on; labels are verbs.",
        ],
    },
    {
        group: "Behave",
        items: [
            "Loading, empty, filtered-empty, failed, not allowed and not found are each designed.",
            "Folds by the tab's width (@max-*), checked at 1120, 760, 560 and 390px.",
            "Every object verb is in its menu and reachable without right-click; ⌘K has the app-level ones.",
            "window key listeners are gated on useToolActive().",
        ],
    },
    {
        group: "Words and access",
        items: [
            "Every word from the catalogue, in en and zh-CN; npx jest src/i18n passes.",
            "Checked in light and dark; text contrast holds (ink-3 is the lightest tier for words).",
            "Keyboard: everything focusable shows a ring; icon buttons have aria-label and a tooltip.",
        ],
    },
];

export function ChecklistSection() {
    return (
        <DocSection
            id="checklist"
            title="Review checklist"
            guide="9. Review checklist"
            lead={
                <>
                    Before you open a pull request that adds or changes UI. The same list is in{" "}
                    <Code>DESIGN.md</Code> to paste into the PR description. Ticking boxes here
                    saves nothing.
                </>
            }
        >
            <div className="@max-md:grid-cols-1 grid grid-cols-2 gap-x-8 gap-y-6">
                {CHECKS.map(group => (
                    <fieldset key={group.group} className="m-0 flex flex-col gap-2 border-0 p-0">
                        <legend className="text-ink mb-1 text-[13px] font-semibold">
                            {group.group}
                        </legend>
                        {group.items.map((item, i) => {
                            const id = `check-${group.group}-${i}`;
                            return (
                                <div key={id} className="flex items-start gap-2.5">
                                    <Checkbox id={id} className="mt-0.5" />
                                    <Label
                                        htmlFor={id}
                                        className="text-ink-2 text-[13px] font-normal leading-normal"
                                    >
                                        {item}
                                    </Label>
                                </div>
                            );
                        })}
                    </fieldset>
                ))}
            </div>
        </DocSection>
    );
}
