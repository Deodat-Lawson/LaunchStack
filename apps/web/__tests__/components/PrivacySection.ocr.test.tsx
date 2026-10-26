/** @jest-environment jsdom */

/**
 * The OCR note on Settings › Data and privacy is worded from the server's
 * plan in the reader's language. Matching the server's English sentences
 * broke as soon as they changed and left Chinese readers with English.
 */

import React from "react";
import "@testing-library/jest-dom";
import { useTranslations } from "next-intl";

import { ocrNote } from "~/app/employer/documents/_workspace/settings/PrivacySection";
import type { Locale } from "~/i18n/locales";
import { renderWithLocale } from "~/i18n/testing/render";

type Plan = Parameters<typeof ocrNote>[1];

function Note({ plan }: { plan: Plan }) {
    const t = useTranslations("settings.privacy");
    return <p>{ocrNote(t, plan)}</p>;
}

const note = (plan: Plan, locale: Locale) => {
    const { container, unmount } = renderWithLocale(<Note plan={plan} />, locale);
    const text = container.textContent ?? "";
    unmount();
    return text;
};

describe("Privacy › OCR note", () => {
    it("says the order and the last resort in English", () => {
        expect(note({ scope: "all", order: ["AZURE", "DOCLING"] }, "en")).toBe(
            "Every PDF and image is read with OCR. Azure Document Intelligence reads every page; if it fails, Docling on this deployment (when docling-serve is running) take over in turn. The PDF's own text layer is the last resort, and a scan none of them can read is retried rather than indexed blank."
        );
    });

    it("says it all in Chinese, with no English left but the service names", () => {
        const text = note({ scope: "all", order: ["AZURE", "DOCLING", "LANDING_AI"] }, "zh-CN");
        expect(text).toContain("每个 PDF 和图片都会用 OCR 读取。");
        expect(text).toContain(
            "失败时依次由 本部署上的 Docling（docling-serve 运行时）、Landing AI 接手。"
        );
        const withoutNames = text
            .replace("Azure Document Intelligence", "")
            .replace("Landing AI", "")
            .replace(/docling-serve|Docling|PDF|OCR/g, "");
        expect(withoutNames).not.toMatch(/[A-Za-z]{3,}/);
    });

    it("says only scans reach OCR under text-layer-first, without a last resort", () => {
        const text = note({ scope: "scans", order: ["AZURE"] }, "en");
        expect(text).toMatch(/^Images and scanned PDFs are read with OCR/);
        expect(text).toMatch(/Azure Document Intelligence reads every page\. A scan none/);
        expect(text).not.toMatch(/last resort/);
    });

    it("says plainly when there is no OCR at all, in both languages", () => {
        expect(note({ scope: "none", order: [] }, "en")).toMatch(/^No OCR service is configured/);
        expect(note({ scope: "none", order: [] }, "zh-CN")).toMatch(/^未配置 OCR 服务/);
    });
});
