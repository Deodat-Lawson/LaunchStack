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
import { Button } from "~/app/employer/documents/components/ui/button";
import { Input } from "~/app/employer/documents/components/ui/input";
import { Label } from "~/app/employer/documents/components/ui/label";
import { ScrollArea } from "~/app/employer/documents/components/ui/scroll-area";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/app/employer/documents/components/ui/select";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "~/app/employer/documents/components/ui/dialog";
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
    website: { label: "Website", icon: <Globe className="w-4 h-4" /> },
    book: { label: "Book", icon: <BookOpen className="w-4 h-4" /> },
    journal: { label: "Journal", icon: <FileText className="w-4 h-4" /> },
    article: { label: "Article", icon: <Newspaper className="w-4 h-4" /> },
    document: { label: "Document", icon: <FileText className="w-4 h-4" /> },
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

            const data = await response.json() as { success: boolean; citations?: FormattedCitation[] };
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
            .map((a) => a.trim())
            .filter((a) => a);

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
            onCitationsChange(
                citations.map((c) => (c.id === editingCitation.id ? citation : c))
            );
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
        onCitationsChange(citations.filter((c) => c.id !== id));
        setFormattedCitations(formattedCitations.filter((c) => c.id !== id));
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
        return formattedCitations.find((c) => c.id === id);
    };

    return (
        <div className="flex flex-col h-full bg-background">
            {/* Header */}
            <div className="p-4 border-b border-border">
                <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-foreground flex items-center gap-2">
                        <Quote className="w-4 h-4" />
                        Citations
                    </h3>
                    <Button variant="ghost" size="sm" onClick={onClose}>
                        Close
                    </Button>
                </div>

                {/* Format Selector */}
                <div className="flex gap-2">
                    <Select value={format} onValueChange={(v) => setFormat(v as CitationFormat)}>
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
                        {isFormatting ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                            "Format All"
                        )}
                    </Button>
                </div>
            </div>

            {/* Add Citation Button */}
            <div className="p-4 border-b border-border">
                <Dialog open={isAddDialogOpen} onOpenChange={(open) => {
                    setIsAddDialogOpen(open);
                    if (!open) resetForm();
                }}>
                    <DialogTrigger asChild>
                        <Button className="w-full bg-purple-600 hover:bg-purple-700">
                            <Plus className="w-4 h-4 mr-2" />
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
                                    onValueChange={(v) =>
                                        setNewCitation({ ...newCitation, sourceType: v as SourceType })
                                    }
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {Object.entries(sourceTypeLabels).map(([key, { label }]) => (
                                            <SelectItem key={key} value={key}>
                                                {label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Title */}
                            <div className="space-y-2">
                                <Label>Title *</Label>
                                <Input
                                    value={newCitation.title ?? ""}
                                    onChange={(e) =>
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
                                    onChange={(e) => setAuthorsInput(e.target.value)}
                                    placeholder="Smith, John&#10;Doe, Jane"
                                    className="w-full h-20 px-3 py-2 text-sm border rounded-md resize-none"
                                />
                            </div>

                            {/* URL (for website) */}
                            {(newCitation.sourceType === "website" ||
                                newCitation.sourceType === "article") && (
                                <div className="space-y-2">
                                    <Label>URL</Label>
                                    <Input
                                        value={newCitation.url ?? ""}
                                        onChange={(e) =>
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
                                    onChange={(e) =>
                                        setNewCitation({ ...newCitation, publisher: e.target.value })
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
                                    onChange={(e) =>
                                        setNewCitation({ ...newCitation, publishedDate: e.target.value })
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
                                                onChange={(e) =>
                                                    setNewCitation({ ...newCitation, volume: e.target.value })
                                                }
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Issue</Label>
                                            <Input
                                                value={newCitation.issue ?? ""}
                                                onChange={(e) =>
                                                    setNewCitation({ ...newCitation, issue: e.target.value })
                                                }
                                            />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div className="space-y-2">
                                            <Label>Pages</Label>
                                            <Input
                                                value={newCitation.pages ?? ""}
                                                onChange={(e) =>
                                                    setNewCitation({ ...newCitation, pages: e.target.value })
                                                }
                                                placeholder="123-456"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>DOI</Label>
                                            <Input
                                                value={newCitation.doi ?? ""}
                                                onChange={(e) =>
                                                    setNewCitation({ ...newCitation, doi: e.target.value })
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
                                className="bg-purple-600 hover:bg-purple-700"
                            >
                                {editingCitation ? "Update" : "Add"}
                            </Button>
                        </div>
                    </DialogContent>
                </Dialog>
            </div>

            {/* Citations List */}
            <ScrollArea className="flex-1">
                <div className="p-4 space-y-3">
                    {citations.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                            <Quote className="w-12 h-12 mb-4 opacity-20" />
                            <p className="text-sm">No citations added yet</p>
                            <p className="text-xs mt-1">Add sources from research or manually</p>
                        </div>
                    ) : (
                        citations.map((citation) => {
                            const formatted = getFormattedCitation(citation.id);
                            const sourceInfo = sourceTypeLabels[citation.sourceType];

                            return (
                                <div
                                    key={citation.id}
                                    className="p-3 border border-border rounded-lg hover:border-purple-300 dark:hover:border-purple-700 transition-colors"
                                >
                                    <div className="flex items-start justify-between gap-2 mb-2">
                                        <div className="flex items-center gap-2">
                                            <span className="text-muted-foreground">
                                                {sourceInfo.icon}
                                            </span>
                                            <span className="font-medium text-sm line-clamp-1">
                                                {citation.title}
                                            </span>
                                        </div>
                                    </div>

                                    {citation.authors && citation.authors.length > 0 && (
                                        <p className="text-xs text-muted-foreground mb-2">
                                            {citation.authors.join("; ")}
                                        </p>
                                    )}

                                    {formatted && (
                                        <div className="mt-2 p-2 bg-muted/50 rounded text-xs">
                                            <p className="font-medium mb-1">In-text: {formatted.inText}</p>
                                            <p className="text-muted-foreground line-clamp-2">
                                                {formatted.bibliography}
                                            </p>
                                        </div>
                                    )}

                                    <div className="flex gap-1 mt-2">
                                        {formatted && (
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                className="h-7 text-xs"
                                                onClick={() => {
                                                    onInsertCitation(formatted.inText);
                                                }}
                                            >
                                                <Plus className="w-3 h-3 mr-1" />
                                                Insert
                                            </Button>
                                        )}
                                        {formatted && (
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                className="h-7 text-xs"
                                                onClick={() => handleCopy(formatted.bibliography, citation.id)}
                                            >
                                                {copiedId === citation.id ? (
                                                    <Check className="w-3 h-3 mr-1" />
                                                ) : (
                                                    <Copy className="w-3 h-3 mr-1" />
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
                                            <Edit2 className="w-3 h-3 mr-1" />
                                            Edit
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-7 text-xs text-red-500 hover:text-red-600"
                                            onClick={() => handleDelete(citation.id)}
                                        >
                                            <Trash2 className="w-3 h-3" />
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
                <div className="p-4 border-t border-border">
                    <p className="text-xs font-medium mb-2">Bibliography Preview</p>
                    <div className="p-2 bg-muted/50 rounded text-xs max-h-32 overflow-y-auto">
                        {formattedCitations.map((fc) => (
                            <p key={fc.id} className="mb-1 text-muted-foreground">
                                {fc.bibliography}
                            </p>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
