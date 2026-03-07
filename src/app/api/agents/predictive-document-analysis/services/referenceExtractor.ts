import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { PdfChunk, DocumentReference } from "~/app/api/agents/predictive-document-analysis/types";
import { groupContentFromChunks, isValidReference } from "~/app/api/agents/predictive-document-analysis/utils/content";
import { sanitizeErrorMessage } from "~/app/api/agents/predictive-document-analysis/utils/logging";

const ReferenceExtractionSchema = z.object({
    references: z.array(z.object({
        documentName: z.string(),
        documentType: z.string(),
        page: z.number(),
        contextSnippet: z.string()
    })).describe('Extracted references')
});

function createReferenceExtractionPrompt(content: string): string {
    return `
    You are an expert at extracting document references from any type of document.

    Extract clear, explicit references to separate documents, resources, or materials that the reader is expected to consult but that are NOT included in the current content.

    Examples of references to extract:
    • "See Exhibit A", "Schedule 1 attached", "Refer to Addendum B"
    • "Please see syllabus", "refer to the handbook", "as described in the user guide"
    • "See the policy document", "complete Form W-9", "review the template"
    • "Posted on Canvas", "available on the course website"
    
    RULES:
    - Extract any named document, form, guide, syllabus, handbook, manual, template, or policy that is referenced
    - Include references where the reader is directed to consult another document ("see", "refer to", "please review", "posted on")
    - Ignore vague generic mentions like "other documents", "various materials", "related items"
    - Do NOT extract URLs themselves (those are handled separately)
    
    For each valid reference, provide:
    - name: The document name (e.g., "Exhibit A", "Syllabus", "Employee Handbook", "Form W-9")
    - type: The document type (exhibit, schedule, attachment, addendum, syllabus, handbook, policy, form, template, guide, manual, other)
    - page: The page number where referenced
    - contextSnippet: 15-30 words around the reference showing why it should be included
    
    CONTENT:
    ${content}`;
}

export async function extractReferences(
    chunks: PdfChunk[], 
    timeoutMs = 30000
): Promise<DocumentReference[]> {
    const content = groupContentFromChunks(chunks);
    const prompt = createReferenceExtractionPrompt(content);
    
    const chat = new ChatOpenAI({
        openAIApiKey: process.env.OPENAI_API_KEY,
        modelName: "gpt-5.2",
        temperature: 0.1,
    });

    const structuredModel = chat.withStructuredOutput(ReferenceExtractionSchema, {
        name: "reference_extraction"
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
            reject(new Error(`Reference extraction timed out after ${timeoutMs}ms`));
        }, timeoutMs);
    });

    const aiCallPromise = structuredModel.invoke([
        new SystemMessage("Extract references step-by-step"),
        new HumanMessage(prompt)
    ]);

    try {
        const response = await Promise.race([aiCallPromise, timeoutPromise]);
        const references = response.references;
        
        const filteredReferences = references.filter(ref => 
            isValidReference(ref.documentName)
        );
        
        return filteredReferences;
    } catch (error) {
        console.error("Reference extraction error:", sanitizeErrorMessage(error));
        return [];
    }
}

export function deduplicateReferences(references: DocumentReference[]): DocumentReference[] {
    const seen = new Set<string>();
    return references.filter(ref => {
        const key = ref.documentName.toLowerCase().trim();
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
} 