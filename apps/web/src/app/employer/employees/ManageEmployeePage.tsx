"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Check, Copy, Link2, Plus, Trash2 } from "lucide-react";

import EmployeeTable from "./CurrentEmployeeTable";
import PendingEmployeeTable from "./PendingEmployeeTable";
import { type Employee } from "./types";

import LoadingPage from "~/app/_components/loading";
import { EmployerChrome } from "~/app/employer/_components/EmployerChrome";
import {
  Badge,
  Button,
  Card,
  PageHeader,
  PageShell,
  Section,
  SelectInput,
} from "~/app/employer/_components/primitives";

interface InviteCode {
  id: number;
  code: string;
  role: string;
  isActive: boolean;
  createdAt: string;
}

export default function ManageEmployeesPage() {
  const { isLoaded, userId } = useAuth();
  const router = useRouter();
  const [userRole, setUserRole] = useState<"owner" | "employer">("employer");
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [pendingEmployees, setPendingEmployees] = useState<Employee[]>([]);

  const [inviteCodes, setInviteCodes] = useState<InviteCode[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateRole, setGenerateRole] = useState<"employer" | "employee">(
    "employee",
  );
  const [copiedCodeId, setCopiedCodeId] = useState<number | null>(null);
  const [copiedLinkId, setCopiedLinkId] = useState<number | null>(null);

  const loadEmployees = useCallback(async () => {
    try {
      const res = await fetch("/api/getAllEmployees", { method: "GET" });
      const rawData: unknown = await res.json();
      if (Array.isArray(rawData)) {
        const data = rawData as Employee[];
        setEmployees(data.filter((e) => e.status === "verified"));
        setPendingEmployees(data.filter((e) => e.status === "pending"));
      } else {
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
          router.push("/");
          return;
        }
        const data = (await response.json()) as { role?: string };
        const roleFromServer = data?.role;
        if (roleFromServer === "employer" || roleFromServer === "owner") {
          setUserRole(roleFromServer);
          await Promise.all([loadEmployees(), loadInviteCodes()]);
        } else {
          router.push("/");
        }
      } catch (error) {
        console.error(error);
        router.push("/");
      } finally {
        setLoading(false);
      }
    };
    void checkRole();
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
      console.error(error);
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
      console.error(error);
    }
  };

  const handleGenerateCode = async () => {
    setIsGenerating(true);
    try {
      const res = await fetch("/api/invite-codes/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: generateRole }),
      });
      const rawData: unknown = await res.json();
      if (
        res.ok &&
        typeof rawData === "object" &&
        rawData !== null &&
        "data" in rawData
      ) {
        const data = rawData as { data: InviteCode };
        setInviteCodes((prev) => [...prev, data.data]);
      }
    } catch (error) {
      console.error(error);
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
      console.error(error);
    }
  };

  const copy = async (text: string, id: number, setter: (v: number | null) => void) => {
    try {
      await navigator.clipboard.writeText(text);
      setter(id);
      setTimeout(() => setter(null), 2000);
    } catch {
      // ignore
    }
  };

  if (loading) return <LoadingPage />;

  return (
    <>
      <EmployerChrome pageLabel="Launchstack" pageTitle="Workspace" />
      <PageShell wide>
        <PageHeader
          eyebrow={userRole === "owner" ? "Owner · workspace" : "Employer · workspace"}
          title="Manage your team"
          description="Invite teammates, approve pending signups, and manage active employees. Invite codes give one-click access — anyone with the code can join as the role you assigned."
          actions={
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <div style={{ width: 140 }}>
                <SelectInput
                  value={generateRole}
                  onChange={(e) =>
                    setGenerateRole(e.target.value as "employer" | "employee")
                  }
                >
                  <option value="employee">Employee</option>
                  <option value="employer">Manager</option>
                </SelectInput>
              </div>
              <Button
                onClick={() => void handleGenerateCode()}
                disabled={isGenerating}
              >
                <Plus style={{ width: 14, height: 14 }} />
                {isGenerating ? "Generating…" : "Generate invite code"}
              </Button>
            </div>
          }
        />

        <Section
          title="Invite codes"
          description="Codes are single-purpose: anyone with one can sign up as the chosen role. Deactivate anytime."
        >
          <Card padding={0}>
            {inviteCodes.length === 0 ? (
              <div
                style={{
                  padding: "28px 20px",
                  textAlign: "center",
                  color: "var(--ink-3)",
                  fontSize: 13,
                }}
              >
                No active invite codes. Generate one above to share with your team.
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: 13,
                  }}
                >
                  <thead>
                    <tr
                      style={{
                        background: "var(--line-2)",
                        textAlign: "left",
                      }}
                    >
                      {["Code", "Role", "Created", "Share", "Actions"].map((h) => (
                        <th
                          key={h}
                          className="mono"
                          style={{
                            padding: "10px 14px",
                            fontSize: 10,
                            fontWeight: 700,
                            letterSpacing: "0.08em",
                            color: "var(--ink-3)",
                            textTransform: "uppercase",
                            borderBottom: "1px solid var(--line)",
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {inviteCodes.map((ic, i) => (
                      <tr
                        key={ic.id}
                        style={{
                          borderBottom:
                            i < inviteCodes.length - 1
                              ? "1px solid var(--line)"
                              : "none",
                        }}
                      >
                        <td style={{ padding: "10px 14px" }}>
                          <span
                            className="mono"
                            style={{
                              fontSize: 12,
                              padding: "3px 8px",
                              borderRadius: 6,
                              background: "var(--line-2)",
                              color: "var(--ink)",
                            }}
                          >
                            {ic.code}
                          </span>
                        </td>
                        <td style={{ padding: "10px 14px" }}>
                          <Badge tone={ic.role === "employer" ? "accent" : "neutral"}>
                            {ic.role === "employer" ? "Manager" : "Employee"}
                          </Badge>
                        </td>
                        <td
                          style={{
                            padding: "10px 14px",
                            color: "var(--ink-3)",
                          }}
                          className="mono"
                        >
                          {new Date(ic.createdAt).toLocaleDateString()}
                        </td>
                        <td style={{ padding: "10px 14px" }}>
                          <Button
                            variant="secondary"
                            onClick={() =>
                              void copy(
                                `${window.location.origin}/signup?code=${encodeURIComponent(ic.code)}`,
                                ic.id,
                                setCopiedLinkId,
                              )
                            }
                            style={{ padding: "5px 10px" }}
                          >
                            {copiedLinkId === ic.id ? (
                              <Check style={{ width: 12, height: 12 }} />
                            ) : (
                              <Link2 style={{ width: 12, height: 12 }} />
                            )}
                            {copiedLinkId === ic.id ? "Copied" : "Copy link"}
                          </Button>
                        </td>
                        <td style={{ padding: "10px 14px" }}>
                          <div style={{ display: "flex", gap: 6 }}>
                            <Button
                              variant="secondary"
                              onClick={() => void copy(ic.code, ic.id, setCopiedCodeId)}
                              style={{ padding: "5px 10px" }}
                            >
                              {copiedCodeId === ic.id ? (
                                <Check style={{ width: 12, height: 12 }} />
                              ) : (
                                <Copy style={{ width: 12, height: 12 }} />
                              )}
                              {copiedCodeId === ic.id ? "Copied" : "Code"}
                            </Button>
                            <Button
                              variant="danger"
                              onClick={() => void handleDeactivateCode(ic.id)}
                              style={{ padding: "5px 10px" }}
                            >
                              <Trash2 style={{ width: 12, height: 12 }} />
                              Deactivate
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </Section>

        <Section
          title="Pending approvals"
          description="Signups waiting for your confirmation. Approve to grant access, deny to reject."
        >
          <Card padding={0}>
            <PendingEmployeeTable
              employees={pendingEmployees}
              onApprove={handleApproveEmployee}
              onRemove={handleRemoveEmployee}
            />
          </Card>
        </Section>

        <Section
          title="Active employees"
          description={`${employees.length} verified. Remove access at any time.`}
        >
          <Card padding={0}>
            <EmployeeTable
              employees={employees}
              onRemove={handleRemoveEmployee}
              currentUserRole={userRole}
            />
          </Card>
        </Section>
      </PageShell>
    </>
  );
}
