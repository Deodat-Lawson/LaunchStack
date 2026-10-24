"use client";

/**
 * The interface language, first row of Appearance → Display.
 *
 * Hand-placed rather than a generic `SettingRow`: the row shows the language
 * the page is actually in — the browser's choice, or its own languages when
 * nothing was chosen — which the stored `appearance.language` value only
 * catches up with once the person picks one. Picking writes the browser's
 * choice and re-renders; `PreferenceSync` saves it to the account.
 */

import { useTranslations } from "next-intl";

import { LanguageList } from "~/components/i18n/LanguageMenu";

export function LanguageRow() {
    const t = useTranslations("language");
    return (
        <div
            id="setting-appearance.language"
            data-setting-key="appearance.language"
            className="border-line -mx-1 border-b px-1 py-4"
        >
            <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
                <div className="min-w-0 flex-[1_1_220px]">
                    <p className="text-ink m-0 text-[13px] font-semibold">{t("label")}</p>
                    <p className="text-ink-3 m-0 mt-1 max-w-[560px] text-[12.5px] leading-normal">
                        {t("settingDescription")}
                    </p>
                </div>
                <div className="min-w-0 max-w-[380px] flex-[999_1_280px]">
                    <LanguageList />
                </div>
            </div>
        </div>
    );
}
