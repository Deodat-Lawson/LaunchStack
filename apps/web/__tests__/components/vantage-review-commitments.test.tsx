/** @jest-environment jsdom */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
jest.mock("next-intl", () => ({
    useTranslations: () => (key: string, values?: Record<string, unknown>) =>
        values ? `${key} ${Object.values(values).join(" ")}` : key,
}));
jest.mock("~/app/employer/tools/vantage/_lib/weekly-review-errors", () => ({
    useWeeklyReviewErrorText: () => () => "Request failed",
}));
jest.mock("~/app/employer/tools/vantage/_lib/format", () => ({
    useVantageFormat: () => ({
        date: (value: string) => value,
        dateLong: (value: string) => value,
        dateTime: (value: string) => value,
        list: (values: string[]) => values.join(", "),
        number: (value: number) => String(value),
    }),
}));
let mockNav: { linkFor: (href: string) => string; navigate: jest.Mock } | null = null;
jest.mock("~/components/tool-app/nav", () => ({ useOptionalToolNav: () => mockNav }));

import { ReviewCommitmentDialog } from "~/app/employer/tools/vantage/_components/ReviewCommitmentDialog";
import { vantageApi } from "~/app/employer/tools/vantage/api";
import { toast } from "sonner";
jest.mock("~/app/employer/tools/vantage/api", () => ({ vantageApi: { addCommitment: jest.fn() } }));
jest.mock("sonner", () => ({ toast: { success: jest.fn() } }));
const topic = {
    id: "topic-0",
    proposedNextStep: "Check the renewal",
    proposedOwner: "Rae",
    proposedDue: "2026-11-20",
} as any;
beforeEach(() => {
    jest.clearAllMocks();
    mockNav = null;
});
test("prefills only proposal fields, keeps acceptance test empty, and creates only on confirmation", async () => {
    const onAdded = jest.fn();
    const onClose = jest.fn();
    (vantageApi.addCommitment as jest.Mock).mockResolvedValue({ commitment: { id: "c1" } });
    render(<ReviewCommitmentDialog topic={topic} onAdded={onAdded} onClose={onClose} />);
    expect(screen.getByLabelText("founder.commitmentTitle")).toHaveValue("Check the renewal");
    expect(screen.getByLabelText("founder.commitmentOwner")).toHaveValue("Rae");
    expect(screen.getByLabelText("founder.commitmentDue")).toHaveValue("2026-11-20");
    expect(screen.getByLabelText("founder.commitmentTest")).toHaveValue("");
    expect(vantageApi.addCommitment).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("founder.commitmentTest"), {
        target: { value: "Renewal signed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "founder.confirmCommitment" }));
    await waitFor(() => expect(onAdded).toHaveBeenCalledTimes(1));
    expect(vantageApi.addCommitment).toHaveBeenCalledWith({
        title: "Check the renewal",
        owner: "Rae",
        dueOn: "2026-11-20",
        test: "Renewal signed",
    });
    expect(onClose).toHaveBeenCalledTimes(1);
});
test("unsupported owner and date remain empty and block confirmation", () => {
    render(
        <ReviewCommitmentDialog
            topic={{ ...topic, proposedOwner: null, proposedDue: null }}
            onAdded={jest.fn()}
            onClose={jest.fn()}
        />
    );
    expect(screen.getByLabelText("founder.commitmentOwner")).toHaveValue("");
    expect(screen.getByLabelText("founder.commitmentDue")).toHaveValue("");
    expect(screen.getByRole("button", { name: "founder.confirmCommitment" })).toBeDisabled();
});

test("the success toast link works outside the tool provider", async () => {
    const navigate = jest.fn();
    mockNav = { navigate, linkFor: () => "/employer/documents?feature=vantage&at=%2Fcommitments" };
    (vantageApi.addCommitment as jest.Mock).mockResolvedValue({ commitment: { id: "c2" } });
    const view = render(
        <ReviewCommitmentDialog topic={topic} onAdded={jest.fn()} onClose={jest.fn()} />
    );
    fireEvent.click(screen.getByRole("button", { name: "founder.confirmCommitment" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    const options = (toast.success as jest.Mock).mock.calls[0]![1] as {
        description: React.ReactNode;
    };
    view.unmount();
    render(<>{options.description}</>);
    const link = screen.getByRole("link", { name: "founder.commitmentLink" });
    expect(link).toHaveAttribute("href", "/employer/documents?feature=vantage&at=%2Fcommitments");
    fireEvent.click(link);
    expect(navigate).toHaveBeenCalledWith("/commitments");
});
