import { redirect } from "next/navigation";

function buildQuery(
  searchParams: Record<string, string | string[] | undefined>,
  set: Record<string, string>,
) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (typeof v === "string") params.set(k, v);
    else if (Array.isArray(v) && v[0]) params.set(k, v[0]);
  }
  for (const [k, v] of Object.entries(set)) params.set(k, v);
  return params.toString();
}

export default async function NotesRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  redirect(`/employer/documents?${buildQuery(sp, { feature: "notes" })}`);
}
