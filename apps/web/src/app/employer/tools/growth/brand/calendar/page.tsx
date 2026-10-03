import { redirect } from "next/navigation";

/** The calendar is the Brand page itself now; old links still land there. */
export default function Page() {
    redirect("/employer/tools/growth/brand");
}
