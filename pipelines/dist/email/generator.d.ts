import { type EmailTemplate } from "./types.js";
export declare function generateTemplate(args: {
    companyId: number;
    goal?: string;
}): Promise<{
    template: EmailTemplate;
    companyContext: string;
    modelId: string;
}>;
//# sourceMappingURL=generator.d.ts.map