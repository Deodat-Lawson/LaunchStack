import { redirect } from "next/navigation";

/**
 * Mindmaps live in the Documents workspace now: a map is a source, opened in
 * the same viewer as everything else and edited in place. This route survives
 * only so links shared while the editor had its own address keep working.
 */
export default async function LegacyMindmapRoute({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const numeric = Number.parseInt(id, 10);
    if (!Number.isInteger(numeric) || numeric <= 0) redirect("/employer/documents");
    redirect(`/employer/documents?source=m${numeric}&edit=1`);
}
