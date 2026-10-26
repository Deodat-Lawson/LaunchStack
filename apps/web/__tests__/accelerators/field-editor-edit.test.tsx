/** @jest-environment jsdom */

/**
 * Selected-text editing in the real Accelerators editor: the provider, FieldEditor, the preview
 * panel and the run status, over a mocked API client. These pin what the user sees and what is
 * sent: the selection's UTF-16 range, when entry is allowed, that nothing is applied until Apply,
 * and that a stale or conflicting answer is never overwritten.
 */

import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";

import {
    AcceleratorsApiError,
    acceleratorsApi,
    type AcceleratorApplication,
    type AcceleratorRunView,
    type AcceleratorSection,
    type FormField,
    type HomeResponse,
} from "~/app/employer/tools/accelerators/api";
import { FieldEditor } from "~/app/employer/tools/accelerators/_components/FieldEditor";
import { RunStatus } from "~/app/employer/tools/accelerators/_components/RunStatus";
import {
    AcceleratorsProvider,
    useAccelerators,
} from "~/app/employer/tools/accelerators/_lib/context";

jest.mock("~/app/employer/tools/accelerators/api", () => {
    const actual = jest.requireActual("~/app/employer/tools/accelerators/api");
    const fn = () => jest.fn();
    return {
        ...actual,
        acceleratorsApi: {
            home: fn(),
            program: fn(),
            match: fn(),
            start: fn(),
            application: fn(),
            save: fn(),
            draft: fn(),
            suggest: fn(),
            apply: fn(),
            run: fn(),
        },
    };
});

const api = jest.mocked(acceleratorsApi);

const ANSWER = "Prefix 😀 old suffix";
const EDIT_KEY = "accelerators.edit.v1:t";
const NOW = "2026-06-01T00:00:00Z";

function field(overrides: Partial<FormField> = {}): FormField {
    return {
        key: "traction",
        position: 0,
        question: "Describe your traction",
        guidance: null,
        fieldType: "long_text",
        required: true,
        options: [],
        charLimit: null,
        wordLimit: null,
        limitConfirmed: false,
        limitSource: null,
        ...overrides,
    };
}

function section(overrides: Partial<AcceleratorSection> = {}): AcceleratorSection {
    return {
        id: "sec-1",
        key: "traction",
        field: field(),
        draft: ANSWER,
        revision: 1,
        draftMeta: null,
        ...overrides,
    };
}

function application(sections: AcceleratorSection[]): AcceleratorApplication {
    return {
        id: "app-1",
        title: "aboveA",
        programId: "prog",
        cycleId: "cycle",
        formHash: "hash",
        sections,
    };
}

function homeWith(
    sections: AcceleratorSection[],
    overrides: Partial<HomeResponse> = {}
): HomeResponse {
    return {
        programs: [],
        applications: [application(sections)],
        profileReady: true,
        canEdit: true,
        costs: { match: 2_000, draft: 1_500, edit: 1_000 },
        ...overrides,
    };
}

const RESULT = {
    kind: "accel_edit" as const,
    applicationId: "app-1",
    sectionId: "sec-1",
    suggestion: {
        expectedRevision: 1,
        start: 10,
        end: 13,
        original: "old",
        replacement: "new",
        gaps: [] as string[],
    },
};

function run(overrides: Partial<AcceleratorRunView> = {}): AcceleratorRunView {
    return {
        id: "run-1",
        kind: "accel_edit",
        status: "completed",
        steps: [],
        summary: { headline: "Edit suggested" },
        result: RESULT,
        error: null,
        creditsUsed: 1_000,
        createdAt: NOW,
        startedAt: NOW,
        completedAt: NOW,
        ...overrides,
    };
}

function Harness() {
    const { home } = useAccelerators();
    const current = home?.applications[0];
    if (!current) return <p>loading</p>;
    return (
        <>
            <RunStatus />
            {current.sections.map(item => (
                <FieldEditor key={item.id} applicationId={current.id} section={item} />
            ))}
        </>
    );
}

function mount(sections: AcceleratorSection[], home: Partial<HomeResponse> = {}) {
    api.home.mockResolvedValue(homeWith(sections, home));
    return render(
        <AcceleratorsProvider storageScope="t">
            <Harness />
        </AcceleratorsProvider>
    );
}

const textarea = (name = "Describe your traction") =>
    screen.findByRole<HTMLTextAreaElement>("textbox", { name });

async function select(start: number, end: number, name?: string) {
    const element = await textarea(name);
    element.setSelectionRange(start, end);
    fireEvent.select(element);
}

/** Opens the first Field's editor, so a test with several Fields stays unambiguous. */
async function openEditor() {
    const toggles = await screen.findAllByRole("button", { name: "Edit selected text with AI" });
    fireEvent.click(toggles[0]!);
}

function suggestButton() {
    return screen.getByRole("button", { name: /Suggest an edit/ });
}

async function askForSuggestion(instruction = "Make it clearer") {
    await openEditor();
    await select(10, 13);
    fireEvent.change(screen.getByLabelText("What should change?"), {
        target: { value: instruction },
    });
    fireEvent.click(suggestButton());
    // The started run's state updates belong inside act, before the test awaits anything else.
    await act(async () => undefined);
}

async function showPreview() {
    api.suggest.mockResolvedValue({ run: run() });
    await askForSuggestion();
    await screen.findByText("Suggested edit");
}

/** Let a started run's remaining state updates land inside act, not after the test ends. */
afterEach(async () => {
    await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
    });
});

beforeEach(() => {
    jest.clearAllMocks();
    window.sessionStorage.clear();
    api.run.mockRejectedValue(new Error("unexpected run lookup"));
});

describe("starting an edit", () => {
    it("sends the exact UTF-16 range of the selection, even after an emoji", async () => {
        api.suggest.mockResolvedValue({ run: run({ status: "queued", result: null }) });
        mount([section()]);
        await askForSuggestion();
        expect(screen.getByTestId("edit-selection")).toHaveTextContent(/^old$/);
        await waitFor(() => expect(api.suggest).toHaveBeenCalledTimes(1));
        expect(api.suggest).toHaveBeenCalledWith("app-1", "sec-1", {
            expectedRevision: 1,
            start: 10,
            end: 13,
            instruction: "Make it clearer",
        });
    });

    it("shows the charge before asking and labels the run", async () => {
        api.suggest.mockResolvedValue({ run: run({ status: "running", result: null }) });
        mount([section()]);
        await askForSuggestion();
        await screen.findByText("Editing selected text");
        expect(
            screen.getByRole("button", { name: "Suggest an edit · 1,000 credits" })
        ).toBeInTheDocument();
        expect(
            screen.getByText(/the suggestion is discarded and you are not charged/)
        ).toBeVisible();
    });

    it("cannot be submitted without a selection or an instruction", async () => {
        mount([section()]);
        await openEditor();
        expect(
            screen.getByText("Select the text you want to change in the answer above.")
        ).toBeVisible();
        expect(suggestButton()).toBeDisabled();
        await select(10, 13);
        expect(suggestButton()).toBeDisabled();
        fireEvent.change(screen.getByLabelText("What should change?"), {
            target: { value: "   " },
        });
        expect(suggestButton()).toBeDisabled();
        fireEvent.change(screen.getByLabelText("What should change?"), {
            target: { value: "Shorter" },
        });
        expect(suggestButton()).toBeEnabled();
        expect(api.suggest).not.toHaveBeenCalled();
    });

    it("needs the text saved first, because offsets refer to the saved answer", async () => {
        api.save.mockResolvedValue({ section: section({ draft: `${ANSWER}!`, revision: 2 }) });
        mount([section()]);
        await openEditor();
        fireEvent.change(await textarea(), { target: { value: `${ANSWER}!` } });
        expect(
            screen.getByText(
                "Save your changes first. Selected-text edits apply to the saved answer."
            )
        ).toBeVisible();
        expect(suggestButton()).toBeDisabled();

        fireEvent.click(screen.getByRole("button", { name: "Save answer" }));
        await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
        expect(api.save).toHaveBeenCalledWith("app-1", "sec-1", {
            expectedRevision: 1,
            draft: `${ANSWER}!`,
        });
        await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
        await select(10, 13);
        fireEvent.change(screen.getByLabelText("What should change?"), {
            target: { value: "Shorter" },
        });
        expect(suggestButton()).toBeEnabled();
    });

    it.each([
        ["a non-prose Field", () => mount([section({ field: field({ fieldType: "url" }) })])],
        ["an empty answer", () => mount([section({ draft: null, revision: 0 })])],
        ["a viewer who cannot edit", () => mount([section()], { canEdit: false })],
    ])("offers no edit entry for %s", async (_name, setup) => {
        setup();
        await screen.findByText("Describe your traction");
        expect(
            screen.queryByRole("button", { name: "Edit selected text with AI" })
        ).not.toBeInTheDocument();
    });

    it("offers no edit entry while a newer saved answer conflicts with local text", async () => {
        api.save.mockRejectedValue(
            new AcceleratorsApiError(
                "This answer has changed; reload the latest revision",
                409,
                "revision_conflict"
            )
        );
        api.application.mockResolvedValue({
            application: application([section({ draft: "Someone else saved this", revision: 2 })]),
        });
        mount([section()]);
        fireEvent.change(await textarea(), { target: { value: `${ANSWER}!` } });
        fireEvent.click(screen.getByRole("button", { name: "Save answer" }));
        expect(await screen.findByText("A newer answer was saved")).toBeVisible();
        expect(
            screen.queryByRole("button", { name: "Edit selected text with AI" })
        ).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Use saved answer" }));
        expect(
            await screen.findByRole("button", { name: "Edit selected text with AI" })
        ).toBeVisible();
    });

    it("keeps the basic Draft action for an empty prose Field", async () => {
        api.draft.mockResolvedValue({ run: run({ kind: "accel_draft", result: null }) });
        mount([section({ draft: null, revision: 0 })]);
        fireEvent.click(await screen.findByRole("button", { name: /Draft empty Field/ }));
        await waitFor(() => expect(api.draft).toHaveBeenCalledWith("app-1", "sec-1", 0));
        expect(api.suggest).not.toHaveBeenCalled();
    });

    it("reports a failed start without changing the answer", async () => {
        api.suggest.mockRejectedValue(
            new AcceleratorsApiError(
                "Not enough credits to start this run",
                402,
                "insufficient_credits"
            )
        );
        mount([section()]);
        await askForSuggestion();
        expect(await screen.findByText("Not enough credits to start this run")).toBeVisible();
        expect(await textarea()).toHaveValue(ANSWER);
    });
});

describe("previewing a Suggestion", () => {
    it("shows the original beside the proposal, and the charge, without saving anything", async () => {
        mount([section()]);
        await showPreview();
        expect(screen.getByTestId("suggestion-original")).toHaveTextContent(/^old$/);
        expect(screen.getByTestId("suggestion-proposed")).toHaveTextContent(/^new$/);
        expect(
            screen.getByText(/1,000 credits were used to generate this suggestion/)
        ).toBeVisible();
        expect(await textarea()).toHaveValue(ANSWER);
        expect(api.apply).not.toHaveBeenCalled();
        expect(api.save).not.toHaveBeenCalled();
        expect(window.sessionStorage.getItem(EDIT_KEY)).toBe("run-1");
    });

    it("lists missing information the model reported", async () => {
        api.suggest.mockResolvedValue({
            run: run({
                result: {
                    ...RESULT,
                    suggestion: {
                        ...RESULT.suggestion,
                        replacement: "old",
                        gaps: ["Annual revenue"],
                    },
                },
            }),
        });
        mount([section()]);
        await askForSuggestion("Add our revenue");
        expect(await screen.findByText("Annual revenue")).toBeVisible();
        expect(screen.getByText("No change was made to the selected text.")).toBeVisible();
        expect(screen.getByRole("button", { name: "Apply edit" })).toBeDisabled();
    });

    it("says so when the proposal deletes the selection", async () => {
        api.suggest.mockResolvedValue({
            run: run({
                result: { ...RESULT, suggestion: { ...RESULT.suggestion, replacement: "" } },
            }),
        });
        mount([section()]);
        await askForSuggestion("Remove this");
        expect(await screen.findByText("This removes the selected text.")).toBeVisible();
    });

    it("blocks a second request until the first is applied or discarded", async () => {
        mount([
            section(),
            section({
                id: "sec-2",
                key: "other",
                field: field({ key: "other", question: "Other question" }),
            }),
        ]);
        await showPreview();
        const other = document.querySelector<HTMLElement>('[data-field-key="other"]')!;
        fireEvent.click(within(other).getByRole("button", { name: "Edit selected text with AI" }));
        expect(
            within(other).getByText(
                "Apply or discard the current suggestion before asking for another."
            )
        ).toBeVisible();
        expect(within(other).getByRole("button", { name: /Suggest an edit/ })).toBeDisabled();
    });
});

describe("applying a Suggestion", () => {
    it("sends the validated range, original and replacement, then follows the saved answer", async () => {
        api.apply.mockResolvedValue({
            section: section({ draft: "Prefix 😀 new suffix", revision: 2 }),
        });
        mount([section()]);
        await showPreview();
        fireEvent.click(screen.getByRole("button", { name: "Apply edit" }));
        await waitFor(() => expect(api.apply).toHaveBeenCalledTimes(1));
        expect(api.apply).toHaveBeenCalledWith("app-1", "sec-1", {
            expectedRevision: 1,
            start: 10,
            end: 13,
            original: "old",
            replacement: "new",
        });
        await waitFor(async () => expect(await textarea()).toHaveValue("Prefix 😀 new suffix"));
        expect(screen.queryByText("Suggested edit")).not.toBeInTheDocument();
        expect(window.sessionStorage.getItem(EDIT_KEY)).toBeNull();
        expect(api.suggest).toHaveBeenCalledTimes(1);
    });

    it("does not retry on a conflict: it reloads, keeps the newer text and offers no Apply", async () => {
        api.apply.mockRejectedValue(
            new AcceleratorsApiError(
                "This answer has changed; reload the latest revision",
                409,
                "revision_conflict"
            )
        );
        api.application.mockResolvedValue({
            application: application([section({ draft: "Someone else saved this", revision: 2 })]),
        });
        mount([section()]);
        await showPreview();
        fireEvent.click(screen.getByRole("button", { name: "Apply edit" }));
        expect(
            await screen.findByText("This answer has changed; reload the latest revision")
        ).toBeVisible();
        expect(api.apply).toHaveBeenCalledTimes(1);
        expect(api.application).toHaveBeenCalledWith("app-1");
        await waitFor(async () => expect(await textarea()).toHaveValue("Someone else saved this"));
        expect(screen.queryByRole("button", { name: "Apply edit" })).not.toBeInTheDocument();
        expect(screen.getByText(/can no longer be applied/)).toBeVisible();
    });

    it("cannot be applied while unsaved text would be left conflicting", async () => {
        mount([section()]);
        await showPreview();
        fireEvent.change(await textarea(), { target: { value: `${ANSWER} and more` } });
        expect(screen.getByRole("button", { name: "Apply edit" })).toBeDisabled();
        expect(
            screen.getByText("Save or undo your unsaved changes before applying this edit.")
        ).toBeVisible();
        expect(api.apply).not.toHaveBeenCalled();
        expect(await textarea()).toHaveValue(`${ANSWER} and more`);
    });

    it("reports a failed apply as a failure and leaves the answer as it was", async () => {
        api.apply.mockRejectedValue(new Error("network down"));
        mount([section()]);
        await showPreview();
        fireEvent.click(screen.getByRole("button", { name: "Apply edit" }));
        expect(await screen.findByText("network down")).toBeVisible();
        expect(await textarea()).toHaveValue(ANSWER);
        expect(screen.getByText("Suggested edit")).toBeVisible();
        expect(screen.getByRole("button", { name: "Apply edit" })).toBeEnabled();
    });

    it("keeps Save out of the way while an Apply is in flight", async () => {
        let finish: (value: { section: AcceleratorSection }) => void = () => undefined;
        api.apply.mockReturnValue(new Promise(resolve => (finish = resolve)));
        mount([section()]);
        await showPreview();
        fireEvent.click(screen.getByRole("button", { name: "Apply edit" }));
        await screen.findByRole("button", { name: "Applying…" });
        expect(screen.getByRole("button", { name: "Save answer" })).toBeDisabled();
        finish({ section: section({ draft: "Prefix 😀 new suffix", revision: 2 }) });
        await waitFor(async () => expect(await textarea()).toHaveValue("Prefix 😀 new suffix"));
    });
});

describe("discarding a Suggestion", () => {
    it("leaves the answer and the server untouched, and does not bring the preview back", async () => {
        mount([section()]);
        await showPreview();
        fireEvent.click(screen.getByRole("button", { name: "Discard suggestion" }));
        expect(screen.queryByText("Suggested edit")).not.toBeInTheDocument();
        expect(await textarea()).toHaveValue(ANSWER);
        expect(api.apply).not.toHaveBeenCalled();
        expect(api.save).not.toHaveBeenCalled();
        expect(window.sessionStorage.getItem(EDIT_KEY)).toBeNull();
    });
});

describe("after a reload", () => {
    it("restores a paid Suggestion under its own Field only", async () => {
        window.sessionStorage.setItem(EDIT_KEY, "run-9");
        api.run.mockResolvedValue({ run: run({ id: "run-9" }) });
        mount([
            section(),
            section({
                id: "sec-2",
                key: "other",
                field: field({ key: "other", question: "Other question" }),
            }),
        ]);
        await screen.findByText("Suggested edit");
        expect(api.run).toHaveBeenCalledWith("run-9");
        const own = document.querySelector<HTMLElement>('[data-field-key="traction"]')!;
        const other = document.querySelector<HTMLElement>('[data-field-key="other"]')!;
        expect(within(own).getByText("Suggested edit")).toBeVisible();
        expect(within(other).queryByText("Suggested edit")).not.toBeInTheDocument();
        expect(api.suggest).not.toHaveBeenCalled();
    });

    it("asks for no new Suggestion while a paid one is still being restored", async () => {
        window.sessionStorage.setItem(EDIT_KEY, "run-9");
        let restore: (value: { run: AcceleratorRunView }) => void = () => undefined;
        api.run.mockReturnValue(new Promise(resolve => (restore = resolve)));
        mount([section()]);
        await openEditor();
        await select(10, 13);
        fireEvent.change(screen.getByLabelText("What should change?"), {
            target: { value: "Make it clearer" },
        });
        expect(suggestButton()).toBeDisabled();
        fireEvent.click(suggestButton());
        expect(api.suggest).not.toHaveBeenCalled();

        await act(async () => restore({ run: run({ id: "run-9" }) }));
        expect(await screen.findByText("Suggested edit")).toBeVisible();
        expect(window.sessionStorage.getItem(EDIT_KEY)).toBe("run-9");
    });

    it("allows a new Suggestion once a stored run turns out to hold none", async () => {
        window.sessionStorage.setItem(EDIT_KEY, "run-9");
        api.run.mockResolvedValue({ run: run({ id: "run-9", kind: "programs", result: null }) });
        api.suggest.mockResolvedValue({ run: run() });
        mount([section()]);
        await waitFor(() => expect(window.sessionStorage.getItem(EDIT_KEY)).toBeNull());
        await askForSuggestion();
        expect(api.suggest).toHaveBeenCalledTimes(1);
    });

    it("shows a restored Suggestion for an old revision as stale, with no Apply", async () => {
        window.sessionStorage.setItem(EDIT_KEY, "run-9");
        api.run.mockResolvedValue({ run: run({ id: "run-9" }) });
        mount([section({ revision: 2 })]);
        expect(await screen.findByText(/can no longer be applied/)).toBeVisible();
        expect(screen.queryByRole("button", { name: "Apply edit" })).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Discard suggestion" })).toBeEnabled();
    });

    it("drops a stored run that holds no Suggestion", async () => {
        window.sessionStorage.setItem(EDIT_KEY, "run-9");
        api.run.mockResolvedValue({
            run: run({ id: "run-9", kind: "programs", result: null }),
        });
        mount([section()]);
        await waitFor(() => expect(window.sessionStorage.getItem(EDIT_KEY)).toBeNull());
        expect(screen.queryByText("Suggested edit")).not.toBeInTheDocument();
    });

    it("drops a stored run the server no longer has", async () => {
        window.sessionStorage.setItem(EDIT_KEY, "run-9");
        api.run.mockRejectedValue(new AcceleratorsApiError("Run not found", 404, "run_not_found"));
        mount([section()]);
        await waitFor(() => expect(window.sessionStorage.getItem(EDIT_KEY)).toBeNull());
    });

    it("never starts a run on mount", async () => {
        mount([section()]);
        await screen.findByText("Describe your traction");
        expect(api.suggest).not.toHaveBeenCalled();
        expect(api.draft).not.toHaveBeenCalled();
        expect(api.match).not.toHaveBeenCalled();
    });
});
