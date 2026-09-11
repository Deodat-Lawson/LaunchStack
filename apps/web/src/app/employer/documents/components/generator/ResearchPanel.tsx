"use client";

import { useState } from "react";
import {
    Search,
    FileText,
    Globe,
    Loader2,
    Plus,
    ExternalLink,
    BookOpen,
    Newspaper,
    GraduationCap,
    Download,
    Users,
    Calendar,
    Tag,
    X,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "~/components/ui/tabs";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Badge } from "~/components/ui/badge";
// import { cn } from "~/lib/utils";

// Research result types
interface DocumentResult {
    id: string;
    content: string;
    page?: number;
    documentTitle?: string;
    documentId?: number;
    relevanceScore: number;
    source: "document";
}

interface WebResult {
    id: string;
    title: string;
    url: string;
    snippet: string;
    relevanceScore: number;
    source: "web";
}

interface ArxivResult {
    id: string;
    title: string;
    url: string;
    arxivId: string;
    authors: string[];
    summary: string;
    published: string;
    updated: string;
    categories: string[];
    pdfUrl: string;
    relevanceScore: number;
    source: "arxiv";
}

type ResearchResult = DocumentResult | WebResult | ArxivResult;

interface ResearchPanelProps {
    onInsertContent: (
        content: string,
        citation?: { title: string; url?: string; authors?: string[]; date?: string }
    ) => void;
    onClose: () => void;
    initialMode?: "documents" | "web" | "arxiv";
}

// arXiv category options
const arxivCategories = [
    { value: "", label: "All Categories" },
    { value: "cs.AI", label: "AI" },
    { value: "cs.LG", label: "Machine Learning" },
    { value: "cs.CL", label: "NLP" },
    { value: "cs.CV", label: "Computer Vision" },
    { value: "stat.ML", label: "Statistics ML" },
    { value: "physics", label: "Physics" },
    { value: "math", label: "Mathematics" },
    { value: "q-bio", label: "Biology" },
    { value: "econ", label: "Economics" },
];

export function ResearchPanel({
    onInsertContent,
    onClose,
    initialMode = "documents",
}: ResearchPanelProps) {
    const [query, setQuery] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [results, setResults] = useState<ResearchResult[]>([]);
    const [activeTab, setActiveTab] = useState<"all" | "documents" | "web" | "arxiv">(
        initialMode === "arxiv" ? "arxiv" : "all"
    );
    const [searchType, setSearchType] = useState<"general" | "academic" | "news">("general");
    const [arxivCategory, setArxivCategory] = useState("");
    const [error, setError] = useState<string | null>(null);

    const handleSearch = async () => {
        if (!query.trim()) return;

        setIsLoading(true);
        setError(null);

        try {
            const sources =
                activeTab === "all"
                    ? ["documents", "web", "arxiv"]
                    : activeTab === "documents"
                      ? ["documents"]
                      : activeTab === "arxiv"
                        ? ["arxiv"]
                        : ["web"];

            const response = await fetch("/api/document-generator/research", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    query,
                    sources,
                    options: {
                        maxResults: 15,
                        searchType,
                        arxivCategory: arxivCategory || undefined,
                    },
                }),
            });

            const data = (await response.json()) as {
                success: boolean;
                results?: ResearchResult[];
                message?: string;
            };

            if (data.success) {
                setResults(data.results ?? []);
            } else {
                setError(data.message ?? "Failed to search");
            }
        } catch (err) {
            setError("An error occurred while searching");
            console.error("Research error:", err);
        } finally {
            setIsLoading(false);
        }
    };

    const handleInsert = (result: ResearchResult) => {
        if (result.source === "document") {
            const docResult = result;
            onInsertContent(docResult.content, {
                title: docResult.documentTitle ?? "Document",
            });
        } else if (result.source === "arxiv") {
            const arxivResult = result;
            // Insert with academic citation info
            onInsertContent(arxivResult.summary, {
                title: arxivResult.title,
                url: arxivResult.url,
                authors: arxivResult.authors,
                date: arxivResult.published,
            });
        } else {
            const webResult = result;
            onInsertContent(webResult.snippet, {
                title: webResult.title,
                url: webResult.url,
            });
        }
    };

    const filteredResults = results.filter(r => {
        if (activeTab === "all") return true;
        if (activeTab === "documents") return r.source === "document";
        if (activeTab === "arxiv") return r.source === "arxiv";
        return r.source === "web";
    });

    const documentResults = results.filter(r => r.source === "document");
    const webResults = results.filter(r => r.source === "web");
    const arxivResults = results.filter(r => r.source === "arxiv");

    const formatDate = (dateStr: string) => {
        try {
            return new Date(dateStr).toLocaleDateString("en-US", {
                year: "numeric",
                month: "short",
                day: "numeric",
            });
        } catch {
            return dateStr;
        }
    };

    const formatAuthors = (authors: string[], max = 3) => {
        if (authors.length <= max) return authors.join(", ");
        return `${authors.slice(0, max).join(", ")} et al.`;
    };

    return (
        <div className="bg-surface flex h-full flex-col">
            {/* Header */}
            <div className="border-line border-b p-4">
                <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-ink flex items-center gap-2 font-semibold">
                        <Search className="h-4 w-4" />
                        Research
                    </h3>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
                        <X className="h-4 w-4" />
                    </Button>
                </div>

                {/* Search Input */}
                <div className="flex gap-2">
                    <Input
                        placeholder={
                            activeTab === "arxiv"
                                ? "Search arXiv papers..."
                                : "Search documents and web..."
                        }
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && handleSearch()}
                        className="flex-1"
                    />
                    <Button
                        onClick={handleSearch}
                        disabled={isLoading || !query.trim()}
                        className="bg-brand hover:bg-brand-hi"
                    >
                        {isLoading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <Search className="h-4 w-4" />
                        )}
                    </Button>
                </div>

                {/* Search Type / arXiv Category */}
                <div className="mt-3 flex flex-wrap gap-1">
                    {activeTab !== "arxiv" ? (
                        <>
                            <Button
                                variant={searchType === "general" ? "secondary" : "ghost"}
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => setSearchType("general")}
                            >
                                <Globe className="mr-1 h-3 w-3" />
                                General
                            </Button>
                            <Button
                                variant={searchType === "academic" ? "secondary" : "ghost"}
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => setSearchType("academic")}
                            >
                                <BookOpen className="mr-1 h-3 w-3" />
                                Academic
                            </Button>
                            <Button
                                variant={searchType === "news" ? "secondary" : "ghost"}
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => setSearchType("news")}
                            >
                                <Newspaper className="mr-1 h-3 w-3" />
                                News
                            </Button>
                        </>
                    ) : (
                        <div className="flex flex-wrap gap-1">
                            {arxivCategories.map(cat => (
                                <Button
                                    key={cat.value}
                                    variant={arxivCategory === cat.value ? "secondary" : "ghost"}
                                    size="sm"
                                    className="h-7 text-xs"
                                    onClick={() => setArxivCategory(cat.value)}
                                >
                                    {cat.label}
                                </Button>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Tabs */}
            <Tabs value={activeTab} onValueChange={v => setActiveTab(v as typeof activeTab)}>
                <div className="border-line border-b px-4 py-2">
                    <TabsList className="grid h-9 w-full grid-cols-4">
                        <TabsTrigger value="all" className="px-2 text-xs">
                            All ({results.length})
                        </TabsTrigger>
                        <TabsTrigger value="documents" className="px-2 text-xs">
                            <FileText className="mr-1 hidden h-3 w-3 sm:inline" />
                            Docs ({documentResults.length})
                        </TabsTrigger>
                        <TabsTrigger value="web" className="px-2 text-xs">
                            <Globe className="mr-1 hidden h-3 w-3 sm:inline" />
                            Web ({webResults.length})
                        </TabsTrigger>
                        <TabsTrigger value="arxiv" className="px-2 text-xs">
                            <GraduationCap className="mr-1 hidden h-3 w-3 sm:inline" />
                            arXiv ({arxivResults.length})
                        </TabsTrigger>
                    </TabsList>
                </div>

                {/* Results */}
                <ScrollArea className="flex-1">
                    <TabsContent value={activeTab} className="m-0 p-4">
                        {error && (
                            <div className="rounded-lg bg-red-50 p-4 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                                {error}
                            </div>
                        )}

                        {!isLoading && results.length === 0 && !error && (
                            <div className="text-ink-3 flex flex-col items-center justify-center py-12">
                                {activeTab === "arxiv" ? (
                                    <>
                                        <GraduationCap className="mb-4 h-12 w-12 opacity-20" />
                                        <p className="text-center text-sm">
                                            Search for academic papers from <br />
                                            <a
                                                href="https://arxiv.org"
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-brand-ink hover:underline"
                                            >
                                                arXiv.org
                                            </a>
                                        </p>
                                    </>
                                ) : (
                                    <>
                                        <Search className="mb-4 h-12 w-12 opacity-20" />
                                        <p className="text-sm">
                                            Search for information to include in your document
                                        </p>
                                    </>
                                )}
                            </div>
                        )}

                        {isLoading && (
                            <div className="flex flex-col items-center justify-center py-12">
                                <Loader2 className="text-brand-ink mb-4 h-8 w-8 animate-spin" />
                                <p className="text-ink-3 text-sm">Searching...</p>
                            </div>
                        )}

                        <div className="space-y-3">
                            {filteredResults.map(result => (
                                <ResultCard
                                    key={result.id}
                                    result={result}
                                    onInsert={() => handleInsert(result)}
                                    formatDate={formatDate}
                                    formatAuthors={formatAuthors}
                                />
                            ))}
                        </div>
                    </TabsContent>
                </ScrollArea>
            </Tabs>
        </div>
    );
}

interface ResultCardProps {
    result: ResearchResult;
    onInsert: () => void;
    formatDate: (date: string) => string;
    formatAuthors: (authors: string[], max?: number) => string;
}

function ResultCard({ result, onInsert, formatDate, formatAuthors }: ResultCardProps) {
    if (result.source === "arxiv") {
        const arxivResult = result;
        return (
            <div className="border-line group rounded-lg border bg-gradient-to-br from-rose-50/50 to-transparent p-4 transition-colors hover:border-rose-300 dark:from-rose-950/20 dark:hover:border-rose-700">
                {/* Header */}
                <div className="mb-2 flex items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                        <div className="shrink-0 rounded-md bg-rose-100 p-1.5 dark:bg-rose-900/30">
                            <GraduationCap className="h-4 w-4 text-rose-500" />
                        </div>
                        <span className="line-clamp-2 text-sm font-medium leading-tight">
                            {arxivResult.title}
                        </span>
                    </div>
                    <Badge
                        variant="outline"
                        className="shrink-0 border-rose-200 bg-rose-50 text-[10px] dark:border-rose-800 dark:bg-rose-900/20"
                    >
                        {arxivResult.arxivId}
                    </Badge>
                </div>

                {/* Authors */}
                <div className="text-ink-3 mb-2 flex items-center gap-1.5 text-xs">
                    <Users className="h-3 w-3" />
                    <span className="line-clamp-1">{formatAuthors(arxivResult.authors, 4)}</span>
                </div>

                {/* Summary */}
                <p className="text-ink-3 mb-3 line-clamp-3 text-xs leading-relaxed">
                    {arxivResult.summary}
                </p>

                {/* Metadata */}
                <div className="text-ink-3 mb-3 flex items-center gap-3 text-[10px]">
                    <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {formatDate(arxivResult.published)}
                    </span>
                    {arxivResult.categories.slice(0, 3).map(cat => (
                        <span key={cat} className="flex items-center gap-1">
                            <Tag className="h-3 w-3" />
                            {cat}
                        </span>
                    ))}
                </div>

                {/* Actions */}
                <div className="flex gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button
                        size="sm"
                        className="h-7 bg-rose-500 text-xs hover:bg-rose-600"
                        onClick={onInsert}
                    >
                        <Plus className="mr-1 h-3 w-3" />
                        Insert & Cite
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => window.open(arxivResult.pdfUrl, "_blank")}
                    >
                        <Download className="mr-1 h-3 w-3" />
                        PDF
                    </Button>
                    <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() => window.open(arxivResult.url, "_blank")}
                    >
                        <ExternalLink className="mr-1 h-3 w-3" />
                        arXiv
                    </Button>
                </div>
            </div>
        );
    }

    if (result.source === "document") {
        const docResult = result;
        return (
            <div className="border-line group rounded-lg border p-3 transition-colors hover:border-blue-300 dark:hover:border-blue-700">
                <div className="mb-2 flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-blue-500" />
                        <span className="line-clamp-1 text-sm font-medium">
                            {docResult.documentTitle ?? "Document"}
                        </span>
                    </div>
                    <Badge variant="secondary" className="text-[10px]">
                        {Math.round(docResult.relevanceScore * 100)}%
                    </Badge>
                </div>

                <p className="text-ink-3 mb-2 line-clamp-3 text-xs">{docResult.content}</p>

                {docResult.page && (
                    <p className="text-ink-3 mb-2 text-[10px]">Page {docResult.page}</p>
                )}

                <div className="flex gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onInsert}>
                        <Plus className="mr-1 h-3 w-3" />
                        Insert
                    </Button>
                </div>
            </div>
        );
    }

    // Web result
    const webResult = result;
    return (
        <div className="border-line group rounded-lg border p-3 transition-colors hover:border-green-300 dark:hover:border-green-700">
            <div className="mb-2 flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                    <Globe className="h-4 w-4 text-green-500" />
                    <span className="line-clamp-1 text-sm font-medium">{webResult.title}</span>
                </div>
                <Badge variant="secondary" className="text-[10px]">
                    {Math.round(webResult.relevanceScore * 100)}%
                </Badge>
            </div>

            <p className="text-ink-3 mb-2 line-clamp-3 text-xs">{webResult.snippet}</p>

            <div className="flex gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onInsert}>
                    <Plus className="mr-1 h-3 w-3" />
                    Insert
                </Button>
                <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => window.open(webResult.url, "_blank")}
                >
                    <ExternalLink className="mr-1 h-3 w-3" />
                    Open
                </Button>
            </div>
        </div>
    );
}
