"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";

import NavBar from "./NavBar";
import EmployeeTable from "./CurrentEmployeeTable";
import PendingEmployeeTable from "./PendingEmployeeTable";

import { type Employee } from "./types";
import LoadingPage from "~/app/_components/loading";

import styles from "~/styles/Employer/EmployeeManagement.module.css";
import { Copy, Check, Plus, Trash2, Link2 } from "lucide-react";

interface InviteCode {
    id: number;
    code: string;
    role: string;
    isActive: boolean;
    createdAt: string;
}

const ManageEmployeesPage: React.FC = () => {
    const { isLoaded, userId } = useAuth();
    const router = useRouter();
    const [userRole, setUserRole] = useState("employer" as "owner" | "employer");
    const [loading, setLoading] = useState(true);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [pendingEmployees, setPendingEmployees] = useState<Employee[]>([]);

    // Invite code state
    const [inviteCodes, setInviteCodes] = useState<InviteCode[]>([]);
    const [isGenerating, setIsGenerating] = useState(false);
    const [generateRole, setGenerateRole] = useState<"employer" | "employee">("employee");
    const [copiedCodeId, setCopiedCodeId] = useState<number | null>(null);
    const [copiedLinkId, setCopiedLinkId] = useState<number | null>(null);

    const loadEmployees = useCallback(async () => {
        try {
            const res = await fetch("/api/getAllEmployees", {
                method: "GET",
            });

            const rawData: unknown = await res.json();
            if (Array.isArray(rawData)) {
                const data = rawData as Employee[];
                
                const approved = data.filter((emp) => emp.status === "verified");
                const pending = data.filter((emp) => emp.status === "pending");

                setEmployees(approved);
                setPendingEmployees(pending);
            } else {
                console.error("Invalid employee data received");
                setEmployees([]);
                setPendingEmployees([]);
            }
        } catch (error) {
            console.error("Error loading employees:", error);
        }
    }, []);

    const loadInviteCodes = useCallback(async () => {
        try {
            const res = await fetch("/api/invite-codes", { method: "GET" });
            const rawData: unknown = await res.json();
            if (typeof rawData === "object" && rawData !== null && "data" in rawData) {
                const data = rawData as { data: InviteCode[] };
                setInviteCodes(data.data);
            }
        } catch (error) {
            console.error("Error loading invite codes:", error);
        }
    }, []);

    useEffect(() => {
        if (!isLoaded || !userId) return;

        const checkRole = async () => {
            try {
                const response = await fetch("/api/fetchUserInfo", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ userId }),
                });

                if (!response.ok) {
                    window.alert("Authentication failed! No user found.");
                    router.push("/");
                    return;
                }

                const rawData: unknown = await response.json();
                const data = rawData as { role?: string };
                const roleFromServer = data?.role;

                if (roleFromServer === "employer" || roleFromServer === "owner") {
                    setUserRole(roleFromServer);
                    await Promise.all([loadEmployees(), loadInviteCodes()]);
                } else {
                    window.alert("Authentication failed! You are not an employer or owner.");
                    router.push("/");
                }
            } catch (error) {
                console.error("Error checking role:", error);
                window.alert("Authentication failed! You are not an employer or owner.");
                router.push("/");
            } finally {
                setLoading(false);
            }
        };

        checkRole().catch(console.error);
    }, [isLoaded, userId, router, loadEmployees, loadInviteCodes]);

    const handleRemoveEmployee = async (employeeId: string) => {
        try {
            await fetch("/api/removeEmployees", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ employeeId }),
            });

            await loadEmployees();
        } catch (error) {
            console.error("Error removing employee:", error);
        }
    };

    const handleApproveEmployee = async (employeeId: string) => {
        try {
            await fetch("/api/approveEmployees", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ employeeId }),
            });

            await loadEmployees();
        } catch (error) {
            console.error("Error approving employee:", error);
        }
    };

    // ─── Invite Code Handlers ────────────────────────────────────────────────

    const handleGenerateCode = async () => {
        setIsGenerating(true);
        try {
            const res = await fetch("/api/invite-codes/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ role: generateRole }),
            });

            const rawData: unknown = await res.json();
            if (res.ok && typeof rawData === "object" && rawData !== null && "data" in rawData) {
                const data = rawData as { data: InviteCode };
                setInviteCodes((prev) => [...prev, data.data]);
            }
        } catch (error) {
            console.error("Error generating invite code:", error);
        } finally {
            setIsGenerating(false);
        }
    };

    const handleDeactivateCode = async (codeId: number) => {
        try {
            await fetch("/api/invite-codes/deactivate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ codeId }),
            });

            setInviteCodes((prev) => prev.filter((c) => c.id !== codeId));
        } catch (error) {
            console.error("Error deactivating invite code:", error);
        }
    };

    const handleCopyCode = async (code: string, id: number) => {
        try {
            await navigator.clipboard.writeText(code);
            setCopiedCodeId(id);
            setTimeout(() => setCopiedCodeId(null), 2000);
        } catch {
            console.error("Failed to copy to clipboard");
        }
    };

    const handleCopyLink = async (code: string, id: number) => {
        try {
            const link = `${window.location.origin}/signup?code=${encodeURIComponent(code)}`;
            await navigator.clipboard.writeText(link);
            setCopiedLinkId(id);
            setTimeout(() => setCopiedLinkId(null), 2000);
        } catch {
            console.error("Failed to copy link to clipboard");
        }
    };

    if (loading) {
        return <LoadingPage />;
    }

    return (
        <div className={styles.container}>
            <NavBar />

            <main className={styles.main}>
                <h1 className={styles.welcomeTitle}>Manage Employees</h1>

                {/* ── Invite Codes Section ─────────────────────────── */}
                <section className={styles.employeeSection}>
                    <h2 className={styles.sectionTitle}>Invite Codes</h2>

                    <div className={styles.inviteCodeControls}>
                        <select
                            className={styles.roleSelect}
                            value={generateRole}
                            onChange={(e) => setGenerateRole(e.target.value as "employer" | "employee")}
                        >
                            <option value="employee">Employee</option>
                            <option value="employer">Manager</option>
                        </select>
                        <button
                            className={styles.generateButton}
                            onClick={handleGenerateCode}
                            disabled={isGenerating}
                        >
                            <Plus className={styles.generateIcon} />
                            {isGenerating ? "Generating..." : "Generate Code"}
                        </button>
                    </div>

                    {inviteCodes.length === 0 ? (
                        <p className={styles.emptyStateText}>
                            No active invite codes. Generate one to share with your team.
                        </p>
                    ) : (
                        <table className={styles.employeeTable}>
                            <thead>
                                <tr>
                                    <th>Code</th>
                                    <th>Role</th>
                                    <th>Created</th>
                                    <th>Link</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {inviteCodes.map((ic) => (
                                    <tr key={ic.id}>
                                        <td>
                                            <span className={styles.codeDisplay}>{ic.code}</span>
                                        </td>
                                        <td>
                                            <span className={`${styles.roleBadge} ${ic.role === "employer" ? styles.roleBadgeManager : ""}`}>
                                                {ic.role === "employer" ? "Manager" : "Employee"}
                                            </span>
                                        </td>
                                        <td>{new Date(ic.createdAt).toLocaleDateString()}</td>
                                        <td>
                                            <button
                                                className={styles.linkButton}
                                                onClick={() => handleCopyLink(ic.code, ic.id)}
                                                title="Copy invite link"
                                            >
                                                {copiedLinkId === ic.id ? (
                                                    <Check className={styles.copyIcon} />
                                                ) : (
                                                    <Link2 className={styles.copyIcon} />
                                                )}
                                                {copiedLinkId === ic.id ? "Copied!" : "Copy Link"}
                                            </button>
                                        </td>
                                        <td>
                                            <button
                                                className={styles.copyButton}
                                                onClick={() => handleCopyCode(ic.code, ic.id)}
                                                title="Copy code"
                                            >
                                                {copiedCodeId === ic.id ? (
                                                    <Check className={styles.copyIcon} />
                                                ) : (
                                                    <Copy className={styles.copyIcon} />
                                                )}
                                                {copiedCodeId === ic.id ? "Copied!" : "Copy"}
                                            </button>
                                            <button
                                                className={styles.removeButton}
                                                onClick={() => handleDeactivateCode(ic.id)}
                                                title="Deactivate code"
                                            >
                                                <Trash2 className={styles.copyIcon} />
                                                Deactivate
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </section>

                <section className={styles.employeeSection}>
                    <h2 className={styles.sectionTitle}>All Employees</h2>
                    <EmployeeTable
                        employees={employees}
                        onRemove={handleRemoveEmployee}
                        currentUserRole={userRole} 
                    />
                </section>

                <section className={styles.employeeSection}>
                    <h2 className={styles.sectionTitle}>Pending Approvals</h2>
                    <PendingEmployeeTable
                        employees={pendingEmployees}
                        onApprove={handleApproveEmployee}
                        onRemove={handleRemoveEmployee}
                    />
                </section>
            </main>
        </div>
    );
};

export default ManageEmployeesPage;
