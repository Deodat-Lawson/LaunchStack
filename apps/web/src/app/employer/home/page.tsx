import { redirect } from "next/navigation";

/** Home is the workspace. Redirect on the server so nothing paints first. */
export default function EmployerHomePage() {
    redirect("/employer/documents");
}
