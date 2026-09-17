import { buildInvitationMenuItems, buildMemberMenuItems } from "../peopleContextMenu";
import type { Invitation, Member } from "../api";

const member: Member = {
    id: 1,
    authUserId: "u1",
    name: "Ada",
    email: "ada@example.com",
    role: "member",
    roleName: "Member",
    status: "active",
    groups: [],
    joinedAt: "2026-01-01T00:00:00Z",
    lastActiveAt: null,
    isSelf: false,
};
const roles = [
    { slug: "admin", name: "Admin" },
    { slug: "member", name: "Member" },
];
const handlers = () => ({
    onChangeRole: jest.fn(),
    onCopyEmail: jest.fn(),
    onApprove: jest.fn(),
    onReinstate: jest.fn(),
    onSuspend: jest.fn(),
    onTransfer: jest.fn(),
    onRemove: jest.fn(),
});

describe("member menu builder", () => {
    it("mirrors what an admin can do to an active member", () => {
        const h = handlers();
        const items = buildMemberMenuItems(
            member,
            { roles, roleEditable: true, canManage: true, canTransfer: true, owner: false, busy: false },
            h
        );
        expect(items.map(i => i.id)).toEqual([
            "title",
            "role",
            "copy-email",
            "sep-access",
            "suspend",
            "transfer",
            "sep-danger",
            "remove",
        ]);
        const role = items.find(i => i.id === "role");
        const admin = role?.type === "submenu" ? role.items.find(i => i.id === "role-admin") : null;
        if (admin?.type === "item") admin.onSelect();
        expect(h.onChangeRole).toHaveBeenCalledWith("admin");
        expect(role?.type === "submenu" ? role.items.find(i => i.id === "role-member") : null).toMatchObject({
            checked: true,
            disabled: true,
        });
    });

    it("offers approve to a pending member and reinstate to a suspended one", () => {
        const state = { roles, roleEditable: false, canManage: true, canTransfer: false, owner: false, busy: false };
        const pending = buildMemberMenuItems({ ...member, status: "pending" }, state, handlers());
        expect(pending.map(i => i.id)).toEqual(["title", "copy-email", "sep-access", "approve", "sep-danger", "remove"]);
        const suspended = buildMemberMenuItems({ ...member, status: "suspended" }, state, handlers());
        expect(suspended.find(i => i.id === "reinstate")).toBeDefined();
    });

    it("gives yourself and the owner only the harmless verbs", () => {
        const state = { roles, roleEditable: false, canManage: true, canTransfer: true, owner: false, busy: false };
        expect(buildMemberMenuItems({ ...member, isSelf: true }, state, handlers()).map(i => i.id)).toEqual([
            "title",
            "copy-email",
        ]);
        expect(
            buildMemberMenuItems(member, { ...state, owner: true }, handlers()).map(i => i.id)
        ).toEqual(["title", "copy-email"]);
    });
});

describe("invitation menu builder", () => {
    const invitation: Invitation = {
        id: 7,
        email: "new@example.com",
        role: "member",
        roleName: "Member",
        groupIds: [],
        invitedBy: null,
        createdAt: "2026-01-01T00:00:00Z",
        expiresAt: "2026-02-01T00:00:00Z",
        status: "pending",
    };

    it("resends and revokes an open invitation, but only copies a closed one", () => {
        const open = buildInvitationMenuItems(invitation, { open: true, busy: false }, {
            onResend: jest.fn(),
            onCopyEmail: jest.fn(),
            onRevoke: jest.fn(),
        });
        expect(open.map(i => i.id)).toEqual(["title", "resend", "copy-email", "sep-danger", "revoke"]);
        const closed = buildInvitationMenuItems(
            { ...invitation, status: "accepted" },
            { open: false, busy: false },
            { onResend: jest.fn(), onCopyEmail: jest.fn(), onRevoke: jest.fn() }
        );
        expect(closed.map(i => i.id)).toEqual(["title", "copy-email"]);
    });
});
