import type { useTranslations } from "next-intl";

import type { ActionMenuItem } from "~/components/ui/action-menu";
import type { Invitation, Member } from "./api";

/** `useTranslations("settings.people.menu")`, passed in by the row that opens the menu. */
export type PeopleMenuT = ReturnType<typeof useTranslations<"settings.people.menu">>;

/**
 * Declarative items for a member row and an invitation row. They mirror the
 * rows' own controls — the role picker, the "⋯" menu, the resend and revoke
 * buttons — so right-click never offers something the row cannot.
 */

export interface MemberMenuState {
    roles: { slug: string; name: string }[];
    roleEditable: boolean;
    canManage: boolean;
    canTransfer: boolean;
    owner: boolean;
    busy: boolean;
}

export interface MemberMenuHandlers {
    onChangeRole: (role: string) => void;
    onCopyEmail: () => void;
    onApprove: () => void;
    onReinstate: () => void;
    onSuspend: () => void;
    onTransfer: () => void;
    onRemove: () => void;
}

export function buildMemberMenuItems(
    member: Member,
    state: MemberMenuState,
    handlers: MemberMenuHandlers,
    t: PeopleMenuT
): ActionMenuItem[] {
    const busyReason = state.busy ? t("stillSaving") : undefined;
    const items: ActionMenuItem[] = [
        { type: "label", id: "title", label: member.name || member.email },
    ];
    if (state.roleEditable) {
        items.push({
            type: "submenu",
            id: "role",
            label: t("changeRole"),
            icon: "user",
            disabled: state.busy,
            disabledReason: busyReason,
            items: state.roles.map(role => ({
                type: "item" as const,
                id: `role-${role.slug}`,
                label: role.name,
                icon: role.slug === member.role ? "check" : undefined,
                checked: role.slug === member.role,
                disabled: role.slug === member.role,
                onSelect: () => handlers.onChangeRole(role.slug),
            })),
        });
    }
    items.push({
        type: "item",
        id: "copy-email",
        label: t("copyEmail"),
        icon: "mail",
        onSelect: handlers.onCopyEmail,
    });
    if (member.isSelf) return items;

    const access: ActionMenuItem[] = [];
    if (state.canManage && member.status === "pending") {
        access.push({
            type: "item",
            id: "approve",
            label: t("approve"),
            icon: "check",
            disabled: state.busy,
            disabledReason: busyReason,
            onSelect: handlers.onApprove,
        });
    }
    if (state.canManage && member.status === "active" && !state.owner) {
        access.push({
            type: "item",
            id: "suspend",
            label: t("suspend"),
            icon: "lock",
            disabled: state.busy,
            disabledReason: busyReason,
            onSelect: handlers.onSuspend,
        });
    }
    if (state.canManage && member.status === "suspended") {
        access.push({
            type: "item",
            id: "reinstate",
            label: t("reinstate"),
            icon: "restore",
            disabled: state.busy,
            disabledReason: busyReason,
            onSelect: handlers.onReinstate,
        });
    }
    if (state.canTransfer && member.status === "active" && !state.owner) {
        access.push({
            type: "item",
            id: "transfer",
            label: t("transfer"),
            icon: "userPlus",
            disabled: state.busy,
            disabledReason: busyReason,
            onSelect: handlers.onTransfer,
        });
    }
    if (access.length > 0) items.push({ type: "separator", id: "sep-access" }, ...access);
    if (state.canManage && !state.owner) {
        items.push({ type: "separator", id: "sep-danger" });
        items.push({
            type: "item",
            id: "remove",
            label: t("remove"),
            icon: "userMinus",
            danger: true,
            disabled: state.busy,
            disabledReason: busyReason,
            onSelect: handlers.onRemove,
        });
    }
    return items;
}

export interface InvitationMenuHandlers {
    onResend: () => void;
    onCopyEmail: () => void;
    onRevoke: () => void;
}

export function buildInvitationMenuItems(
    invitation: Invitation,
    state: { open: boolean; busy: boolean },
    handlers: InvitationMenuHandlers,
    t: PeopleMenuT
): ActionMenuItem[] {
    const items: ActionMenuItem[] = [{ type: "label", id: "title", label: invitation.email }];
    if (state.open) {
        items.push({
            type: "item",
            id: "resend",
            label: t("resend"),
            icon: "send",
            disabled: state.busy,
            disabledReason: state.busy ? t("stillResending") : undefined,
            onSelect: handlers.onResend,
        });
    }
    items.push({
        type: "item",
        id: "copy-email",
        label: t("copyEmail"),
        icon: "mail",
        onSelect: handlers.onCopyEmail,
    });
    if (state.open) {
        items.push({ type: "separator", id: "sep-danger" });
        items.push({
            type: "item",
            id: "revoke",
            label: t("revoke"),
            icon: "delete",
            danger: true,
            disabled: state.busy,
            onSelect: handlers.onRevoke,
        });
    }
    return items;
}
