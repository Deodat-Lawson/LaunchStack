import { redirect } from "next/navigation";

/** Compose is a panel over the Brand calendar now; old links still land there. */
export default function Page() {
    redirect("/employer/tools/growth/brand?panel=compose");
}
