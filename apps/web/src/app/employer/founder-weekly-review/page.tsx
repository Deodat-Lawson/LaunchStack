"use client";

import { EmployerChrome } from "~/app/employer/_components/EmployerChrome";
import { FounderWeeklyReviewView } from "./FounderWeeklyReviewView";

export default function FounderWeeklyReviewPage() {
  return (
    <>
      <EmployerChrome pageLabel="Launchstack" pageTitle="Founder Weekly Review" />
      <FounderWeeklyReviewView />
    </>
  );
}
