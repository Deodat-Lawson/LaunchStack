import { redirect } from "next/navigation";

import CallsPage from "~/app/calls/page";

jest.mock("next/navigation", () => ({ redirect: jest.fn() }));

it("preserves the Mac setup focus flag through the Calls entry redirect", async () => {
    await CallsPage({ searchParams: Promise.resolve({ captureSetup: "1", call: "call-123" }) });
    expect(redirect).toHaveBeenCalledWith(
        "/employer/documents?feature=calls&call=call-123&captureSetup=1"
    );
});
