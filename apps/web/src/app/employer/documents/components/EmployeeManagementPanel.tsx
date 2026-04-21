"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  Users,
  Plus,
  Trash2,
  Check,
  Copy,
  Link2,
  CheckCircle,
  UserCheck,
  UserX,
  Shield,
  AlertCircle,
  Loader2,
  ChevronDown,
} from "lucide-react";
import { Button } from "~/app/employer/documents/components/ui/button";
import { Badge } from "~/app/employer/documents/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/app/employer/documents/components/ui/table";
import { cn } from "~/lib/utils";
import { toast } from "sonner";

interface Employee {
  id: string;
  name: string;
  email: string;
  role: string;
  status: "verified" | "pending";
}

interface InviteCode {
  id: number;
  code: string;
  role: string;
  isActive: boolean;
  createdAt: string;
}

export function EmployeeManagementPanel() {
  const { isLoaded, userId } = useAuth();
  const [userRole, setUserRole] = useState<"owner" | "employer">("employer");
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [pendingEmployees, setPendingEmployees] = useState<Employee[]>([]);
  const [inviteCodes, setInviteCodes] = useState<InviteCode[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateRole, setGenerateRole] = useState<"employer" | "employee">("employee");
  const [copiedCodeId, setCopiedCodeId] = useState<number | null>(null);
  const [copiedLinkId, setCopiedLinkId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadEmployees = useCallback(async () => {
    try {
      const res = await fetch("/api/getAllEmployees");
      const rawData: unknown = await res.json();
      if (Array.isArray(rawData)) {
        const data = rawData as Employee[];
        setEmployees(data.filter((e) => e.status === "verified"));
        setPendingEmployees(data.filter((e) => e.status === "pending"));
      }
    } catch (err) {
      console.error("Error loading employees:", err);
    }
  }, []);

  const loadInviteCodes = useCallback(async () => {
    try {
      const res = await fetch("/api/invite-codes");
      const rawData: unknown = await res.json();
      if (typeof rawData === "object" && rawData !== null && "data" in rawData) {
        setInviteCodes((rawData as { data: InviteCode[] }).data);
      }
    } catch (err) {
      console.error("Error loading invite codes:", err);
    }
  }, []);

  useEffect(() => {
    if (!isLoaded || !userId) return;

    const init = async () => {
      try {
        const response = await fetch("/api/fetchUserInfo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId }),
        });
        if (!response.ok) { setError("Authentication failed."); return; }
        const data = (await response.json()) as { role?: string };
        if (data?.role === "employer" || data?.role === "owner") {
          setUserRole(data.role);
          await Promise.all([loadEmployees(), loadInviteCodes()]);
        } else {
          setError("You don't have permission to manage employees.");
        }
      } catch (err) {
        setError("Failed to load employee data.");
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    void init();
  }, [isLoaded, userId, loadEmployees, loadInviteCodes]);

  const handleRemove = async (employeeId: string) => {
    try {
      await fetch("/api/removeEmployees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId }),
      });
      await loadEmployees();
      toast.success("Employee removed.");
    } catch { toast.error("Failed to remove employee."); }
  };

  const handleApprove = async (employeeId: string) => {
    try {
      await fetch("/api/approveEmployees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId }),
      });
      await loadEmployees();
      toast.success("Employee approved.");
    } catch { toast.error("Failed to approve employee."); }
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
      if (res.ok && typeof rawData === "object" && rawData !== null && "data" in rawData) {
        setInviteCodes((prev) => [...prev, (rawData as { data: InviteCode }).data]);
        toast.success("Invite code generated.");
      }
    } catch { toast.error("Failed to generate code."); }
    finally { setIsGenerating(false); }
  };

  const handleDeactivateCode = async (codeId: number) => {
    try {
      await fetch("/api/invite-codes/deactivate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codeId }),
      });
      setInviteCodes((prev) => prev.filter((c) => c.id !== codeId));
      toast.success("Code deactivated.");
    } catch { toast.error("Failed to deactivate code."); }
  };

  const handleCopyCode = async (code: string, id: number) => {
    await navigator.clipboard.writeText(code);
    setCopiedCodeId(id);
    setTimeout(() => setCopiedCodeId(null), 2000);
  };

  const handleCopyLink = async (code: string, id: number) => {
    const link = `${window.location.origin}/signup?code=${encodeURIComponent(code)}`;
    await navigator.clipboard.writeText(link);
    setCopiedLinkId(id);
    setTimeout(() => setCopiedLinkId(null), 2000);
  };

  const shouldShowRemove = (employeeRole: string) => {
    if (userRole === "owner") return employeeRole === "employer" || employeeRole === "employee";
    if (userRole === "employer") return employeeRole === "employee";
    return false;
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-purple-600 animate-spin" />
          <p className="text-sm text-muted-foreground">Loading employee data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center bg-background p-8">
        <div className="max-w-sm w-full p-5 rounded-xl border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/30">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-red-700 dark:text-red-400">Access Error</p>
              <p className="text-xs text-red-600/80 mt-1">{error}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-background custom-scrollbar">
      {/* Page Header */}
      <div className="border-b border-border px-8 py-4 flex items-center justify-between sticky top-0 bg-background/90 backdrop-blur-sm z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-purple-600 flex items-center justify-center shadow-sm shadow-purple-500/20">
            <Users className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-foreground leading-none">Employee Management</h1>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {employees.length} active · {pendingEmployees.length} pending
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-8 py-6 space-y-8">

        {/* ── Invite Codes ── */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xs font-black text-muted-foreground uppercase tracking-[0.15em]">Invite Codes</h2>
              <p className="text-[11px] text-muted-foreground mt-0.5">Generate shareable codes for new team members</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <select
                  value={generateRole}
                  onChange={(e) => setGenerateRole(e.target.value as "employer" | "employee")}
                  className="h-8 appearance-none bg-muted border-none rounded-lg pl-3 pr-7 text-xs font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-purple-500 cursor-pointer"
                >
                  <option value="employee">Employee</option>
                  <option value="employer">Manager</option>
                </select>
                <ChevronDown className="w-3 h-3 absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              </div>
              <Button
                size="sm"
                onClick={() => void handleGenerateCode()}
                disabled={isGenerating}
                className="h-8 bg-purple-600 hover:bg-purple-700 text-white gap-1.5 text-xs shadow-sm shadow-purple-500/20"
              >
                {isGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                {isGenerating ? "Generating..." : "Generate Code"}
              </Button>
            </div>
          </div>

          {inviteCodes.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-muted/20 py-10 text-center">
              <Shield className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-sm font-medium text-muted-foreground">No active invite codes</p>
              <p className="text-xs text-muted-foreground mt-0.5">Generate a code to invite team members</p>
            </div>
          ) : (
            <div className="rounded-xl border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-[9px] font-black uppercase tracking-[0.15em]">Code</TableHead>
                    <TableHead className="text-[9px] font-black uppercase tracking-[0.15em]">Role</TableHead>
                    <TableHead className="text-[9px] font-black uppercase tracking-[0.15em]">Created</TableHead>
                    <TableHead className="text-[9px] font-black uppercase tracking-[0.15em] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inviteCodes.map((ic) => (
                    <TableRow key={ic.id} className="hover:bg-muted/30">
                      <TableCell>
                        <code className="text-xs font-mono bg-muted px-2 py-1 rounded text-foreground">{ic.code}</code>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn(
                          "text-[10px] font-bold uppercase",
                          ic.role === "employer"
                            ? "border-blue-200 text-blue-600 dark:border-blue-800 dark:text-blue-400"
                            : "border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-400"
                        )}>
                          {ic.role === "employer" ? "Manager" : "Employee"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(ic.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center gap-1.5 justify-end">
                          <button
                            onClick={() => void handleCopyLink(ic.code, ic.id)}
                            className="h-7 px-2 rounded-md text-[10px] font-semibold flex items-center gap-1 bg-muted hover:bg-purple-50 dark:hover:bg-purple-900/20 hover:text-purple-600 dark:hover:text-purple-400 transition-all"
                            title="Copy invite link"
                          >
                            {copiedLinkId === ic.id ? <Check className="w-3 h-3" /> : <Link2 className="w-3 h-3" />}
                            {copiedLinkId === ic.id ? "Copied!" : "Link"}
                          </button>
                          <button
                            onClick={() => void handleCopyCode(ic.code, ic.id)}
                            className="h-7 px-2 rounded-md text-[10px] font-semibold flex items-center gap-1 bg-muted hover:bg-purple-50 dark:hover:bg-purple-900/20 hover:text-purple-600 dark:hover:text-purple-400 transition-all"
                            title="Copy code"
                          >
                            {copiedCodeId === ic.id ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                            {copiedCodeId === ic.id ? "Copied!" : "Copy"}
                          </button>
                          <button
                            onClick={() => void handleDeactivateCode(ic.id)}
                            className="h-7 px-2 rounded-md text-[10px] font-semibold flex items-center gap-1 text-muted-foreground hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400 transition-all"
                            title="Deactivate"
                          >
                            <Trash2 className="w-3 h-3" />
                            Deactivate
                          </button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>

        {/* ── Active Employees ── */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xs font-black text-muted-foreground uppercase tracking-[0.15em]">Active Employees</h2>
              <p className="text-[11px] text-muted-foreground mt-0.5">{employees.length} verified team members</p>
            </div>
          </div>

          {employees.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-muted/20 py-10 text-center">
              <UserCheck className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-sm font-medium text-muted-foreground">No active employees yet</p>
            </div>
          ) : (
            <div className="rounded-xl border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-[9px] font-black uppercase tracking-[0.15em]">Name</TableHead>
                    <TableHead className="text-[9px] font-black uppercase tracking-[0.15em]">Email</TableHead>
                    <TableHead className="text-[9px] font-black uppercase tracking-[0.15em]">Role</TableHead>
                    <TableHead className="text-[9px] font-black uppercase tracking-[0.15em] text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {employees.map((emp) => (
                    <TableRow key={emp.id} className="hover:bg-muted/30">
                      <TableCell className="font-medium text-sm">{emp.name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{emp.email}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn(
                          "text-[10px] font-bold uppercase",
                          emp.role === "owner"
                            ? "border-purple-200 text-purple-600 dark:border-purple-800 dark:text-purple-400"
                            : emp.role === "employer"
                            ? "border-blue-200 text-blue-600 dark:border-blue-800 dark:text-blue-400"
                            : "border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-400"
                        )}>
                          {emp.role === "employer" ? "Manager" : emp.role}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {shouldShowRemove(emp.role) && (
                          <button
                            onClick={() => void handleRemove(emp.id)}
                            className="h-7 px-2.5 rounded-md text-[10px] font-semibold flex items-center gap-1 ml-auto text-muted-foreground hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400 transition-all"
                          >
                            <Trash2 className="w-3 h-3" />
                            Remove
                          </button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>

        {/* ── Pending Approvals ── */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xs font-black text-muted-foreground uppercase tracking-[0.15em]">Pending Approvals</h2>
              <p className="text-[11px] text-muted-foreground mt-0.5">{pendingEmployees.length} awaiting review</p>
            </div>
            {pendingEmployees.length > 0 && (
              <span className="h-5 px-2 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 text-[10px] font-black flex items-center">
                {pendingEmployees.length} pending
              </span>
            )}
          </div>

          {pendingEmployees.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-muted/20 py-10 text-center">
              <UserCheck className="w-8 h-8 text-emerald-500/40 mx-auto mb-2" />
              <p className="text-sm font-medium text-muted-foreground">No pending approvals</p>
              <p className="text-xs text-muted-foreground mt-0.5">All requests have been reviewed</p>
            </div>
          ) : (
            <div className="rounded-xl border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-amber-50/50 dark:bg-amber-900/10">
                    <TableHead className="text-[9px] font-black uppercase tracking-[0.15em]">Name</TableHead>
                    <TableHead className="text-[9px] font-black uppercase tracking-[0.15em]">Email</TableHead>
                    <TableHead className="text-[9px] font-black uppercase tracking-[0.15em]">Role</TableHead>
                    <TableHead className="text-[9px] font-black uppercase tracking-[0.15em] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingEmployees.map((emp) => (
                    <TableRow key={emp.id} className="hover:bg-muted/30">
                      <TableCell className="font-medium text-sm">{emp.name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{emp.email}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px] font-bold uppercase border-amber-200 text-amber-600 dark:border-amber-800 dark:text-amber-400">
                          {emp.role === "employer" ? "Manager" : emp.role}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center gap-1.5 justify-end">
                          <button
                            onClick={() => void handleApprove(emp.id)}
                            className="h-7 px-2.5 rounded-md text-[10px] font-semibold flex items-center gap-1 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-all"
                          >
                            <CheckCircle className="w-3 h-3" />
                            Approve
                          </button>
                          <button
                            onClick={() => void handleRemove(emp.id)}
                            className="h-7 px-2.5 rounded-md text-[10px] font-semibold flex items-center gap-1 text-muted-foreground hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400 transition-all"
                          >
                            <UserX className="w-3 h-3" />
                            Decline
                          </button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      </div>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar { width: 3px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: hsl(var(--border)); border-radius: 10px; }
      `}</style>
    </div>
  );
}
