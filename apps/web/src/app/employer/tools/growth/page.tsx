import { redirect } from "next/navigation";

/** The app opens on Brand; Prospects is one click down the rail. */
export default function GrowthPage() {
    redirect("/employer/tools/growth/brand");
}
