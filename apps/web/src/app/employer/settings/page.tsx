"use client";

import { EmployerChrome } from "~/app/employer/_components/EmployerChrome";
import { SettingsView } from "./SettingsView";

export default function SettingsPage() {
  return (
    <>
      <EmployerChrome pageLabel="Launchstack" pageTitle="Settings" />
      <SettingsView />
    </>
  );
}
