import { AcceleratorError } from "@launchstack/pipelines/accelerators/types";
import { getAcceleratorApplication } from "@launchstack/pipelines/accelerators/db";

import { acceleratorRequest } from "../../_http";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
    return acceleratorRequest(request, "documents.read", async member => {
        const application = await getAcceleratorApplication(member.companyId, (await params).id);
        if (!application)
            throw new AcceleratorError("Application not found", 404, "application_not_found");
        return { application };
    });
}
