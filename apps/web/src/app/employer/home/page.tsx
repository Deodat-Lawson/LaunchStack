"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function EmployerHomePage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/employer/documents");
  }, [router]);
  return null;
}
