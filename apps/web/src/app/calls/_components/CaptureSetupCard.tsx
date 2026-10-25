"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Download, Laptop, Loader2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import type { CaptureDeviceSummary } from "@launchstack/pipelines/call-notes";

import { Button } from "~/components/ui/button";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "~/components/ui/dialog";
import { cn } from "~/lib/utils";

interface CaptureSetupCardProps {
    devices: CaptureDeviceSummary[];
    status: "checking" | "ready" | "failed";
    autoFocusConnect?: boolean;
    onDevicesChanged: () => void;
}

export function CaptureSetupCard({
    devices,
    status,
    autoFocusConnect = false,
    onDevicesChanged,
}: CaptureSetupCardProps) {
    const t = useTranslations("calls.captureSetup");
    const tc = useTranslations("common");
    const format = useFormatter();
    const connectRef = useRef<HTMLButtonElement>(null);
    const [waiting, setWaiting] = useState(false);
    const [pending, setPending] = useState<"download" | "connect" | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [revokeDevice, setRevokeDevice] = useState<CaptureDeviceSummary | null>(null);
    const [revoking, setRevoking] = useState(false);
    const [revokeError, setRevokeError] = useState<string | null>(null);
    const connectedDevice = status === "ready" ? devices.find(device => device.online) : undefined;

    useEffect(() => {
        if (autoFocusConnect) connectRef.current?.focus({ preventScroll: true });
    }, [autoFocusConnect]);

    const connect = async (action: "download" | "connect") => {
        if (pending) return;
        setPending(action);
        setError(null);
        try {
            const response = await fetch(
                action === "download"
                    ? "/api/call-notes/capture-app/downloads"
                    : "/api/call-notes/capture-app/connect-codes",
                { method: "POST" }
            );
            const body = (await response.json()) as {
                downloadUrl?: string;
                deepLink?: string;
                error?: string;
            };
            if (!response.ok) {
                const message = body.error?.trim();
                throw new Error(message ? message : t("connectionFailed"));
            }
            const destination = action === "download" ? body.downloadUrl : body.deepLink;
            if (!destination) throw new Error(t("connectionFailed"));
            setWaiting(true);
            // Navigate the top-level window so the DMG request carries the session cookie.
            window.location.href = destination;
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : t("connectionFailed"));
        } finally {
            setPending(null);
        }
    };

    const revoke = async () => {
        if (!revokeDevice || revoking) return;
        setRevoking(true);
        setRevokeError(null);
        try {
            const response = await fetch(
                `/api/call-notes/devices/${encodeURIComponent(revokeDevice.id)}`,
                { method: "DELETE" }
            );
            if (!response.ok) throw new Error(t("revokeFailed"));
            setRevokeDevice(null);
            onDevicesChanged();
        } catch {
            setRevokeError(t("revokeFailed"));
        } finally {
            setRevoking(false);
        }
    };

    return (
        <section
            aria-label={t("title")}
            className="border-line bg-panel mb-6 overflow-hidden rounded-xl border"
        >
            <div className="@max-sm:flex-col flex items-start gap-3.5 p-5">
                <div className="bg-brand-soft text-brand grid size-10 shrink-0 place-items-center rounded-xl">
                    {connectedDevice ? (
                        <CheckCircle2 className="size-5" aria-hidden="true" />
                    ) : (
                        <Laptop className="size-5" aria-hidden="true" />
                    )}
                </div>
                <div className="min-w-0 flex-1">
                    <h2 className="display text-ink m-0 text-base">{t("title")}</h2>
                    <p className="text-ink-2 m-0 mt-1 text-sm leading-relaxed">
                        {t("description")}
                    </p>
                    <p role="status" aria-live="polite" className="text-ink-2 m-0 mt-3 text-sm">
                        {connectedDevice
                            ? t("connected", { name: connectedDevice.name })
                            : waiting
                              ? t("waiting")
                              : status === "checking"
                                ? t("checking")
                                : status === "failed"
                                  ? t("statusUnavailable")
                                  : t("ready")}
                    </p>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                        <Button
                            type="button"
                            disabled={pending !== null}
                            onClick={() => void connect("download")}
                        >
                            {pending === "download" ? (
                                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                            ) : (
                                <Download className="size-4" aria-hidden="true" />
                            )}
                            {t("download")}
                        </Button>
                        <Button
                            ref={connectRef}
                            type="button"
                            variant="outline"
                            disabled={pending !== null}
                            onClick={() => void connect("connect")}
                        >
                            {pending === "connect" && (
                                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                            )}
                            {t("connect")}
                        </Button>
                    </div>
                    <p className="text-ink-3 m-0 mt-2 text-xs">{t("requirements")}</p>
                    {error && (
                        <p role="alert" className="text-danger m-0 mt-3 text-sm">
                            {error}
                        </p>
                    )}
                </div>
            </div>
            {devices.length > 0 && (
                <div className="border-line border-t px-5 py-4">
                    <h3 className="text-ink-2 m-0 mb-3 text-xs font-medium">{t("devices")}</h3>
                    <ul className="m-0 grid list-none gap-3 p-0" aria-label={t("devices")}>
                        {devices.map(device => (
                            <li key={device.id} className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="text-ink flex items-center gap-2 text-sm font-medium">
                                        <span
                                            className={cn(
                                                "size-2 shrink-0 rounded-full",
                                                device.online ? "bg-success" : "bg-ink-3"
                                            )}
                                            role="img"
                                            aria-label={device.online ? t("online") : t("offline")}
                                        />
                                        <span className="truncate">{device.name}</span>
                                    </div>
                                    <p className="text-ink-3 m-0 mt-0.5 text-xs">
                                        {t("version", { version: device.appVersion })}
                                        {" · "}
                                        {device.lastSeenAt
                                            ? t("lastSeen", {
                                                  date: format.dateTime(
                                                      new Date(device.lastSeenAt),
                                                      { dateStyle: "short", timeStyle: "short" }
                                                  ),
                                              })
                                            : t("neverSeen")}
                                    </p>
                                </div>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="text-ink-2 shrink-0"
                                    onClick={() => {
                                        setRevokeError(null);
                                        setRevokeDevice(device);
                                    }}
                                    aria-label={t("revokeDevice", { name: device.name })}
                                >
                                    {tc("actions.revoke")}
                                </Button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            <Dialog
                open={revokeDevice !== null}
                onOpenChange={open => {
                    if (!open && !revoking) setRevokeDevice(null);
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            {t("revokeTitle", { name: revokeDevice?.name ?? "" })}
                        </DialogTitle>
                        <DialogDescription>{t("revokeDescription")}</DialogDescription>
                    </DialogHeader>
                    {revokeError && (
                        <p role="alert" className="text-danger m-0 text-sm">
                            {revokeError}
                        </p>
                    )}
                    <DialogFooter>
                        <DialogClose asChild>
                            <Button type="button" variant="outline" disabled={revoking}>
                                {tc("actions.cancel")}
                            </Button>
                        </DialogClose>
                        <Button
                            type="button"
                            variant="destructive"
                            disabled={revoking}
                            onClick={() => void revoke()}
                        >
                            {revoking ? t("revoking") : tc("actions.revoke")}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </section>
    );
}
