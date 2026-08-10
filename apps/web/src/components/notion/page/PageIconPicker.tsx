"use client";

/**
 * The page icon and its picker: Emoji / Upload / Link, exactly the three tabs
 * Notion offers.
 */

import { Loader2 } from "lucide-react";
import { useRef, useState } from "react";

import { useNotionEditor } from "../context";
import { EmojiPicker } from "../ui/EmojiPicker";
import type { PageIcon } from "~/types/workspace";

export function PageIconDisplay({
    icon,
    size = 78,
    onClick,
}: {
    icon: PageIcon | null;
    size?: number;
    onClick?: () => void;
}) {
    if (!icon) return null;

    const content =
        icon.type === "image" ? (
            // Icons are user-supplied URLs from arbitrary hosts.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={icon.value} alt="" className="ntn-page-icon__img" />
        ) : (
            <span style={{ fontSize: size * 0.85, lineHeight: 1 }}>{icon.value}</span>
        );

    if (!onClick) {
        return (
            <div className="ntn-page-icon" style={{ width: size, height: size }}>
                {content}
            </div>
        );
    }

    return (
        <button
            type="button"
            className="ntn-page-icon ntn-page-icon--button"
            style={{ width: size, height: size }}
            onClick={onClick}
        >
            {content}
        </button>
    );
}

export function IconPickerPanel({
    onSelect,
    onRemove,
    onClose,
}: {
    onSelect: (icon: PageIcon) => void;
    onRemove: () => void;
    onClose: () => void;
}) {
    const { uploadFile } = useNotionEditor();
    const [tab, setTab] = useState<"emoji" | "upload" | "link">("emoji");
    const [uploading, setUploading] = useState(false);
    const [link, setLink] = useState("");
    const fileRef = useRef<HTMLInputElement>(null);

    const tabs = (
        <div className="ntn-icon-picker__tabs">
            {(["emoji", "upload", "link"] as const).map((value) => (
                <button
                    key={value}
                    type="button"
                    className={`ntn-icon-picker__tab${tab === value ? " is-active" : ""}`}
                    onClick={() => setTab(value)}
                >
                    {value === "emoji" ? "Emoji" : value === "upload" ? "Upload" : "Link"}
                </button>
            ))}
            <button type="button" className="ntn-icon-picker__remove" onClick={onRemove}>
                Remove
            </button>
        </div>
    );

    if (tab === "emoji") {
        return (
            <div className="ntn-icon-picker">
                <EmojiPicker
                    header={tabs}
                    onSelect={(emoji) => onSelect({ type: "emoji", value: emoji })}
                    onClose={onClose}
                />
            </div>
        );
    }

    return (
        <div className="ntn-icon-picker">
            {tabs}
            <div className="ntn-icon-picker__body">
                {tab === "upload" ? (
                    <>
                        <input
                            ref={fileRef}
                            type="file"
                            accept="image/*"
                            hidden
                            onChange={async (event) => {
                                const file = event.target.files?.[0];
                                event.target.value = "";
                                if (!file) return;
                                setUploading(true);
                                const uploaded = await uploadFile(file);
                                setUploading(false);
                                if (uploaded) onSelect({ type: "image", value: uploaded.url });
                            }}
                        />
                        <button
                            type="button"
                            className="ntn-btn ntn-btn--block ntn-btn--primary"
                            onClick={() => fileRef.current?.click()}
                        >
                            {uploading ? (
                                <Loader2 size={13} className="ntn-spin" />
                            ) : (
                                "Choose an image"
                            )}
                        </button>
                        <p className="ntn-icon-picker__hint">
                            Images work best at 280 × 280 pixels or larger.
                        </p>
                    </>
                ) : (
                    <form
                        onSubmit={(event) => {
                            event.preventDefault();
                            const url = link.trim();
                            if (url) onSelect({ type: "image", value: url });
                        }}
                    >
                        <input
                            className="ntn-input"
                            placeholder="Paste an image link…"
                            value={link}
                            autoFocus
                            onChange={(event) => setLink(event.target.value)}
                        />
                        <button
                            type="submit"
                            className="ntn-btn ntn-btn--block ntn-btn--primary"
                        >
                            Submit
                        </button>
                    </form>
                )}
            </div>
        </div>
    );
}
