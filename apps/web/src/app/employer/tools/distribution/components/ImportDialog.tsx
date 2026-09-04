"use client";

import { useState } from "react";

import { Button } from "~/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "~/components/ui/dialog";
import { Textarea } from "~/components/ui/textarea";

const KINDS = new Set([
    "importer",
    "distributor",
    "wholesaler",
    "retailer",
    "agent",
    "reseller",
    "supplier",
]);
const STAGES = new Set([
    "candidate",
    "researched",
    "contacted",
    "in_conversation",
    "qualified",
    "negotiating",
    "contracted",
    "active",
    "declined",
    "dormant",
]);

/** name, domain, country, kind, territoryCountry, stage — header row optional. */
export function parseImportCsv(text: string): {
    rows: Array<Record<string, string>>;
    errors: string[];
} {
    const lines = text
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(Boolean);
    const errors: string[] = [];
    const rows: Array<Record<string, string>> = [];
    const first = lines[0]?.toLowerCase() ?? "";
    const start = first.startsWith("name") ? 1 : 0;
    for (let i = start; i < lines.length; i++) {
        const cells = lines[i]!.split(",").map(c => c.trim().replace(/^"|"$/g, ""));
        const [name, domain, country, kind, territoryCountry, stage] = cells;
        if (!name) {
            errors.push(`Line ${i + 1}: name is required`);
            continue;
        }
        if (!kind || !KINDS.has(kind)) {
            errors.push(`Line ${i + 1}: kind must be one of ${[...KINDS].join(", ")}`);
            continue;
        }
        if (stage && !STAGES.has(stage)) {
            errors.push(`Line ${i + 1}: unknown stage "${stage}"`);
            continue;
        }
        const row: Record<string, string> = { name, kind };
        if (domain) row.domain = domain;
        if (country) row.country = country;
        if (territoryCountry) row.territoryCountry = territoryCountry.toUpperCase();
        if (stage) row.stage = stage;
        rows.push(row);
    }
    return { rows, errors };
}

export function ImportDialog({
    open,
    onClose,
    onSubmit,
}: {
    open: boolean;
    onClose: () => void;
    onSubmit: (rows: unknown[]) => Promise<void>;
}) {
    const [text, setText] = useState("");
    const [errors, setErrors] = useState<string[]>([]);
    const [submitting, setSubmitting] = useState(false);
    return (
        <Dialog open={open} onOpenChange={o => !o && onClose()}>
            <DialogContent className="sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>Import existing partners</DialogTitle>
                    <DialogDescription>
                        Paste CSV rows:{" "}
                        <code className="font-mono">
                            name, domain, country, kind, territoryCountry, stage
                        </code>
                        . Stage defaults to active. Imported partners are excluded from discovery
                        and outreach.
                    </DialogDescription>
                </DialogHeader>
                <Textarea
                    rows={8}
                    value={text}
                    onChange={e => setText(e.target.value)}
                    placeholder={
                        "name,domain,country,kind,territoryCountry,stage\nAcme Import GmbH,acme-import.de,DE,importer,DE,active"
                    }
                    className="font-mono text-xs"
                />
                {errors.length > 0 && (
                    <ul className="text-danger list-disc pl-5 text-xs">
                        {errors.slice(0, 8).map((e, i) => (
                            <li key={i}>{e}</li>
                        ))}
                    </ul>
                )}
                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={submitting}>
                        Cancel
                    </Button>
                    <Button
                        disabled={submitting || !text.trim()}
                        onClick={async () => {
                            const parsed = parseImportCsv(text);
                            setErrors(parsed.errors);
                            if (parsed.errors.length > 0 || parsed.rows.length === 0) return;
                            setSubmitting(true);
                            await onSubmit(parsed.rows);
                            setSubmitting(false);
                            setText("");
                        }}
                    >
                        {submitting ? "Importing…" : "Import"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
