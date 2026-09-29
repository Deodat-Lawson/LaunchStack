import { redirect } from "next/navigation";

/**
 * Distribution's screens retired into Prospects, which reads the same
 * programs, organisations and relationships inside Growth.
 */
export default function LegacyDistributionPage() {
    redirect("/employer/tools/growth/prospects");
}
