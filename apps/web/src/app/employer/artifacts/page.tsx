import { redirect } from "next/navigation";

/**
 * Claude artifacts are sources now, imported from Add a source → Claude
 * artifact. The gallery that lived here is gone; an old link lands on that
 * tab, which also offers to bring over artifacts imported before.
 */
export default function ArtifactsRedirect() {
    redirect("/employer/documents?add=1&tab=artifact");
}
