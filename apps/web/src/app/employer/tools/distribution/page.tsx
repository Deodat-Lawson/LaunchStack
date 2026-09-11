"use client";

import { Compass, Plus, RefreshCw, Upload } from "lucide-react";
import { useState } from "react";

import { ToolsStudioShell } from "~/app/employer/_chrome/ToolsStudioShell";
import { Button } from "~/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";

import { ImportDialog } from "./components/ImportDialog";
import { Overview } from "./components/Overview";
import { PartnerDrawer } from "./components/PartnerDrawer";
import { PartnersTable } from "./components/PartnersTable";
import { PipelineBoard } from "./components/PipelineBoard";
import { ProgramDialog } from "./components/ProgramDialog";
import { ProgramPanel } from "./components/ProgramPanel";
import { RunsPanel } from "./components/RunsPanel";
import { useDistribution } from "./useDistribution";

export default function DistributionPage() {
    const state = useDistribution();
    const [programDialog, setProgramDialog] = useState<"closed" | "create" | "edit">("closed");
    const [importOpen, setImportOpen] = useState(false);

    return (
        <ToolsStudioShell>
            <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-5 px-4 pb-10 pt-6">
                <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="flex items-center gap-3">
                        <div className="bg-brand-soft text-brand-ink flex h-10 w-10 items-center justify-center rounded-2xl">
                            <Compass className="h-5 w-5" />
                        </div>
                        <div>
                            <h1 className="text-ink text-lg font-semibold tracking-tight md:text-xl">
                                Distribution
                            </h1>
                            <p className="text-ink-2 text-xs md:text-sm">
                                Find importers, distributors and retail accounts, prove the fit with
                                evidence, and run the relationship to a signed agreement.
                            </p>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        {state.programs.length > 0 && (
                            <Select
                                value={state.programId ?? undefined}
                                onValueChange={value => state.setProgramId(value)}
                            >
                                <SelectTrigger className="w-[240px]" aria-label="Program">
                                    <SelectValue placeholder="Choose a program" />
                                </SelectTrigger>
                                <SelectContent>
                                    {state.programs.map(p => (
                                        <SelectItem key={p.id} value={p.id}>
                                            {p.name}
                                            {p.status === "archived" ? " (archived)" : ""}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void state.refreshAll()}
                            disabled={!state.programId}
                        >
                            <RefreshCw className="h-4 w-4" /> Refresh
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setImportOpen(true)}
                            disabled={!state.programId}
                        >
                            <Upload className="h-4 w-4" /> Import partners
                        </Button>
                        <Button size="sm" onClick={() => setProgramDialog("create")}>
                            <Plus className="h-4 w-4" /> New program
                        </Button>
                    </div>
                </header>

                {state.error && (
                    <div
                        role="alert"
                        className="border-danger/40 bg-danger/10 text-danger flex items-start justify-between gap-3 rounded-md border px-3 py-2 text-sm"
                    >
                        <span>{state.error}</span>
                        <button className="underline" onClick={() => state.setError(null)}>
                            Dismiss
                        </button>
                    </div>
                )}
                {state.notice && (
                    <div
                        role="status"
                        className="border-line bg-panel text-ink-2 flex items-start justify-between gap-3 rounded-md border px-3 py-2 text-sm"
                    >
                        <span>{state.notice}</span>
                        <button className="underline" onClick={() => state.setNotice(null)}>
                            Dismiss
                        </button>
                    </div>
                )}

                {!state.loading.programs && state.programs.length === 0 ? (
                    <section className="border-line bg-panel rounded-2xl border p-8 text-center">
                        <h2 className="text-ink text-base font-semibold">Start with a program</h2>
                        <p className="text-ink-2 mx-auto mt-2 max-w-xl text-sm">
                            A program is the partner profile you want to recruit against: what you
                            sell, which territories, and which kinds of partner. Discovery runs,
                            dossiers and the pipeline all hang off it.
                        </p>
                        <Button className="mt-4" onClick={() => setProgramDialog("create")}>
                            <Plus className="h-4 w-4" /> Create your first program
                        </Button>
                    </section>
                ) : (
                    <Tabs defaultValue="overview" className="flex flex-1 flex-col gap-4">
                        <TabsList>
                            <TabsTrigger value="overview">Overview</TabsTrigger>
                            <TabsTrigger value="partners">Partners</TabsTrigger>
                            <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
                            <TabsTrigger value="runs">Runs</TabsTrigger>
                            <TabsTrigger value="program">Program</TabsTrigger>
                        </TabsList>
                        <TabsContent value="overview">
                            <Overview state={state} />
                        </TabsContent>
                        <TabsContent value="partners">
                            <PartnersTable state={state} />
                        </TabsContent>
                        <TabsContent value="pipeline">
                            <PipelineBoard state={state} />
                        </TabsContent>
                        <TabsContent value="runs">
                            <RunsPanel state={state} />
                        </TabsContent>
                        <TabsContent value="program">
                            <ProgramPanel state={state} onEdit={() => setProgramDialog("edit")} />
                        </TabsContent>
                    </Tabs>
                )}
            </main>

            <ProgramDialog
                open={programDialog !== "closed"}
                mode={programDialog === "edit" ? "edit" : "create"}
                program={programDialog === "edit" ? state.program : null}
                onClose={() => setProgramDialog("closed")}
                onSubmit={async input => {
                    const ok =
                        programDialog === "edit" && state.program
                            ? await state.updateProgram(state.program.id, input)
                            : await state.createProgram(input);
                    if (ok) setProgramDialog("closed");
                }}
            />
            <ImportDialog
                open={importOpen}
                onClose={() => setImportOpen(false)}
                onSubmit={async rows => {
                    const ok = await state.importPartners(rows);
                    if (ok) setImportOpen(false);
                }}
            />
            <PartnerDrawer state={state} />
        </ToolsStudioShell>
    );
}
