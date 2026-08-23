import { redirect } from "next/navigation";

export default function CallsPage() {
    redirect("/employer/documents?feature=calls");
}
