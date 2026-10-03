import { redirect } from "next/navigation";

/**
 * An old link to one artifact. It is either a source already or waiting to be
 * brought over, and both happen from Add a source → Claude artifact.
 */
export default function ArtifactRedirect() {
    redirect("/employer/documents?add=1&tab=artifact");
}
