"use client";

import { useState } from "react";
import Image from "next/image";
import {
    ArrowDown,
    ArrowUp,
    ChevronDown,
    ChevronRight,
    GripVertical,
    Pencil,
    Play,
    Send,
    X,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import type { ChatQueueItem } from "~/lib/chat-turns";

export function ChatQueue({
    items,
    held,
    busy,
    editingId,
    onEdit,
    onCancelEdit,
    onRemove,
    onReorder,
    onResume,
    onSendNow,
}: {
    items: ChatQueueItem[];
    held: boolean;
    busy: boolean;
    editingId: string | null;
    onEdit: (id: string) => void;
    onCancelEdit: () => void;
    onRemove: (id: string) => void;
    onReorder: (items: ChatQueueItem[]) => void;
    onResume: () => void;
    onSendNow: (id: string) => void;
}) {
    const [collapsed, setCollapsed] = useState(false);
    const [dragId, setDragId] = useState<string | null>(null);
    if (!items.length) return null;
    const move = (from: number, to: number) => {
        if (to < 0 || to >= items.length || from === to) return;
        const next = [...items];
        next.splice(to, 0, ...next.splice(from, 1));
        onReorder(next);
    };
    return (
        <section
            aria-label="Queued messages"
            aria-live="polite"
            className="border-line bg-panel mb-3 rounded-xl border p-2"
        >
            <div className="flex items-center justify-between gap-2">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setCollapsed(value => !value)}
                    aria-expanded={!collapsed}
                >
                    {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}{" "}
                    {items.length} queued {held && "· paused"}
                </Button>
                {held && !busy && (
                    <Button variant="ghost" size="sm" onClick={onResume}>
                        <Play size={14} /> Resume queue
                    </Button>
                )}
            </div>
            {!collapsed && (
                <ol className="space-y-1">
                    {items.map((item, index) => (
                        <li
                            key={item.id}
                            className={`border-line flex flex-wrap items-center gap-1 rounded-lg border p-2 ${editingId === item.id ? "bg-brand-soft" : "bg-panel"}`}
                            onDragOver={event => event.preventDefault()}
                            onDrop={event => {
                                event.preventDefault();
                                if (dragId)
                                    move(
                                        items.findIndex(row => row.id === dragId),
                                        index
                                    );
                                setDragId(null);
                            }}
                        >
                            <Button
                                variant="ghost"
                                size="icon"
                                className="size-7 shrink-0"
                                draggable
                                onDragStart={() => setDragId(item.id)}
                                onDragEnd={() => setDragId(null)}
                                aria-label={`Move queued message ${index + 1}`}
                                title="Drag to reorder, or use arrow keys"
                                onKeyDown={event => {
                                    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                                        event.preventDefault();
                                        move(index, index + (event.key === "ArrowUp" ? -1 : 1));
                                    }
                                }}
                            >
                                <GripVertical size={14} />
                            </Button>
                            {item.send.attachments
                                .filter(file => file.kind === "image")
                                .slice(0, 3)
                                .map(file => (
                                    <Image
                                        key={file.id}
                                        unoptimized
                                        src={file.url}
                                        alt={file.name}
                                        width={28}
                                        height={28}
                                        className="size-7 rounded object-cover"
                                    />
                                ))}
                            <span
                                className="min-w-0 flex-1 truncate text-xs"
                                title={item.send.text}
                            >
                                {item.send.text || `${item.send.attachments.length} attached files`}
                            </span>
                            <div className="flex items-center">
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-7"
                                    aria-label={`Move message ${index + 1} up`}
                                    disabled={index === 0}
                                    onClick={() => move(index, index - 1)}
                                >
                                    <ArrowUp size={13} />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-7"
                                    aria-label={`Move message ${index + 1} down`}
                                    disabled={index === items.length - 1}
                                    onClick={() => move(index, index + 1)}
                                >
                                    <ArrowDown size={13} />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-7"
                                    aria-label={`Edit queued message ${index + 1}`}
                                    onClick={() => onEdit(item.id)}
                                >
                                    <Pencil size={13} />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-7"
                                    aria-label={`Send queued message ${index + 1} now`}
                                    title={
                                        busy
                                            ? "Stop current response and send this message"
                                            : "Send this message"
                                    }
                                    onClick={() => onSendNow(item.id)}
                                >
                                    <Send size={13} />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-7"
                                    aria-label={`Remove queued message ${index + 1}`}
                                    onClick={() => onRemove(item.id)}
                                >
                                    <X size={13} />
                                </Button>
                            </div>
                            {editingId === item.id && (
                                <div className="text-ink-2 flex w-full items-center justify-between pl-8 text-xs">
                                    <span>
                                        Editing in composer. Send to save this queued message.
                                    </span>
                                    <Button variant="ghost" size="sm" onClick={onCancelEdit}>
                                        Cancel edit
                                    </Button>
                                </div>
                            )}
                        </li>
                    ))}
                </ol>
            )}
        </section>
    );
}
