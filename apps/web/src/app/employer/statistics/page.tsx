"use client";

import { EmployerChrome } from "~/app/employer/_components/EmployerChrome";
import { StatisticsView } from "./StatisticsView";

export default function StatisticsPage() {
  return (
    <>
      <EmployerChrome pageLabel="Launchstack" pageTitle="Analytics" />
      <StatisticsView />
    </>
  );
}
