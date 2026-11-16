/** @jest-environment jsdom */
import React from "react";
import { fireEvent, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { renderWithLocale } from "~/i18n/testing/render";
import { ReviewBusinessRoleForm } from "~/app/employer/tools/vantage/_components/ReviewBusinessRoleForm";
import type { WeeklyReviewRoleDto } from "~/server/vantage/weekly-review-client-types";

const role: NonNullable<WeeklyReviewRoleDto["role"]> = {
    schemaVersion: "vantage-business-role/v1",
    primaryRole: "Finance lead",
    responsibilities: ["Forecast cash flow"],
    priorities: ["Extend runway"],
    confirmedBy: "person",
    companyId: "1",
    revision: 3,
    confirmed: true,
};
const confirmName = "I confirm these are my current business responsibilities and priorities.";
function expandRole() {
    // The role form is visible in its Context card.
}

describe("confirmed business role form", () => {
    it("requires confirmation and sends normalized explicit fields", () => {
        const save = jest.fn(async () => {});
        renderWithLocale(
            <ReviewBusinessRoleForm role={null} disabled={false} onSave={save} />,
            "en"
        );
        expandRole();
        fireEvent.change(screen.getByLabelText("Primary business role"), {
            target: { value: " Finance lead " },
        });
        fireEvent.change(screen.getByLabelText("Responsibilities"), {
            target: { value: " Cash flow \n\n Forecasting " },
        });
        fireEvent.change(screen.getByLabelText("Priorities"), {
            target: { value: " Extend runway " },
        });
        const button = screen.getByRole("button", { name: "Confirm and save" });
        expect(button).toBeDisabled();
        fireEvent.click(screen.getByRole("checkbox", { name: confirmName }));
        fireEvent.click(button);
        expect(save).toHaveBeenCalledWith({
            primaryRole: "Finance lead",
            responsibilities: ["Cash flow", "Forecasting"],
            priorities: ["Extend runway"],
            confirmed: true,
        });
    });

    it("resets confirmation when responsibilities change", () => {
        renderWithLocale(
            <ReviewBusinessRoleForm role={role} disabled={false} onSave={jest.fn()} />,
            "en"
        );
        expandRole();
        fireEvent.click(screen.getByRole("checkbox", { name: confirmName }));
        expect(screen.getByRole("button", { name: "Confirm and save" })).toBeDisabled();
        fireEvent.change(screen.getByLabelText("Responsibilities"), {
            target: { value: "New responsibility" },
        });
        expect(screen.getByRole("checkbox", { name: confirmName })).not.toBeChecked();
        expect(screen.getByRole("button", { name: "Confirm and save" })).toBeDisabled();
    });

    it.each([
        ["too many responsibilities", "Responsibilities", Array<string>(9).fill("work").join("\n")],
        ["an overlong priority", "Priorities", "x".repeat(161)],
    ])("prevents saving %s", (_name, label, value) => {
        renderWithLocale(
            <ReviewBusinessRoleForm role={role} disabled={false} onSave={jest.fn()} />,
            "en"
        );
        expandRole();
        fireEvent.change(screen.getByLabelText(label), { target: { value } });
        fireEvent.click(screen.getByRole("checkbox", { name: confirmName }));
        expect(screen.getByRole("button", { name: "Confirm and save" })).toBeDisabled();
    });

    it("clears saved context only after confirming the dialog", () => {
        const save = jest.fn(async () => {});
        renderWithLocale(
            <ReviewBusinessRoleForm role={role} disabled={false} onSave={save} />,
            "en"
        );
        expandRole();
        fireEvent.click(screen.getByRole("button", { name: "Clear business role" }));
        expect(save).not.toHaveBeenCalled();
        expect(screen.getByRole("dialog")).toBeInTheDocument();
        fireEvent.click(screen.getByTestId("confirm-accept"));
        expect(save).toHaveBeenCalledWith(null);
    });

    it("disables every editor and mutation for a read-only actor", () => {
        renderWithLocale(
            <ReviewBusinessRoleForm role={role} disabled={true} onSave={jest.fn()} />,
            "en"
        );
        expandRole();
        expect(screen.getByLabelText("Primary business role")).toBeDisabled();
        expect(screen.getByLabelText("Responsibilities")).toBeDisabled();
        expect(screen.getByLabelText("Priorities")).toBeDisabled();
        expect(screen.getByRole("checkbox", { name: confirmName })).toBeDisabled();
        expect(screen.getByRole("button", { name: "Confirm and save" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "Clear business role" })).toBeDisabled();
    });
});

it("starts blank without inferring the human role", () => {
    renderWithLocale(
        <ReviewBusinessRoleForm role={null} disabled={false} onSave={jest.fn()} />,
        "en"
    );
    expect(screen.getByLabelText("Primary business role")).toHaveValue("");
});
it("allows cancelling role deletion", () => {
    const save = jest.fn();
    renderWithLocale(<ReviewBusinessRoleForm role={role} disabled={false} onSave={save} />, "en");
    fireEvent.click(screen.getByRole("button", { name: "Clear business role" }));
    fireEvent.click(screen.getByTestId("confirm-cancel"));
    expect(save).not.toHaveBeenCalled();
});
