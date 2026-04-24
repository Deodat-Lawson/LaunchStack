"use client";

import { EmployerChrome } from "~/app/employer/_components/EmployerChrome";
import { MetadataView } from "./MetadataView";

export default function MetadataPage() {
  return (
    <>
      <EmployerChrome pageLabel="Launchstack" pageTitle="Metadata" />
      <MetadataView />
    </>
  );
}
