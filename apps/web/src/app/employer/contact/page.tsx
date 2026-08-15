import { getSupportChannels } from "~/server/support";
import { ContactClient } from "./ContactClient";

// Server component so the support channels come from runtime env rather than
// NEXT_PUBLIC_ values baked into the image at build time. A self-hoster sets
// SUPPORT_CONTACT_EMAIL and friends in .env and this page reflects them.
export default function EmployerContactPage() {
  return <ContactClient support={getSupportChannels()} />;
}
