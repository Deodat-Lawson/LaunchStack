"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth, useUser } from "@clerk/nextjs";
import { useTheme } from "next-themes";
import {
  IconBolt,
  IconChevronDown,
  IconList,
  IconLogout,
  IconMoon,
  IconSettings,
  IconSun,
} from "../documents/_workspace/icons";
import { DEMOTED_FEATURES } from "../documents/_workspace/types";

function initialsOf(
  first?: string | null,
  last?: string | null,
  email?: string | null,
) {
  const parts = [first, last].filter(Boolean) as string[];
  if (parts.length > 0) {
    return parts
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("")
      .slice(0, 2);
  }
  if (email) return email[0]?.toUpperCase() ?? "U";
  return "U";
}

export interface EmployerChromeProps {
  /** Optional in-page context label shown below the page title (e.g. "Settings · Company"). */
  pageLabel?: string;
  pageTitle?: string;
  /** Optional right-aligned actions to render inside the navbar. */
  rightActions?: React.ReactNode;
}

export function EmployerChrome({
  pageLabel,
  pageTitle,
  rightActions,
}: EmployerChromeProps) {
  const router = useRouter();
  const { signOut } = useAuth();
  const { user } = useUser();
  const { resolvedTheme, setTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const isDark = resolvedTheme === "dark";

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const userName = user?.fullName ?? [user?.firstName, user?.lastName].filter(Boolean).join(" ");
  const userEmail = user?.primaryEmailAddress?.emailAddress;
  const initials = initialsOf(user?.firstName, user?.lastName, userEmail);

  return (
    <nav
      style={{
        background: "var(--panel)",
        borderBottom: "1px solid var(--line)",
        position: "sticky",
        top: 0,
        zIndex: 40,
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "10px 24px",
          display: "flex",
          alignItems: "center",
          gap: 14,
        }}
      >
        <Link
          href="/employer/documents"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            textDecoration: "none",
            color: "inherit",
          }}
        >
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: 6,
              background: "var(--ink)",
              color: "var(--accent)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <IconBolt size={14} />
          </div>
          <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.01em" }}>
            Launchstack
          </span>
        </Link>

        {pageTitle && (
          <>
            <span style={{ color: "var(--ink-4)", fontSize: 13 }}>/</span>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--ink)",
                  lineHeight: 1.2,
                }}
              >
                {pageTitle}
              </div>
              {pageLabel && (
                <div
                  className="mono"
                  style={{
                    fontSize: 10,
                    color: "var(--ink-3)",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                  }}
                >
                  {pageLabel}
                </div>
              )}
            </div>
          </>
        )}

        <div style={{ flex: 1 }} />

        {rightActions}

        <Link
          href="/employer/documents"
          title="Workspace"
          style={{
            fontSize: 12,
            padding: "6px 10px",
            borderRadius: 7,
            color: "var(--ink-2)",
            border: "1px solid var(--line)",
            display: "flex",
            alignItems: "center",
            gap: 6,
            textDecoration: "none",
          }}
        >
          <IconList size={12} />
          Workspace
        </Link>

        <div ref={menuRef} style={{ position: "relative" }}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              background:
                "linear-gradient(135deg, oklch(0.7 0.12 282), oklch(0.55 0.18 260))",
              color: "white",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            {initials}
          </button>
          {menuOpen && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 8px)",
                right: 0,
                width: 240,
                background: "var(--panel)",
                border: "1px solid var(--line)",
                borderRadius: 12,
                boxShadow: "0 16px 40px var(--scrim-shadow)",
                padding: 6,
                zIndex: 50,
                animation: "lsw-fadeIn 120ms",
              }}
            >
              <div
                style={{
                  padding: "10px 10px",
                  borderBottom: "1px solid var(--line)",
                  marginBottom: 6,
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  {userName ?? "Your account"}
                </div>
                {userEmail && (
                  <div style={{ fontSize: 11, color: "var(--ink-3)" }}>
                    {userEmail}
                  </div>
                )}
              </div>
              {DEMOTED_FEATURES.map((f) => {
                const Icon = f.Icon;
                return (
                  <button
                    key={f.id}
                    onClick={() => {
                      setMenuOpen(false);
                      router.push(f.href);
                    }}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "7px 10px",
                      borderRadius: 7,
                      fontSize: 13,
                      color: "var(--ink-2)",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "var(--line-2)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "transparent";
                    }}
                  >
                    <Icon size={14} />
                    <span style={{ flex: 1, textAlign: "left" }}>{f.label}</span>
                    {f.kbd && (
                      <span
                        className="mono"
                        style={{ fontSize: 10, color: "var(--ink-3)" }}
                      >
                        {f.kbd}
                      </span>
                    )}
                  </button>
                );
              })}
              <div
                style={{
                  borderTop: "1px solid var(--line)",
                  marginTop: 6,
                  paddingTop: 6,
                }}
              >
                <button
                  onClick={() => setTheme(isDark ? "light" : "dark")}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "7px 10px",
                    borderRadius: 7,
                    fontSize: 13,
                    color: "var(--ink-2)",
                  }}
                >
                  {isDark ? <IconSun size={14} /> : <IconMoon size={14} />}
                  <span style={{ flex: 1, textAlign: "left" }}>
                    {isDark ? "Light" : "Dark"} theme
                  </span>
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    router.push("/employer/settings");
                  }}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "7px 10px",
                    borderRadius: 7,
                    fontSize: 13,
                    color: "var(--ink-2)",
                  }}
                >
                  <IconSettings size={14} />
                  <span style={{ flex: 1, textAlign: "left" }}>Settings</span>
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    void signOut({ redirectUrl: "/" });
                  }}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "7px 10px",
                    borderRadius: 7,
                    fontSize: 13,
                    color: "var(--ink-2)",
                  }}
                >
                  <IconLogout size={14} />
                  <span style={{ flex: 1, textAlign: "left" }}>Sign out</span>
                </button>
              </div>
              {/* chevron affordance, mostly decorative */}
              <div style={{ display: "none" }}>
                <IconChevronDown size={10} />
              </div>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
