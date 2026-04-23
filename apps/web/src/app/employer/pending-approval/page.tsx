"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Building, Clock, Mail } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";

import { EmployerChrome } from "~/app/employer/_components/EmployerChrome";
import {
  Card,
  PageShell,
} from "~/app/employer/_components/primitives";

interface EmployerData {
  name?: string;
  email?: string;
  company?: string;
  submissionDate?: string;
}

export default function PendingApproval() {
  const router = useRouter();
  const { userId } = useAuth();

  const [currentEmployeeData, setCurrentEmployeeData] = useState<EmployerData>();

  const checkEmployerRole = useCallback(async () => {
    try {
      const response = await fetch("/api/fetchUserInfo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const data = (await response.json()) as EmployerData;
      setCurrentEmployeeData({
        name: data?.name,
        email: data?.email,
        company: data?.company,
        submissionDate: data?.submissionDate,
      });
    } catch (error) {
      console.error(error);
      router.push("/");
    }
  }, [userId, router]);

  useEffect(() => {
    if (userId) void checkEmployerRole();
  }, [userId, checkEmployerRole]);

  return (
    <>
      <EmployerChrome pageLabel="Launchstack" pageTitle="Pending approval" />
      <PageShell>
        <div style={{ maxWidth: 540, margin: "0 auto", paddingTop: 40 }}>
          <Card style={{ padding: 28, textAlign: "center" }}>
            <div
              style={{
                width: 60,
                height: 60,
                borderRadius: 18,
                background: "var(--accent-soft)",
                color: "var(--accent)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 18px",
              }}
            >
              <Clock style={{ width: 28, height: 28 }} />
            </div>
            <h1
              className="serif"
              style={{
                fontSize: 28,
                lineHeight: 1.15,
                letterSpacing: "-0.02em",
                color: "var(--ink)",
                margin: 0,
              }}
            >
              Pending approval
            </h1>
            <div
              style={{
                fontSize: 14,
                color: "var(--ink-3)",
                marginTop: 8,
                lineHeight: 1.55,
              }}
            >
              Your account is waiting for your employer to confirm access. You&apos;ll
              get an email as soon as it&apos;s approved.
            </div>

            <div
              style={{
                marginTop: 24,
                padding: "18px 20px",
                borderRadius: 12,
                border: "1px solid var(--line)",
                background: "var(--panel-2)",
                textAlign: "left",
              }}
            >
              <div
                className="mono"
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  color: "var(--ink-3)",
                  textTransform: "uppercase",
                  marginBottom: 10,
                }}
              >
                Application details
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr",
                  gap: 10,
                }}
              >
                <DetailRow
                  Icon={Building}
                  label="Company"
                  value={currentEmployeeData?.company ?? "—"}
                />
                <DetailRow
                  Icon={Mail}
                  label="Email"
                  value={currentEmployeeData?.email ?? "—"}
                />
                <DetailRow
                  Icon={Clock}
                  label="Submitted"
                  value={currentEmployeeData?.submissionDate ?? "—"}
                />
              </div>
            </div>

            <div
              style={{
                marginTop: 20,
                fontSize: 12,
                color: "var(--ink-3)",
              }}
            >
              Need help? Email{" "}
              <a
                href="mailto:pdraionline@gmail.com"
                style={{ color: "var(--accent)", fontWeight: 600 }}
              >
                pdraionline@gmail.com
              </a>
            </div>
          </Card>
        </div>
      </PageShell>
    </>
  );
}

function DetailRow({
  Icon,
  label,
  value,
}: {
  Icon: React.ComponentType<{ style?: React.CSSProperties }>;
  label: string;
  value: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <Icon
        style={{ width: 15, height: 15, color: "var(--ink-3)", flexShrink: 0 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          className="mono"
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.08em",
            color: "var(--ink-3)",
            textTransform: "uppercase",
          }}
        >
          {label}
        </div>
        <div
          style={{
            fontSize: 13,
            color: "var(--ink)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {value}
        </div>
      </div>
    </div>
  );
}
