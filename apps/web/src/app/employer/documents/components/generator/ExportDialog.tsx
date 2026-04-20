"use client";

import { useState } from "react";
import {
    Download,
    FileText,
    File,
    Code,
    Loader2,
    Check,
} from "lucide-react";
import { Button } from "~/app/employer/documents/components/ui/button";
import { Label } from "~/app/employer/documents/components/ui/label";
import { Switch } from "~/app/employer/documents/components/ui/switch";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "~/app/employer/documents/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/app/employer/documents/components/ui/select";
import { cn } from "~/lib/utils";

type ExportFormat = "pdf" | "markdown" | "html" | "text";
type PageSize = "letter" | "a4";

interface ExportDialogProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    content: string;
    bibliography?: string;
}

interface FormatOption {
    id: ExportFormat;
    name: string;
    description: string;
    icon: React.ReactNode;
    extension: string;
}

const formatOptions: FormatOption[] = [
    {
        id: "pdf",
        name: "PDF",
        description: "Portable Document Format",
        icon: <FileText className="w-5 h-5 text-red-500" />,
        extension: ".pdf",
    },
    {
        id: "markdown",
        name: "Markdown",
        description: "Plain text with formatting",
        icon: <Code className="w-5 h-5 text-blue-500" />,
        extension: ".md",
    },
    {
        id: "html",
        name: "HTML",
        description: "Web page format",
        icon: <Code className="w-5 h-5 text-orange-500" />,
        extension: ".html",
    },
    {
        id: "text",
        name: "Plain Text",
        description: "Unformatted text",
        icon: <File className="w-5 h-5 text-gray-500" />,
        extension: ".txt",
    },
];

export function ExportDialog({
    isOpen,
    onClose,
    title,
    content,
    bibliography,
}: ExportDialogProps) {
    const [selectedFormat, setSelectedFormat] = useState<ExportFormat>("pdf");
    const [includeCitations, setIncludeCitations] = useState(true);
    const [pageSize, setPageSize] = useState<PageSize>("letter");
    const [fontSize, setFontSize] = useState(12);
    const [isExporting, setIsExporting] = useState(false);
    const [exportSuccess, setExportSuccess] = useState(false);

    const handleExport = async () => {
        setIsExporting(true);
        setExportSuccess(false);

        try {
            const response = await fetch("/api/document-generator/export", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    format: selectedFormat,
                    title,
                    content,
                    options: {
                        includeCitations,
                        pageSize,
                        fontSize,
                        bibliography: includeCitations ? bibliography : undefined,
                    },
                }),
            });

            if (selectedFormat === "pdf") {
                // PDF returns binary data directly
                const blob = await response.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `${title.replace(/[^a-zA-Z0-9]/g, "_")}.pdf`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            } else {
                // Other formats return JSON with content
                const data = await response.json() as { success: boolean; content?: string; contentType?: string; filename?: string };
                if (data.success && data.content && data.contentType && data.filename) {
                    const blob = new Blob([data.content], { type: data.contentType });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = data.filename;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                }
            }

            setExportSuccess(true);
            setTimeout(() => {
                setExportSuccess(false);
                onClose();
            }, 1500);
        } catch (error) {
            console.error("Export error:", error);
        } finally {
            setIsExporting(false);
        }
    };

    const selectedFormatOption = formatOptions.find((f) => f.id === selectedFormat);

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Download className="w-5 h-5" />
                        Export Document
                    </DialogTitle>
                    <DialogDescription>
                        Choose a format and options to download your document.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-6 py-4">
                    {/* Format Selection */}
                    <div className="space-y-3">
                        <Label>Format</Label>
                        <div className="grid grid-cols-2 gap-2">
                            {formatOptions.map((format) => (
                                <button
                                    key={format.id}
                                    onClick={() => setSelectedFormat(format.id)}
                                    className={cn(
                                        "flex items-center gap-3 p-3 rounded-lg border-2 transition-all text-left",
                                        selectedFormat === format.id
                                            ? "border-purple-500 bg-purple-50 dark:bg-purple-900/20"
                                            : "border-border hover:border-purple-300"
                                    )}
                                >
                                    {format.icon}
                                    <div>
                                        <div className="font-medium text-sm">{format.name}</div>
                                        <div className="text-xs text-muted-foreground">
                                            {format.extension}
                                        </div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* PDF-specific options */}
                    {selectedFormat === "pdf" && (
                        <div className="space-y-4 p-4 bg-muted/50 rounded-lg">
                            <div className="flex items-center justify-between">
                                <Label htmlFor="pageSize">Page Size</Label>
                                <Select value={pageSize} onValueChange={(v) => setPageSize(v as PageSize)}>
                                    <SelectTrigger className="w-32">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="letter">Letter</SelectItem>
                                        <SelectItem value="a4">A4</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="flex items-center justify-between">
                                <Label htmlFor="fontSize">Font Size</Label>
                                <Select
                                    value={fontSize.toString()}
                                    onValueChange={(v) => setFontSize(parseInt(v))}
                                >
                                    <SelectTrigger className="w-32">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="10">10pt</SelectItem>
                                        <SelectItem value="11">11pt</SelectItem>
                                        <SelectItem value="12">12pt</SelectItem>
                                        <SelectItem value="14">14pt</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    )}

                    {/* Citations option */}
                    {bibliography && (
                        <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                            <div>
                                <Label htmlFor="citations">Include Bibliography</Label>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    Add references section at the end
                                </p>
                            </div>
                            <Switch
                                id="citations"
                                checked={includeCitations}
                                onCheckedChange={setIncludeCitations}
                            />
                        </div>
                    )}

                    {/* Preview info */}
                    <div className="p-4 border border-border rounded-lg">
                        <div className="flex items-center gap-3">
                            {selectedFormatOption?.icon}
                            <div>
                                <p className="font-medium text-sm">
                                    {title.slice(0, 40)}{title.length > 40 ? "..." : ""}
                                    {selectedFormatOption?.extension}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                    ~{Math.ceil(content.length / 300)} page(s) •{" "}
                                    {selectedFormatOption?.description}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Actions */}
                <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={onClose} disabled={isExporting}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleExport}
                        disabled={isExporting}
                        className={cn(
                            "min-w-[100px]",
                            exportSuccess
                                ? "bg-green-600 hover:bg-green-700"
                                : "bg-purple-600 hover:bg-purple-700"
                        )}
                    >
                        {isExporting ? (
                            <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Exporting...
                            </>
                        ) : exportSuccess ? (
                            <>
                                <Check className="w-4 h-4 mr-2" />
                                Done!
                            </>
                        ) : (
                            <>
                                <Download className="w-4 h-4 mr-2" />
                                Export
                            </>
                        )}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
