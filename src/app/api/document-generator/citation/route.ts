/**
 * Document Generator - Citation Formatting API
 * 
 * Formats citations in various academic styles:
 * - APA 7th Edition
 * - MLA 9th Edition
 * - Chicago (Notes & Bibliography)
 * - IEEE
 * - Harvard
 */

import { NextResponse } from "next/server";
import { auth } from "~/lib/auth-server";
import { z } from "zod";

export const runtime = "nodejs";

// Citation source types
type SourceType = "website" | "book" | "journal" | "article" | "document";

// Citation format types
type CitationFormat = "apa" | "mla" | "chicago" | "ieee" | "harvard";

// Citation input structure
interface CitationInput {
    id: string;
    sourceType: SourceType;
    title: string;
    authors?: string[]; // ["Last, First", "Last, First"]
    url?: string;
    publishedDate?: string; // ISO date string
    accessDate?: string; // ISO date string
    publisher?: string;
    journal?: string;
    volume?: string;
    issue?: string;
    pages?: string;
    doi?: string;
}

// Formatted citation output
interface FormattedCitation {
    id: string;
    inText: string; // In-text citation
    bibliography: string; // Bibliography entry
    format: CitationFormat;
}

// Validation schema
const CitationSchema = z.object({
    action: z.enum(["format", "format_all", "generate_bibliography"]),
    citations: z.array(z.object({
        id: z.string(),
        sourceType: z.enum(["website", "book", "journal", "article", "document"]),
        title: z.string(),
        authors: z.array(z.string()).optional(),
        url: z.string().optional(),
        publishedDate: z.string().optional(),
        accessDate: z.string().optional(),
        publisher: z.string().optional(),
        journal: z.string().optional(),
        volume: z.string().optional(),
        issue: z.string().optional(),
        pages: z.string().optional(),
        doi: z.string().optional(),
    })),
    format: z.enum(["apa", "mla", "chicago", "ieee", "harvard"]).default("apa"),
});

// Format helper functions
function formatAuthorsAPA(authors: string[] | undefined): string {
    if (!authors || authors.length === 0) return "";
    
    if (authors.length === 1) {
        return authors[0] ?? "";
    } else if (authors.length === 2) {
        return `${authors[0]} & ${authors[1]}`;
    } else if (authors.length <= 20) {
        const allButLast = authors.slice(0, -1).join(", ");
        return `${allButLast}, & ${authors[authors.length - 1]}`;
    } else {
        // More than 20 authors: first 19, then ..., then last
        const first19 = authors.slice(0, 19).join(", ");
        return `${first19}, ... ${authors[authors.length - 1]}`;
    }
}

function formatAuthorsMLA(authors: string[] | undefined): string {
    if (!authors || authors.length === 0) return "";
    
    if (authors.length === 1) {
        return authors[0] ?? "";
    } else if (authors.length === 2) {
        return `${authors[0]}, and ${authors[1]}`;
    } else {
        return `${authors[0]}, et al.`;
    }
}

function formatAuthorsChicago(authors: string[] | undefined): string {
    if (!authors || authors.length === 0) return "";
    
    if (authors.length === 1) {
        return authors[0] ?? "";
    } else if (authors.length <= 3) {
        const allButLast = authors.slice(0, -1).join(", ");
        return `${allButLast}, and ${authors[authors.length - 1]}`;
    } else {
        return `${authors[0]} et al.`;
    }
}

function formatAuthorsIEEE(authors: string[] | undefined): string {
    if (!authors || authors.length === 0) return "";
    
    // IEEE uses initials. First Last format
    const formatted = authors.map(author => {
        const parts = author.split(", ");
        if (parts.length === 2) {
            const lastName = parts[0];
            const firstName = parts[1];
            const initials = firstName?.split(" ").map(n => n[0]).join(". ");
            return `${initials}. ${lastName}`;
        }
        return author;
    });
    
    if (formatted.length === 1) {
        return formatted[0] ?? "";
    } else if (formatted.length <= 6) {
        const allButLast = formatted.slice(0, -1).join(", ");
        return `${allButLast}, and ${formatted[formatted.length - 1]}`;
    } else {
        return `${formatted[0]} et al.`;
    }
}

function formatDate(dateStr: string | undefined, format: CitationFormat): string {
    if (!dateStr) return "n.d.";
    
    try {
        const date = new Date(dateStr);
        const year = date.getFullYear();
        const month = date.toLocaleString("en-US", { month: "long" });
        const day = date.getDate();
        
        switch (format) {
            case "apa":
                return `(${year}, ${month} ${day})`;
            case "mla":
                return `${day} ${month.slice(0, 3)}. ${year}`;
            case "chicago":
                return `${month} ${day}, ${year}`;
            case "ieee":
                return `${month.slice(0, 3)}. ${day}, ${year}`;
            case "harvard":
                return `${year}`;
            default:
                return `${year}`;
        }
    } catch {
        return dateStr;
    }
}

function getYear(dateStr: string | undefined): string {
    if (!dateStr) return "n.d.";
    try {
        return new Date(dateStr).getFullYear().toString();
    } catch {
        return "n.d.";
    }
}

function formatCitationAPA(citation: CitationInput): FormattedCitation {
    const { id, sourceType, title, authors, url, publishedDate, publisher, journal, volume, issue, pages, doi } = citation;
    const year = getYear(publishedDate);
    const authorStr = formatAuthorsAPA(authors);
    const firstAuthor = authors?.[0]?.split(",")?.[0] ?? "Unknown";
    
    let inText = "";
    let bibliography = "";
    
    switch (sourceType) {
        case "website":
            inText = `(${firstAuthor}, ${year})`;
            bibliography = `${authorStr} ${year !== "n.d." ? `(${year})` : "(n.d.)"}. ${title}. ${publisher ? `${publisher}. ` : ""}${url ?? ""}`;
            break;
        case "book":
            inText = `(${firstAuthor}, ${year})`;
            bibliography = `${authorStr} (${year}). *${title}*. ${publisher ?? ""}.`;
            break;
        case "journal":
            inText = `(${firstAuthor}, ${year})`;
            bibliography = `${authorStr} (${year}). ${title}. *${journal}*${volume ? `, ${volume}` : ""}${issue ? `(${issue})` : ""}${pages ? `, ${pages}` : ""}.${doi ? ` https://doi.org/${doi}` : ""}`;
            break;
        case "article":
            inText = `(${firstAuthor}, ${year})`;
            bibliography = `${authorStr} (${year}). ${title}. *${journal ?? publisher}*${pages ? `, ${pages}` : ""}.`;
            break;
        case "document":
            inText = `(${firstAuthor}, ${year})`;
            bibliography = `${authorStr} (${year}). ${title}. ${publisher ? `${publisher}.` : ""}`;
            break;
    }
    
    return { id, inText, bibliography, format: "apa" };
}

function formatCitationMLA(citation: CitationInput): FormattedCitation {
    const { id, sourceType, title, authors, url, publishedDate, accessDate, publisher, journal, volume, issue, pages } = citation;
    const authorStr = formatAuthorsMLA(authors);
    const firstAuthor = authors?.[0]?.split(",")?.[0] ?? "Unknown";
    
    const inText = `(${firstAuthor}${pages ? ` ${pages}` : ""})`;
    let bibliography = "";
    
    switch (sourceType) {
        case "website":
            bibliography = `${authorStr}. "${title}." *${publisher ?? "Web"}*, ${formatDate(publishedDate, "mla")}, ${url ?? ""}.${accessDate ? ` Accessed ${formatDate(accessDate, "mla")}.` : ""}`;
            break;
        case "book":
            bibliography = `${authorStr}. *${title}*. ${publisher ?? ""}, ${getYear(publishedDate)}.`;
            break;
        case "journal":
            bibliography = `${authorStr}. "${title}." *${journal}*${volume ? `, vol. ${volume}` : ""}${issue ? `, no. ${issue}` : ""}, ${getYear(publishedDate)}${pages ? `, pp. ${pages}` : ""}.`;
            break;
        case "article":
            bibliography = `${authorStr}. "${title}." *${journal ?? publisher}*, ${getYear(publishedDate)}${pages ? `, pp. ${pages}` : ""}.`;
            break;
        case "document":
            bibliography = `${authorStr}. "${title}." ${publisher ?? ""}, ${getYear(publishedDate)}.`;
            break;
    }
    
    return { id, inText, bibliography, format: "mla" };
}

function formatCitationChicago(citation: CitationInput): FormattedCitation {
    const { id, sourceType, title, authors, url, publishedDate, accessDate, publisher, journal, volume, pages } = citation;
    const authorStr = formatAuthorsChicago(authors);
    const firstAuthor = authors?.[0]?.split(",")?.[0] ?? "Unknown";
    
    const inText = `(${firstAuthor} ${getYear(publishedDate)})`;
    let bibliography = "";
    
    switch (sourceType) {
        case "website":
            bibliography = `${authorStr}. "${title}." ${publisher ?? ""}. ${accessDate ? `Accessed ${formatDate(accessDate, "chicago")}.` : ""} ${url ?? ""}.`;
            break;
        case "book":
            bibliography = `${authorStr}. *${title}*. ${publisher ?? ""}, ${getYear(publishedDate)}.`;
            break;
        case "journal":
            bibliography = `${authorStr}. "${title}." *${journal}* ${volume ?? ""}${pages ? `: ${pages}` : ""} (${getYear(publishedDate)}).`;
            break;
        case "article":
        case "document":
            bibliography = `${authorStr}. "${title}." ${publisher ?? ""}, ${getYear(publishedDate)}.`;
            break;
    }
    
    return { id, inText, bibliography, format: "chicago" };
}

function formatCitationIEEE(citation: CitationInput, index: number): FormattedCitation {
    const { id, sourceType, title, authors, url, publishedDate, publisher, journal, volume, issue, pages } = citation;
    const authorStr = formatAuthorsIEEE(authors);
    
    const inText = `[${index + 1}]`;
    let bibliography = `[${index + 1}] `;
    
    switch (sourceType) {
        case "website":
            bibliography += `${authorStr}, "${title}," ${publisher ?? ""}, ${getYear(publishedDate)}. [Online]. Available: ${url ?? ""}`;
            break;
        case "book":
            bibliography += `${authorStr}, *${title}*. ${publisher ?? ""}, ${getYear(publishedDate)}.`;
            break;
        case "journal":
            bibliography += `${authorStr}, "${title}," *${journal}*${volume ? `, vol. ${volume}` : ""}${issue ? `, no. ${issue}` : ""}${pages ? `, pp. ${pages}` : ""}, ${getYear(publishedDate)}.`;
            break;
        case "article":
        case "document":
            bibliography += `${authorStr}, "${title}," ${publisher ?? ""}, ${getYear(publishedDate)}.`;
            break;
    }
    
    return { id, inText, bibliography, format: "ieee" };
}

function formatCitationHarvard(citation: CitationInput): FormattedCitation {
    const { id, sourceType, title, authors, url, publishedDate, publisher, journal, volume, issue, pages } = citation;
    const authorStr = formatAuthorsAPA(authors); // Harvard similar to APA
    const firstAuthor = authors?.[0]?.split(",")?.[0] ?? "Unknown";
    const year = getYear(publishedDate);
    
    const inText = `(${firstAuthor}, ${year})`;
    let bibliography = "";
    
    switch (sourceType) {
        case "website":
            bibliography = `${authorStr} (${year}) *${title}* [Online]. Available at: ${url ?? ""} (Accessed: ${publishedDate ?? "n.d."}).`;
            break;
        case "book":
            bibliography = `${authorStr} (${year}) *${title}*. ${publisher ?? ""}.`;
            break;
        case "journal":
            bibliography = `${authorStr} (${year}) '${title}', *${journal}*${volume ? `, ${volume}` : ""}${issue ? `(${issue})` : ""}${pages ? `, pp. ${pages}` : ""}.`;
            break;
        case "article":
        case "document":
            bibliography = `${authorStr} (${year}) '${title}', ${publisher ?? ""}.`;
            break;
    }
    
    return { id, inText, bibliography, format: "harvard" };
}

function formatCitation(citation: CitationInput, format: CitationFormat, index: number): FormattedCitation {
    switch (format) {
        case "apa":
            return formatCitationAPA(citation);
        case "mla":
            return formatCitationMLA(citation);
        case "chicago":
            return formatCitationChicago(citation);
        case "ieee":
            return formatCitationIEEE(citation, index);
        case "harvard":
            return formatCitationHarvard(citation);
        default:
            return formatCitationAPA(citation);
    }
}

export async function POST(request: Request) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json(
                { success: false, message: "Unauthorized" },
                { status: 401 }
            );
        }

        const body = await request.json() as unknown;
        const validation = CitationSchema.safeParse(body);

        if (!validation.success) {
            return NextResponse.json(
                { success: false, message: "Invalid request", errors: validation.error.errors },
                { status: 400 }
            );
        }

        const { action, citations, format } = validation.data;
        const startTime = Date.now();

        // Format all citations
        const formattedCitations = citations.map((citation, index) => 
            formatCitation(citation as CitationInput, format, index)
        );

        // Generate bibliography if requested
        let bibliography: string | undefined;
        if (action === "generate_bibliography" || action === "format_all") {
            // Sort bibliography entries alphabetically (except IEEE which is by order)
            const sortedBib = format === "ieee" 
                ? formattedCitations 
                : [...formattedCitations].sort((a, b) => 
                    a.bibliography.localeCompare(b.bibliography)
                );
            
            bibliography = sortedBib.map(c => c.bibliography).join("\n\n");
        }

        const processingTimeMs = Date.now() - startTime;

        console.log(`✅ [Citation] Formatted ${formattedCitations.length} citations in ${format} style`);

        return NextResponse.json({
            success: true,
            action,
            format,
            citations: formattedCitations,
            bibliography,
            count: formattedCitations.length,
            processingTimeMs,
        });

    } catch (error) {
        console.error("❌ [Citation] Error:", error);
        return NextResponse.json(
            { 
                success: false, 
                message: "Failed to format citations",
                error: "Failed to format citations"
            },
            { status: 500 }
        );
    }
}
