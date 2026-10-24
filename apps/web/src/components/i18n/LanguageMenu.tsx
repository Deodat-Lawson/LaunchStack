"use client";

import { Check, Languages } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { Button } from "~/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { useChangeLocale } from "~/i18n/client";
import { LOCALES, isLocale, localeDefinition } from "~/i18n/locales";
import { cn } from "~/lib/utils";

/**
 * The languages, as radio items. Each is named in its own language — someone
 * who cannot read the current one must still be able to find theirs.
 */
function LanguageRadioItems() {
    const { locale, changeLocale } = useChangeLocale();
    return (
        <DropdownMenuRadioGroup
            value={locale}
            onValueChange={value => {
                if (isLocale(value)) changeLocale(value);
            }}
        >
            {LOCALES.map(option => (
                <DropdownMenuRadioItem key={option.code} value={option.code} lang={option.code}>
                    {option.nativeName}
                </DropdownMenuRadioItem>
            ))}
        </DropdownMenuRadioGroup>
    );
}

/** "Language ›" inside an existing dropdown menu (the account menus). */
export function LanguageSubmenu() {
    const t = useTranslations("language");
    const locale = useLocale();
    return (
        <DropdownMenuSub>
            <DropdownMenuSubTrigger className="gap-2">
                <Languages className="size-4" aria-hidden />
                <span>{t("label")}</span>
                <span className="text-ink-3 ml-auto pl-3 text-xs">
                    {localeDefinition(locale).nativeName}
                </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-40">
                <LanguageRadioItems />
            </DropdownMenuSubContent>
        </DropdownMenuSub>
    );
}

/** A standalone globe button, for screens without an account menu (sign-in, sign-up). */
export function LanguageToggle({ className }: { className?: string }) {
    const t = useTranslations("language");
    const locale = useLocale();
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={t("choose")}
                    className={cn("text-ink-2 gap-1.5", className)}
                >
                    <Languages className="size-4" aria-hidden />
                    <span className="text-xs max-sm:hidden">
                        {localeDefinition(locale).nativeName}
                    </span>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-40">
                <DropdownMenuLabel className="text-ink-3 text-xs font-normal">
                    {t("label")}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <LanguageRadioItems />
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

/** A plain list for panels (settings): one button per language, the current one checked. */
export function LanguageList({ className }: { className?: string }) {
    const { locale, changeLocale, pending } = useChangeLocale();
    return (
        <div role="radiogroup" className={cn("flex flex-wrap gap-2", className)}>
            {LOCALES.map(option => {
                const selected = option.code === locale;
                return (
                    <Button
                        key={option.code}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        lang={option.code}
                        variant={selected ? "secondary" : "outline"}
                        size="sm"
                        disabled={pending}
                        onClick={() => changeLocale(option.code)}
                        className="gap-1.5"
                    >
                        {selected ? <Check className="size-3.5" aria-hidden /> : null}
                        {option.nativeName}
                    </Button>
                );
            })}
        </div>
    );
}
