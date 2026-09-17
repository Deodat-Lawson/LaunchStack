"use client";

import { useState } from "react";
import { toast } from "sonner";

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

import { prospectsApi } from "../api";
import { useProspects } from "../_lib/context";

/**
 * The manual way to start a segment: name it, say what you sell, and where.
 * The derived path (from your company profile and documents) arrives with
 * the pipeline reframe; until then this is what Find companies searches for.
 */
export function NewSegmentDialog({
    open,
    onOpenChange,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const { reloadSegments, setSegmentId } = useProspects();
    const [name, setName] = useState("");
    const [offering, setOffering] = useState("");
    const [industries, setIndustries] = useState("");
    const [countries, setCountries] = useState("");
    const [busy, setBusy] = useState(false);

    const reset = () => {
        setName("");
        setOffering("");
        setIndustries("");
        setCountries("");
    };

    const submit = async () => {
        setBusy(true);
        try {
            const { segment } = await prospectsApi.createSegment({
                name: name.trim(),
                offering: offering.trim(),
                industries: industries
                    .split(",")
                    .map(s => s.trim())
                    .filter(Boolean),
                countries: countries
                    .split(/[,\s]+/)
                    .map(s => s.trim().toUpperCase())
                    .filter(s => s.length === 2),
            });
            await reloadSegments();
            setSegmentId(segment.id);
            toast.success(
                `Segment “${segment.name}” created. Run Find companies when you are ready.`
            );
            reset();
            onOpenChange(false);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not create the segment");
        } finally {
            setBusy(false);
        }
    };

    const valid =
        name.trim().length > 0 &&
        offering.trim().length > 0 &&
        countries.split(/[,\s]+/).some(s => s.trim().length === 2);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>New segment</DialogTitle>
                    <DialogDescription>
                        Who you want to sell to, and where. You can refine every field afterwards.
                    </DialogDescription>
                </DialogHeader>
                <form
                    className="grid gap-3"
                    onSubmit={e => {
                        e.preventDefault();
                        if (valid && !busy) void submit();
                    }}
                >
                    <div className="grid gap-1.5">
                        <Label htmlFor="seg-name" className="text-xs">
                            Name
                        </Label>
                        <Input
                            id="seg-name"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            placeholder="Fulfilment operators · EU"
                            autoFocus
                        />
                    </div>
                    <div className="grid gap-1.5">
                        <Label htmlFor="seg-offering" className="text-xs">
                            What you sell
                        </Label>
                        <Textarea
                            id="seg-offering"
                            rows={2}
                            value={offering}
                            onChange={e => setOffering(e.target.value)}
                            placeholder="Picking robots for e-commerce warehouses, leased per robot per month"
                        />
                    </div>
                    <div className="grid gap-1.5">
                        <Label htmlFor="seg-industries" className="text-xs">
                            Industries <span className="text-ink-3">(comma separated)</span>
                        </Label>
                        <Input
                            id="seg-industries"
                            value={industries}
                            onChange={e => setIndustries(e.target.value)}
                            placeholder="E-commerce fulfilment, 3PL, contract logistics"
                        />
                    </div>
                    <div className="grid gap-1.5">
                        <Label htmlFor="seg-countries" className="text-xs">
                            Countries <span className="text-ink-3">(two-letter codes)</span>
                        </Label>
                        <Input
                            id="seg-countries"
                            value={countries}
                            onChange={e => setCountries(e.target.value)}
                            placeholder="NL, DE, GB"
                        />
                    </div>
                    <DialogFooter className="mt-2">
                        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={!valid || busy}>
                            Create segment
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
