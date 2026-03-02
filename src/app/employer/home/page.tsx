"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * /employer/home is no longer the main entry point.
 * Redirect to /employer/documents which is now the unified workspace.
 */
export default function EmployerHomePage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/employer/documents");
  }, [router]);
  return null;
}
