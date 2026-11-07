import { readSourceFailureReport } from "~/lib/source-failure";
import { getSupportChannels } from "~/server/support";
import { ContactClient } from "./ContactClient";

// Server component so the support channels come from runtime env rather than
// NEXT_PUBLIC_ values baked into the image at build time. A self-hoster sets
// SUPPORT_CONTACT_EMAIL and friends in .env and this page reflects them.
//
// A failed source's "Contact us about this error" lands here with the
// document, the error's category and the job id in the query; the form opens
// already describing it.
export default async function EmployerContactPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const report = readSourceFailureReport(await searchParams);
    return <ContactClient support={getSupportChannels()} report={report} />;
}
