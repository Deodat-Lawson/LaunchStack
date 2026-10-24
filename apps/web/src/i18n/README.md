# Interface languages (`src/i18n`)

The app's words come from message catalogues, one per language, through
[next-intl](https://next-intl.dev). English is the source of truth; Simplified
Chinese (`zh-CN`) ships alongside it. The language is a preference, like the
theme — there is no locale in the URL.

## How a page picks its language

1. The `ls-locale` cookie — this browser's latest choice, `<code>.<ms>`.
2. Otherwise the browser's `Accept-Language` (`negotiateLocale`).
3. Otherwise English.

`request.ts` does this per request and hands next-intl the catalogue;
`app/layout.tsx` sets `<html lang>` and mounts `NextIntlClientProvider`, so
client and server components read the same messages. Inside a workspace the
choice is also the member setting `appearance.language`, kept in step by
`app/employer/_chrome/PreferenceSync.tsx` — the latest choice wins, the same
rule as the theme (`localeChoice.ts`).

People switch from the account menu (sidebar foot), the avatar menu, the globe
on the sign-in screens, the command palette, and Settings → Appearance. All
of them call `useChangeLocale()` (`client.ts`): write the cookie, then
`router.refresh()` — open panes, drafts and scroll positions survive.

The chat route also tells the model which language the person reads
(`replyLanguageInstruction` in `server.ts`), so answers come back in it unless
the person writes in another language.

## Adding a language

1. `cp -R src/i18n/messages/en src/i18n/messages/<code>` and translate every
   value (never the keys, the `{placeholders}` or the `<tags>`). Change the
   copied `index.ts` to `import type { Messages } from "../../messages"` and
   end the object with `satisfies Messages`, as `zh-CN/index.ts` does.
2. Add an entry to `LOCALES` in `locales.ts`: its BCP-47 `code`, its name in
   its own language, its English name, and the `Accept-Language` tags it
   answers.
3. Add its loader to `LOADERS` in `messages.ts`, and its catalogue to
   `CATALOGUES` in `__tests__/catalogues.test.ts` and `testing/render.tsx`.

`npx jest src/i18n` then checks it says everything English says, with the same
placeholders, and parses. Nothing else changes: the switchers, the settings
row and the model instruction all read `LOCALES`. A key missing from a
catalogue renders in English, so a language can land before every string is
translated — the catalogue test is what keeps a shipped language complete.

## Writing UI text

**No user-visible English in components.** Every word a person reads — text,
`placeholder`, `title`, `aria-label`, `alt`, toasts, confirm dialogs, empty
states, error messages the client writes, option labels in constant arrays —
goes through a message.

### Namespaces

One JSON file per namespace in each catalogue: `messages/en/<namespace>.json`
and `messages/zh-CN/<namespace>.json`, registered in both `index.ts` files.
Inside a namespace, nest by component or screen:

```json
{ "sourceRail": { "title": "Sources", "empty": "Nothing here yet." } }
```

Keys are camelCase and never contain a dot. `common` holds the words every
feature shares (`common.actions.cancel`, `common.status.loading`, …) — use it
when the meaning is exactly the same, rather than adding another "Cancel".

### In a client component

```tsx
import { useTranslations } from "next-intl";

const t = useTranslations("sources.sourceRail");
const tc = useTranslations("common");
<h2>{t("title")}</h2>
<Button>{tc("actions.cancel")}</Button>
```

### In a server component, `generateMetadata` or a route handler

```tsx
import { getTranslations } from "next-intl/server";

const t = await getTranslations("settings.page");
export async function generateMetadata() {
  const t = await getTranslations("settings.page");
  return { title: t("title") };
}
```

### Values, plurals, rich text

Messages are ICU MessageFormat. Never build a sentence by concatenating
pieces — word order differs between languages.

```json
{
  "greeting": "Welcome back, {name}",
  "files": "{count, plural, =0 {No files} one {# file} other {# files}}",
  "terms": "By continuing you accept the <link>terms</link>."
}
```

```tsx
t("greeting", { name });
t("files", { count });
t.rich("terms", { link: chunks => <a href="/terms">{chunks}</a> });
```

Chinese has no plural forms: `"{count, plural, other {# 个文件}}"` is enough.
A literal `{` or `'` in a message is written `'{'` or `''`.

### Strings outside components

A constant list of options, a status map, a context-menu builder: store keys
and translate where it renders, or take `t` as a parameter.

```ts
// before: { id: "pdf", label: "PDF document" }
export const FORMATS = [{ id: "pdf" }, { id: "docx" }] as const;
// render: t(`formats.${format.id}`) — the key union type-checks.
```

Keys are type-checked against the English catalogue (`next-intl.d.ts`): a
typo is a compile error. A key computed from data the type system cannot
narrow (a string from the server) goes through `t.has(key)` with a fallback.

### Dates, numbers, relative times

Use the locale, never a hard-coded `"en-US"`:

```tsx
const format = useFormatter();
format.dateTime(date, { dateStyle: "medium" });
format.relativeTime(date);
format.number(bytes, { style: "unit", unit: "megabyte" });
// or, where a hook cannot reach: new Intl.DateTimeFormat(useLocale(), …)
```

The server renders in the browser's time zone once `TimeZoneSync` has
recorded it, so server- and client-formatted dates agree.

### What stays as it is

- User content and model output: document text, chat answers, names,
  file names.
- Brand and product names (Launchstack, Google Drive, Notion, Slack…),
  keyboard keys, code, URLs, API identifiers, log and `console` messages,
  and analytics event names.
- Server error strings shown verbatim from an API response.

### Text the server writes

A route handler knows the reader's language from the request:
`localeOfRequest(request)` (`server.ts`). Three patterns, in order of
preference:

- **Send data, word it on the screen.** An item the server composes for a
  screen (the Proposals and Prospects to-do lists) carries a `copy` field —
  a message key and its values — beside the English `title`/`detail`, which
  other API readers keep. The screen renders `copy` through its namespace.
- **Translate on the server** when the text is built there and cached per
  reader: the starter questions take the locale, key their cache on it, and
  build their fixed set from `chat.starters.generated` (`createTranslator`
  over `loadMessages(locale)`).
- **Tell the model.** `replyLanguageInstruction(locale)` for an assistant's
  answer, `outputLanguageInstruction(locale)` for interface copy a model
  writes (starter questions). Prompts themselves stay English.

## Payload

The whole catalogue (about 8,300 keys, ~400 KB minified, ~140 KB gzipped)
travels with the root layout once per full page load; client navigation
does not resend it. If that grows into a problem, give the root provider
only the namespaces the signed-out screens use and nest a second
`NextIntlClientProvider` with the rest in `app/employer/layout.tsx`.

## Tests

Component tests need nothing: under jest `next-intl` resolves to
`testing/next-intl.tsx`, which renders English without a provider, so
`getByText("Delete")` keeps working. A missing key throws there. To test a
translated screen, render it with `renderWithLocale(ui, "zh-CN")` from
`testing/render.tsx`.
