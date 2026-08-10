"use client";

/**
 * The blank-page starter row.
 *
 * Notion shows this under the title of an empty page and hides it the moment
 * anything is typed, which is the behaviour worth copying: it is an offer, not
 * a permanent piece of chrome.
 */

import { LayoutTemplate, Table2 } from "lucide-react";
import { useState } from "react";

import { PAGE_TEMPLATES, type PageTemplate } from "../lib/templates";

export function TemplateStarter({
    onApply,
    onInsertDatabase,
}: {
    onApply: (template: PageTemplate) => void;
    onInsertDatabase: () => void;
}) {
    const [open, setOpen] = useState(false);

    return (
        <div className="ntn-starter">
            {!open ? (
                <div className="ntn-starter__row">
                    <button
                        type="button"
                        className="ntn-starter__btn"
                        onClick={() => setOpen(true)}
                    >
                        <LayoutTemplate size={14} /> Start with a template
                    </button>
                    <button
                        type="button"
                        className="ntn-starter__btn"
                        onClick={onInsertDatabase}
                    >
                        <Table2 size={14} /> New database
                    </button>
                </div>
            ) : (
                <div className="ntn-starter__grid">
                    {PAGE_TEMPLATES.map((template) => (
                        <button
                            key={template.id}
                            type="button"
                            className="ntn-starter__card"
                            onClick={() => {
                                onApply(template);
                                setOpen(false);
                            }}
                        >
                            <span className="ntn-starter__icon">{template.icon}</span>
                            <span className="ntn-starter__name">{template.name}</span>
                            <span className="ntn-starter__desc">{template.description}</span>
                        </button>
                    ))}
                    <button
                        type="button"
                        className="ntn-starter__dismiss"
                        onClick={() => setOpen(false)}
                    >
                        Start from scratch instead
                    </button>
                </div>
            )}
        </div>
    );
}
