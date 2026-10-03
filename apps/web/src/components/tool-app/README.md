# Tool apps: every tool is a tab

Every Studio tool opens as a tab of the workspace (`/employer/documents`),
beside the chat, sources and other tools. There is no such thing as a tool
with its own route tree, layout or page. Before October 2026, Growth, Proposals
and Vantage were separate apps (`external: true`): picking one left the
workspace and closed every open tab. The registry no longer has that flag,
and `__tests__/studio/registry.test.ts` fails if a Studio entry points
anywhere but a tab.

## The pieces

| Piece                                                     | File                          | What it does                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ToolNavProvider`                                         | `nav.tsx`                     | The tab's own history: a stack of app-relative locations (`/prospects/companies?view=new`) and a cursor. Persists the last location per member and workspace.                                                                                                                                                                                                                                                          |
| `useToolRouter`, `useToolPathname`, `useToolSearchParams` | `nav.tsx`                     | Same shapes as `next/navigation`'s hooks, inside the tab.                                                                                                                                                                                                                                                                                                                                                              |
| `useToolActive`                                           | `nav.tsx`                     | True while this tab is focused. Tabs are hidden, not unmounted, so any `window` key listener must check it.                                                                                                                                                                                                                                                                                                            |
| `ToolLink`                                                | `ToolLink.tsx`                | `next/link` for tool screens: a real `<a>` whose href is the shareable URL, so ⌘-click opens a browser tab and a plain click stays in the tab.                                                                                                                                                                                                                                                                         |
| `ToolFrame`                                               | `ToolFrame.tsx`               | The one frame: a bar across the top of the tab with back/forward, the tool's name, its screens as tabs, its controls and a ⋯ menu ("Copy link", what the tool is for). No sidebar of its own — the workspace sidebar (Sources, History) stays the only one. Under 720px of tab width the tabs take their own row; under 520px the bar folds into a screen menu. Also: per-visit scroll restore and pane-scoped sheets. |
| `ToolNotFound`                                            | `ToolFrame.tsx`               | What a tool shows for a path it has no screen for.                                                                                                                                                                                                                                                                                                                                                                     |
| locations                                                 | `~/lib/tool-app/locations.ts` | Plain data shared with the server: `toolTabHref`, `toolTargetFromHref` (old `/employer/tools/...` URLs → tool + location), `TOOL_ALIASES`.                                                                                                                                                                                                                                                                             |
| `redirectToToolTab`                                       | `~/lib/tool-app/redirect.ts`  | The whole body of an old tool page: redirects into the tab at the same screen.                                                                                                                                                                                                                                                                                                                                         |

## Adding a tool

1. **Registry.** Add the entry to the Tools group in
   `app/employer/documents/_workspace/types.ts`. Give it no `href`, or one of
   the form `/employer/documents?feature=<id>`.
2. **Pane.** Add a `case "<id>"` to `renderStudioPane` in `StudioPanes.tsx`
   and to `STUDIO_PANE_IDS` in `studioPaneIds.ts`. Load the tool with
   `next/dynamic`.
3. **One screen?** Render it inside `<ToolFrame title mark>` with no
   `groups`. You get the same surface, padding and pane-scoped sheets as
   every other tool.
4. **Several screens?** Give them as `groups`. Up to about eight screens
   they are one row of tabs (labelled groups divided by a hairline); more,
   in labelled groups, and the bar switches between groups (Growth: Brand |
   Prospects) with each group returning to the screen it was last on. A
   group's `toolbar` holds compact controls shown in the bar while it is
   active (Growth's segment switcher), and `header` its full-width form under
   the phone menu. The frame's `status` is tool-wide: a run in progress, shown
   in the bar on every screen and at every width so there is always a way back
   to it. `about` is a
   sentence on what the tool is for, at the top of its ⋯ menu. Mount the
   tool like this:

   ```tsx
   export function ExampleTool({ host }: { host?: ToolHost }) {
       return (
           <ToolNavProvider toolId="example" roots={["things", "settings"]} host={host}>
               <ExampleFrame />
           </ToolNavProvider>
       );
   }

   function ExampleFrame() {
       const path = useToolPathname();
       return (
           <ToolFrame title="Example" mark={<ExampleMark tile />} groups={[...]}>
               {screenFor(path)}
           </ToolFrame>
       );
   }
   ```

   `roots` are the first path segments of the tool's screens. "/" is always
   the tool's own; `home` sets where it lands. `screenFor` is a plain switch
   over the path that ends in `<ToolNotFound>`.

5. **Links.** Screens use `ToolLink` and `useToolRouter()`. They never import
   `next/link` or `next/navigation`. A site link (a source, `?ask=`,
   Settings) goes through the same `ToolLink` and is handed to the workspace,
   which opens it without leaving the page.
6. **Full-height screens.** An editor or a chat that lays itself out to the
   tab's height and brings its own padding passes `fill` to `ToolFrame` for
   that screen (Templated Drafts and Rewrite do). A side panel that cannot
   sit beside the document in a narrow tab moves into a kit `Sheet` — sheets
   inside the frame cover the tab only and leave the column beside it usable
   (see `DocumentGeneratorEditor`'s compact mode).
7. **Layout.** Lay screens out for a full-width tab. Fold them with the
   container variants `@max-xl` (1119px), `@max-lg` (879px), `@max-md`
   (639px), `@max-sm` (519px) and `@max-xs` (379px). Those read the tab's
   width, not the window's. Viewport breakpoints (`md:`, `lg:`) are wrong
   inside a tab: a tool in a third of a wide screen would get its widest
   layout.
8. **Keys.** Gate every `window` key listener on `useToolActive()`.
9. **Old URLs.** If the tool once had pages, keep a catch-all
   `page.tsx` that calls `redirectToToolTab`, and add the prefix to
   `LEGACY_TOOL_ROUTES` in `locations.ts`.
