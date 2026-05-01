"use client";

import {
  createContext,
  useContext,
  type ReactNode,
} from "react";

import type { WorkspaceSwitcherPayload } from "./workspaceSwitcherTypes";

const EmployerWorkspaceSwitcherContext =
  createContext<WorkspaceSwitcherPayload | null>(null);

export function EmployerWorkspaceSwitcherProvider({
  value,
  children,
}: {
  value: WorkspaceSwitcherPayload | null;
  children: ReactNode;
}) {
  return (
    <EmployerWorkspaceSwitcherContext.Provider value={value}>
      {children}
    </EmployerWorkspaceSwitcherContext.Provider>
  );
}

export function useEmployerWorkspaceSwitcher(): WorkspaceSwitcherPayload | null {
  return useContext(EmployerWorkspaceSwitcherContext);
}
