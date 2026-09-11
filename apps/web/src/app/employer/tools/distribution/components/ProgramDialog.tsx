"use client";

import { useEffect, useState } from "react";

import { Button } from "~/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { cn } from "~/lib/utils";

import { KIND_LABELS, type PartnerKind, type ProgramDto, type Territory } from "../api";

interface Props {
    open: boolean;
    mode: "create" | "edit";
    program: ProgramDto | null;
    onClose: () => void;
    onSubmit: (input: unknown) => Promise<void>;
}

/** "DE; NL:Amsterdam:20000; FR:Paris" → territories. */
export function parseTerritories(text: string): Territory[] {
    return text
        .split(/[;\n]/)
        .map(s => s.trim())
        .filter(Boolean)
        .map(entry => {
            const [country, region, radius] = entry.split(":").map(s => s.trim());
            const t: Territory = { country: (country ?? "").toUpperCase() };
            if (region) t.region = region;
            if (radius && Number.isFinite(Number(radius))) t.radiusMeters = Number(radius);
            return t;
        });
}

function territoriesToText(list: Territory[]): string {
    return list
        .map(t =>
            [t.country, t.region, t.radiusMeters].filter(v => v !== undefined && v !== "").join(":")
        )
        .join("; ");
}

const splitList = (text: string) =>
    text
        .split(/[,;\n]/)
        .map(s => s.trim())
        .filter(Boolean);

export function ProgramDialog({ open, mode, program, onClose, onSubmit }: Props) {
    const [name, setName] = useState("");
    const [offering, setOffering] = useState("");
    const [categories, setCategories] = useState("");
    const [hsCodes, setHsCodes] = useState("");
    const [territories, setTerritories] = useState("");
    const [kinds, setKinds] = useState<PartnerKind[]>(["importer", "distributor"]);
    const [constraints, setConstraints] = useState("");
    const [knownDomains, setKnownDomains] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        setProblem(null);
        if (mode === "edit" && program) {
            setName(program.name);
            setOffering(program.offering);
            setCategories(program.categories.join(", "));
            setHsCodes(program.hsCodes.join(", "));
            setTerritories(territoriesToText(program.targetTerritories));
            setKinds(program.partnerKinds);
            setConstraints(program.constraints ?? "");
            setKnownDomains(program.knownPartnerDomains.join("\n"));
        } else {
            setName("");
            setOffering("");
            setCategories("");
            setHsCodes("");
            setTerritories("");
            setKinds(["importer", "distributor"]);
            setConstraints("");
            setKnownDomains("");
        }
    }, [open, mode, program]);

    const toggleKind = (k: PartnerKind) =>
        setKinds(list => (list.includes(k) ? list.filter(x => x !== k) : [...list, k]));

    return (
        <Dialog open={open} onOpenChange={o => !o && onClose()}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>{mode === "edit" ? "Edit program" : "New program"}</DialogTitle>
                    <DialogDescription>
                        The partner profile discovery recruits against. Everything here shapes the
                        plan, the dossier research and the fit score.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4">
                    <div className="grid gap-1.5">
                        <Label htmlFor="pg-name">Name</Label>
                        <Input
                            id="pg-name"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            placeholder="EU specialty coffee, importers and distributors"
                        />
                    </div>
                    <div className="grid gap-1.5">
                        <Label htmlFor="pg-offering">What is being distributed</Label>
                        <Textarea
                            id="pg-offering"
                            rows={3}
                            value={offering}
                            onChange={e => setOffering(e.target.value)}
                            placeholder="Single-origin roasted coffee (250 g retail bags and 1 kg foodservice), organic certified, roasted to order…"
                        />
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                        <div className="grid gap-1.5">
                            <Label htmlFor="pg-categories">Categories</Label>
                            <Input
                                id="pg-categories"
                                value={categories}
                                onChange={e => setCategories(e.target.value)}
                                placeholder="specialty coffee, roasted coffee"
                            />
                        </div>
                        <div className="grid gap-1.5">
                            <Label htmlFor="pg-hs">HS codes (optional)</Label>
                            <Input
                                id="pg-hs"
                                value={hsCodes}
                                onChange={e => setHsCodes(e.target.value)}
                                placeholder="0901, 090121"
                            />
                        </div>
                    </div>
                    <div className="grid gap-1.5">
                        <Label htmlFor="pg-territories">Territories</Label>
                        <Input
                            id="pg-territories"
                            value={territories}
                            onChange={e => setTerritories(e.target.value)}
                            placeholder="DE; NL:Amsterdam:20000; FR"
                        />
                        <p className="text-ink-3 text-xs">
                            Country code, optionally :city or region, optionally :radius in metres
                            for place search. Separate with semicolons.
                        </p>
                    </div>
                    <div className="grid gap-1.5">
                        <Label>Partner kinds</Label>
                        <div className="flex flex-wrap gap-1.5">
                            {(Object.keys(KIND_LABELS) as PartnerKind[]).map(k => (
                                <button
                                    key={k}
                                    type="button"
                                    onClick={() => toggleKind(k)}
                                    className={cn(
                                        "rounded-md border px-2.5 py-1 text-xs transition",
                                        kinds.includes(k)
                                            ? "border-brand bg-brand-soft text-brand-ink"
                                            : "border-line text-ink-2 hover:bg-panel-2"
                                    )}
                                    aria-pressed={kinds.includes(k)}
                                >
                                    {KIND_LABELS[k]}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="grid gap-1.5">
                        <Label htmlFor="pg-constraints">Constraints (optional)</Label>
                        <Textarea
                            id="pg-constraints"
                            rows={2}
                            value={constraints}
                            onChange={e => setConstraints(e.target.value)}
                            placeholder="MOQ 200 kg; exclusive per country only for importers; needs EU organic certification"
                        />
                    </div>
                    <div className="grid gap-1.5">
                        <Label htmlFor="pg-known">
                            Existing partners&rsquo; domains (one per line)
                        </Label>
                        <Textarea
                            id="pg-known"
                            rows={2}
                            value={knownDomains}
                            onChange={e => setKnownDomains(e.target.value)}
                            placeholder="current-importer.de"
                        />
                        <p className="text-ink-3 text-xs">
                            Discovery will never surface these, and outreach will refuse them.
                        </p>
                    </div>
                    {problem && <p className="text-danger text-sm">{problem}</p>}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={submitting}>
                        Cancel
                    </Button>
                    <Button
                        disabled={submitting}
                        onClick={async () => {
                            const parsedTerritories = parseTerritories(territories);
                            if (!name.trim() || !offering.trim())
                                return setProblem("Name and offering are required.");
                            if (
                                parsedTerritories.length === 0 ||
                                parsedTerritories.some(t => t.country.length !== 2)
                            )
                                return setProblem(
                                    "Add at least one territory as a two-letter country code."
                                );
                            if (kinds.length === 0)
                                return setProblem("Pick at least one partner kind.");
                            setSubmitting(true);
                            setProblem(null);
                            await onSubmit({
                                name: name.trim(),
                                offering: offering.trim(),
                                categories: splitList(categories),
                                hsCodes: splitList(hsCodes)
                                    .map(c => c.replace(/\D/g, ""))
                                    .filter(Boolean),
                                targetTerritories: parsedTerritories,
                                partnerKinds: kinds,
                                constraints: constraints.trim() || null,
                                knownPartnerDomains: splitList(knownDomains),
                            });
                            setSubmitting(false);
                        }}
                    >
                        {submitting
                            ? "Saving…"
                            : mode === "edit"
                              ? "Save program"
                              : "Create program"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
