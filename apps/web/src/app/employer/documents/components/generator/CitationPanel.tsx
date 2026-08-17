"use client";

import { useState } from "react";
import {
    Quote,
    Plus,
    Trash2,
    Edit2,
    Copy,
    Check,
    Loader2,
    BookOpen,
    Globe,
    FileText,
    Newspaper,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { ScrollArea } from "~/components/ui/scroll-area";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/components/ui/select";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "~/components/ui/dialog";
// import { cn } from "~/lib/utils";

// Citation types
export type CitationFormat = "apa" | "mla" | "chicago" | "ieee" | "harvard";
export type SourceType = "website" | "book" | "journal" | "article" | "document";

export interface Citation {
    id: string;
    sourceType: SourceType;
    title: string;
    authors?: string[];
    url?: string;
    publishedDate?: string;
    accessDate?: string;
    publisher?: string;
    journal?: string;
    volume?: string;
    issue?: string;
    pages?: string;
    doi?: string;
}

interface FormattedCitation {
    id: string;
    inText: string;
    bibliography: string;
    format: CitationFormat;
}

interface CitationPanelProps {
    citations: Citation[];
    onCitationsChange: (citations: Citation[]) => void;
    onInsertCitation: (inTextCitation: string) => void;
    onClose: () => void;
}

const formatLabels: Record<CitationFormat, string> = {
    apa: "APA 7th",
    mla: "MLA 9th",
    chicago: "Chicago",
    ieee: "IEEE",
    harvard: "Harvard",
};

const sourceTypeLabels: Record<SourceType, { label: string; icon: React.ReactNode }> = {
    website: { label: "Website", icon: <Globe className="h-4 w-4" /> },
    book: { label: "Book", icon: <BookOpen className="h-4 w-4" /> },
    journal: { label: "Journal", icon: <FileText className="h-4 w-4" /> },
    article: { label: "Article", icon: <Newspaper className="h-4 w-4" /> },
    document: { label: "Document", icon: <FileText className="h-4 w-4" /> },
};

export function CitationPanel({
    citations,
    onCitationsChange,
    onInsertCitation,
    onClose,
}: CitationPanelProps) {
    const [format, setFormat] = useState<CitationFormat>("apa");
    const [formattedCitations, setFormattedCitations] = useState<FormattedCitation[]>([]);
    const [isFormatting, setIsFormatting] = useState(false);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
    const [editingCitation, setEditingCitation] = useState<Citation | null>(null);

    // New citation form state
    const [newCitation, setNewCitation] = useState<Partial<Citation>>({
        sourceType: "website",
        title: "",
        authors: [],
    });
    const [authorsInput, setAuthorsInput] = useState("");

    const formatCitations = async () => {
        if (citations.length === 0) return;

        setIsFormatting(true);
        try {
            const response = await fetch("/api/document-generator/citation", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "format_all",
                    citations,
                    format,
                }),
            });

            const data = (await response.json()) as {
                success: boolean;
                citations?: FormattedCitation[];
            };
            if (data.success && data.citations) {
                setFormattedCitations(data.citations);
            }
        } catch (error) {
            console.error("Error formatting citations:", error);
        } finally {
            setIsFormatting(false);
        }
    };

    const handleAddCitation = () => {
        const authors = authorsInput
            .split("\n")
            .map(a => a.trim())
            .filter(a => a);

        const citation: Citation = {
            id: editingCitation?.id ?? Date.now().toString(),
            sourceType: newCitation.sourceType ?? "website",
            title: newCitation.title ?? "",
            authors: authors.length > 0 ? authors : undefined,
            url: newCitation.url,
            publishedDate: newCitation.publishedDate,
            accessDate: newCitation.accessDate,
            publisher: newCitation.publisher,
            journal: newCitation.journal,
            volume: newCitation.volume,
            issue: newCitation.issue,
            pages: newCitation.pages,
            doi: newCitation.doi,
        };

        if (editingCitation) {
            onCitationsChange(citations.map(c => (c.id === editingCitation.id ? citation : c)));
        } else {
            onCitationsChange([...citations, citation]);
        }

        resetForm();
        setIsAddDialogOpen(false);
    };

    const handleEdit = (citation: Citation) => {
        setEditingCitation(citation);
        setNewCitation(citation);
        setAuthorsInput(citation.authors?.join("\n") ?? "");
        setIsAddDialogOpen(true);
    };

    const handleDelete = (id: string) => {
        onCitationsChange(citations.filter(c => c.id !== id));
        setFormattedCitations(formattedCitations.filter(c => c.id !== id));
    };

    const handleCopy = async (text: string, id: string) => {
        await navigator.clipboard.writeText(text);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
    };

    const resetForm = () => {
        setNewCitation({ sourceType: "website", title: "", authors: [] });
        setAuthorsInput("");
        setEditingCitation(null);
    };

    const getFormattedCitation = (id: string): FormattedCitation | undefined => {
        return formattedCitations.find(c => c.id === id);
    };

    return (
        <div className="bg-surface flex h-full flex-col">
            {/* Header */}
            <div className="border-line border-b p-4">
                <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-ink flex items-center gap-2 font-semibold">
                        <Quote className="h-4 w-4" />
                        Citations
                    </h3>
                    <Button variant="ghost" size="sm" onClick={onClose}>
                        Close
                    </Button>
                </div>

                {/* Format Selector */}
                <div className="flex gap-2">
                    <Select value={format} onValueChange={v => setFormat(v as CitationFormat)}>
                        <SelectTrigger className="flex-1">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {Object.entries(formatLabels).map(([key, label]) => (
                                <SelectItem key={key} value={key}>
                                    {label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Button
                        onClick={formatCitations}
                        disabled={isFormatting || citations.length === 0}
                        variant="outline"
                    >
                        {isFormatting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Format All"}
                    </Button>
                </div>
            </div>

            {/* Add Citation Button */}
            <div className="border-line border-b p-4">
                <Dialog
                    open={isAddDialogOpen}
                    onOpenChange={open => {
                        setIsAddDialogOpen(open);
                        if (!open) resetForm();
                    }}
                >
                    <DialogTrigger asChild>
                        <Button className="bg-brand hover:bg-brand-hi w-full">
                            <Plus className="mr-2 h-4 w-4" />
                            Add Citation
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-md">
                        <DialogHeader>
                            <DialogTitle>
                                {editingCitation ? "Edit Citation" : "Add Citation"}
                            </DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                            {/* Source Type */}
                            <div className="space-y-2">
                                <Label>Source Type</Label>
                                <Select
                                    value={newCitation.sourceType}
                                    onValueChange={v =>
                                        setNewCitation({
                                            ...newCitation,
                                            sourceType: v as SourceType,
                                        })
                                    }
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {Object.entries(sourceTypeLabels).map(
                                            ([key, { label }]) => (
                                                <SelectItem key={key} value={key}>
                                                    {label}
                                                </SelectItem>
                                            )
                                        )}
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Title */}
                            <div className="space-y-2">
                                <Label>Title *</Label>
                                <Input
                                    value={newCitation.title ?? ""}
                                    onChange={e =>
                                        setNewCitation({ ...newCitation, title: e.target.value })
                                    }
                                    placeholder="Enter title"
                                />
                            </div>

                            {/* Authors */}
                            <div className="space-y-2">
                                <Label>Authors (one per line, Last, First)</Label>
                                <textarea
                                    value={authorsInput}
                                    onChange={e => setAuthorsInput(e.target.value)}
                                    placeholder="Smith, John&#10;Doe, Jane"
                                    className="h-20 w-full resize-none rounded-md border px-3 py-2 text-sm"
                                />
                            </div>

                            {/* URL (for website) */}
                            {(newCitation.sourceType === "website" ||
                                newCitation.sourceType === "article") && (
                                <div className="space-y-2">
                                    <Label>URL</Label>
                                    <Input
                                        value={newCitation.url ?? ""}
                                        onChange={e =>
                                            setNewCitation({ ...newCitation, url: e.target.value })
                                        }
                                        placeholder="https://..."
                                    />
                                </div>
                            )}

                            {/* Publisher */}
                            <div className="space-y-2">
                                <Label>Publisher</Label>
                                <Input
                                    value={newCitation.publisher ?? ""}
                                    onChange={e =>
                                        setNewCitation({
                                            ...newCitation,
                                            publisher: e.target.value,
                                        })
                                    }
                                    placeholder="Publisher name"
                                />
                            </div>

                            {/* Date */}
                            <div className="space-y-2">
                                <Label>Published Date</Label>
                                <Input
                                    type="date"
                                    value={newCitation.publishedDate ?? ""}
                                    onChange={e =>
                                        setNewCitation({
                                            ...newCitation,
                                            publishedDate: e.target.value,
                                        })
                                    }
                                />
                            </div>

                            {/* Journal-specific fields */}
                            {newCitation.sourceType === "journal" && (
                                <>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div className="space-y-2">
                                            <Label>Volume</Label>
                                            <Input
                                                value={newCitation.volume ?? ""}
                                                onChange={e =>
                                                    setNewCitation({
                                                        ...newCitation,
                                                        volume: e.target.value,
                                                    })
                                                }
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Issue</Label>
                                            <Input
                                                value={newCitation.issue ?? ""}
                                                onChange={e =>
                                                    setNewCitation({
                                                        ...newCitation,
                                                        issue: e.target.value,
                                                    })
                                                }
                                            />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div className="space-y-2">
                                            <Label>Pages</Label>
                                            <Input
                                                value={newCitation.pages ?? ""}
                                                onChange={e =>
                                                    setNewCitation({
                                                        ...newCitation,
                                                        pages: e.target.value,
                                                    })
                                                }
                                                placeholder="123-456"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>DOI</Label>
                                            <Input
                                                value={newCitation.doi ?? ""}
                                                onChange={e =>
                                                    setNewCitation({
                                                        ...newCitation,
                                                        doi: e.target.value,
                                                    })
                                                }
                                            />
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                        <div className="flex justify-end gap-2">
                            <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                                Cancel
                            </Button>
                            <Button
                                onClick={handleAddCitation}
                                disabled={!newCitation.title?.trim()}
                                className="bg-brand hover:bg-brand-hi"
                            >
                                {editingCitation ? "Update" : "Add"}
                            </Button>
                        </div>
                    </DialogContent>
                </Dialog>
            </div>

            {/* Citations List */}
            <ScrollArea className="flex-1">
                <div className="space-y-3 p-4">
                    {citations.length === 0 ? (
                        <div className="text-ink-3 flex flex-col items-center justify-center py-12">
                            <Quote className="mb-4 h-12 w-12 opacity-20" />
                            <p className="text-sm">No citations added yet</p>
                            <p className="mt-1 text-xs">Add sources from research or manually</p>
                        </div>
                    ) : (
                        citations.map(citation => {
                            const formatted = getFormattedCitation(citation.id);
                            const sourceInfo = sourceTypeLabels[citation.sourceType];

                            return (
                                <div
                                    key={citation.id}
                                    className="border-line hover:border-brand dark:hover:border-brand rounded-lg border p-3 transition-colors"
                                >
                                    <div className="mb-2 flex items-start justify-between gap-2">
                                        <div className="flex items-center gap-2">
                                            <span className="text-ink-3">{sourceInfo.icon}</span>
                                            <span className="line-clamp-1 text-sm font-medium">
                                                {citation.title}
                                            </span>
                                        </div>
                                    </div>

                                    {citation.authors && citation.authors.length > 0 && (
                                        <p className="text-ink-3 mb-2 text-xs">
                                            {citation.authors.join("; ")}
                                        </p>
                                    )}

                                    {formatted && (
                                        <div className="bg-panel-2/50 mt-2 rounded p-2 text-xs">
                                            <p className="mb-1 font-medium">
                                                In-text: {formatted.inText}
                                            </p>
                                            <p className="text-ink-3 line-clamp-2">
                                                {formatted.bibliography}
                                            </p>
                                        </div>
                                    )}

                                    <div className="mt-2 flex gap-1">
                                        {formatted && (
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                className="h-7 text-xs"
                                                onClick={() => {
                                                    onInsertCitation(formatted.inText);
                                                }}
                                            >
                                                <Plus className="mr-1 h-3 w-3" />
                                                Insert
                                            </Button>
                                        )}
                                        {formatted && (
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                className="h-7 text-xs"
                                                onClick={() =>
                                                    handleCopy(formatted.bibliography, citation.id)
                                                }
                                            >
                                                {copiedId === citation.id ? (
                                                    <Check className="mr-1 h-3 w-3" />
                                                ) : (
                                                    <Copy className="mr-1 h-3 w-3" />
                                                )}
                                                Copy
                                            </Button>
                                        )}
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-7 text-xs"
                                            onClick={() => handleEdit(citation)}
                                        >
                                            <Edit2 className="mr-1 h-3 w-3" />
                                            Edit
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-7 text-xs text-red-500 hover:text-red-600"
                                            onClick={() => handleDelete(citation.id)}
                                        >
                                            <Trash2 className="h-3 w-3" />
                                        </Button>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </ScrollArea>

            {/* Bibliography Preview */}
            {formattedCitations.length > 0 && (
                <div className="border-line border-t p-4">
                    <p className="mb-2 text-xs font-medium">Bibliography Preview</p>
                    <div className="bg-panel-2/50 max-h-32 overflow-y-auto rounded p-2 text-xs">
                        {formattedCitations.map(fc => (
                            <p key={fc.id} className="text-ink-3 mb-1">
                                {fc.bibliography}
                            </p>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
