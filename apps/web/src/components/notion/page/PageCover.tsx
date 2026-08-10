"use client";

/**
 * The page cover: a full-bleed band above the title with reposition, replace,
 * and remove — the three things Notion lets you do to one.
 */

import { Loader2 } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { useNotionEditor } from "../context";
import type { PageCover as PageCoverValue } from "~/types/workspace";

/** Notion's default gradients, expressed in the app's own colour space. */
export const COVER_GRADIENTS: Array<{ id: string; value: string }> = [
    { id: "dusk", value: "linear-gradient(135deg, oklch(0.62 0.19 285), oklch(0.72 0.16 330))" },
    { id: "sunset", value: "linear-gradient(135deg, oklch(0.78 0.16 60), oklch(0.68 0.20 25))" },
    { id: "meadow", value: "linear-gradient(135deg, oklch(0.76 0.14 150), oklch(0.70 0.14 200))" },
    { id: "ocean", value: "linear-gradient(135deg, oklch(0.62 0.16 240), oklch(0.74 0.13 200))" },
    { id: "ember", value: "linear-gradient(135deg, oklch(0.60 0.22 20), oklch(0.74 0.17 55))" },
    { id: "graphite", value: "linear-gradient(135deg, oklch(0.42 0.02 280), oklch(0.62 0.02 280))" },
    { id: "sand", value: "linear-gradient(135deg, oklch(0.88 0.05 80), oklch(0.78 0.09 55))" },
    { id: "aurora", value: "linear-gradient(135deg, oklch(0.70 0.18 200), oklch(0.66 0.21 300))" },
];

export function PageCover({
    cover,
    editable,
    onChange,
}: {
    cover: PageCoverValue | null;
    editable: boolean;
    onChange: (cover: PageCoverValue | null) => void;
}) {
    const { uploadFile } = useNotionEditor();
    const [picker, setPicker] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [repositioning, setRepositioning] = useState(false);
    const [linkValue, setLinkValue] = useState("");
    const fileRef = useRef<HTMLInputElement>(null);
    const bandRef = useRef<HTMLDivElement>(null);

    /**
     * Drag anywhere on the band to change the focal point. The position is a
     * percentage so it survives the band being a different height on mobile.
     */
    const startReposition = useCallback(
        (event: React.PointerEvent) => {
            if (!repositioning || !cover) return;
            event.preventDefault();
            const band = bandRef.current;
            if (!band) return;
            const height = band.getBoundingClientRect().height;
            const startY = event.clientY;
            const startPosition = cover.position;

            const onMove = (move: PointerEvent) => {
                const delta = ((move.clientY - startY) / Math.max(height, 1)) * 100;
                onChange({
                    ...cover,
                    position: Math.max(0, Math.min(100, startPosition + delta)),
                });
            };
            const onUp = () => {
                window.removeEventListener("pointermove", onMove);
                window.removeEventListener("pointerup", onUp);
            };
            window.addEventListener("pointermove", onMove);
            window.addEventListener("pointerup", onUp);
        },
        [cover, onChange, repositioning]
    );

    if (!cover) return null;

    const style =
        cover.type === "image"
            ? {
                  backgroundImage: `url(${cover.value})`,
                  backgroundPosition: `center ${cover.position}%`,
              }
            : { background: cover.value };

    return (
        <div
            ref={bandRef}
            className={`ntn-cover${repositioning ? " is-repositioning" : ""}`}
            style={style}
            onPointerDown={startReposition}
        >
            {editable && (
                <div className="ntn-cover__actions">
                    {repositioning ? (
                        <>
                            <span className="ntn-cover__hint">Drag image to reposition</span>
                            <button
                                type="button"
                                className="ntn-cover__btn"
                                onClick={() => setRepositioning(false)}
                            >
                                Save position
                            </button>
                        </>
                    ) : (
                        <>
                            <button
                                type="button"
                                className="ntn-cover__btn"
                                onClick={() => setPicker((open) => !open)}
                            >
                                Change cover
                            </button>
                            {cover.type === "image" && (
                                <button
                                    type="button"
                                    className="ntn-cover__btn"
                                    onClick={() => setRepositioning(true)}
                                >
                                    Reposition
                                </button>
                            )}
                            <button
                                type="button"
                                className="ntn-cover__btn"
                                onClick={() => onChange(null)}
                            >
                                Remove
                            </button>
                        </>
                    )}
                </div>
            )}

            {picker && (
                <div className="ntn-cover__picker" onPointerDown={(e) => e.stopPropagation()}>
                    <div className="ntn-cover__picker-head">
                        <span>Gallery</span>
                        <button
                            type="button"
                            className="ntn-cover__btn"
                            onClick={() => fileRef.current?.click()}
                        >
                            {uploading ? <Loader2 size={12} className="ntn-spin" /> : "Upload"}
                        </button>
                    </div>
                    <div className="ntn-cover__grid">
                        {COVER_GRADIENTS.map((gradient) => (
                            <button
                                key={gradient.id}
                                type="button"
                                className="ntn-cover__swatch"
                                style={{ background: gradient.value }}
                                onClick={() => {
                                    onChange({ type: "gradient", value: gradient.value, position: 50 });
                                    setPicker(false);
                                }}
                            />
                        ))}
                    </div>
                    <form
                        className="ntn-cover__link"
                        onSubmit={(event) => {
                            event.preventDefault();
                            const url = linkValue.trim();
                            if (!url) return;
                            onChange({ type: "image", value: url, position: 50 });
                            setLinkValue("");
                            setPicker(false);
                        }}
                    >
                        <input
                            className="ntn-input"
                            placeholder="Paste an image link…"
                            value={linkValue}
                            onChange={(event) => setLinkValue(event.target.value)}
                        />
                        <button type="submit" className="ntn-btn ntn-btn--primary">
                            Submit
                        </button>
                    </form>
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
                            if (!uploaded) return;
                            onChange({ type: "image", value: uploaded.url, position: 50 });
                            setPicker(false);
                        }}
                    />
                </div>
            )}
        </div>
    );
}

/** A random gradient, used by "Add cover". */
export function randomCover(): PageCoverValue {
    const gradient =
        COVER_GRADIENTS[Math.floor(Math.random() * COVER_GRADIENTS.length)] ??
        COVER_GRADIENTS[0]!;
    return { type: "gradient", value: gradient.value, position: 50 };
}
