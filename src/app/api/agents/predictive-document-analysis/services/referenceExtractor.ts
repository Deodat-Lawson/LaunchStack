import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { PdfChunk, DocumentReference } from "~/app/api/agents/predictive-document-analysis/types";
import { groupContentFromChunks, hasSpecificIdentifier } from "~/app/api/agents/predictive-document-analysis/utils/content";

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
    You are an expert in extracting references from documents.

    Extract ONLY clear, explicit references to separate documents that should be attached or included (e.g., "See Exhibit A", "Schedule 1 attached", "Refer to Addendum B").
    
    IMPORTANT RULES:
    - Only extract references that use specific document identifiers (Exhibit A, Schedule 1, Attachment B, etc.)
    - Ignore general mentions like "other documents", "additional forms", "related materials"
    - Ignore references to external documents that are clearly not part of this document set
    - Only include references where the document is expected to be attached or included
    - Be very conservative - when in doubt, don't extract it
    
    For each valid reference, provide:
    - name: The specific document identifier (e.g., "Exhibit A", "Schedule 1")
    - type: The document type (exhibit, schedule, attachment, addendum)
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
            hasSpecificIdentifier(ref.documentName)
        );
        
        return filteredReferences;
    } catch (error) {
        console.error("Reference extraction error:", error);
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