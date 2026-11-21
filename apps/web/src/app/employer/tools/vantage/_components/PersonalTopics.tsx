"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import type { PersonalTopic } from "~/server/vantage/weekly-review-personal-topics";

const fields = ["openQuestions", "decisionChangers", "keywords", "people", "metrics"] as const;
const empty: Omit<PersonalTopic, "id" | "revision"> = {
    title: "",
    status: "active" as const,
    openQuestions: [],
    decisionChangers: [],
    keywords: [],
    people: [],
    metrics: [],
    watches: [],
};
const endpoint = "/api/vantage/reviews/context/topics";
export function PersonalTopics() {
    const t = useTranslations("vantage.weeklyReview.personalTopics");
    const [topics, setTopics] = useState<PersonalTopic[]>([]);
    const [documents, setDocuments] = useState<{ id: string; title: string }[]>([]);
    const [draft, setDraft] = useState<
        Partial<PersonalTopic> & Omit<PersonalTopic, "id" | "revision">
    >(empty);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<"" | "failed" | "conflict">("");
    const [canEdit, setCanEdit] = useState(false);
    async function reload() {
        const response = await fetch(endpoint);
        if (!response.ok) throw new Error("load");
        const data = (await response.json()) as {
            topics: PersonalTopic[];
            documents: { id: string; title: string }[];
            canEdit: boolean;
        };
        setTopics(data.topics);
        setDocuments(data.documents);
        setCanEdit(data.canEdit);
    }
    useEffect(() => {
        void reload().catch(() => setError("failed"));
    }, []);
    async function save(value: Partial<PersonalTopic> & Omit<PersonalTopic, "id" | "revision">) {
        setBusy(true);
        setError("");
        try {
            const { id, revision, ...input } = value;
            const response = await fetch(endpoint, {
                method: id ? "PATCH" : "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(id ? { ...input, id, expectedRevision: revision } : input),
            });
            if (!response.ok) {
                setError(response.status === 409 ? "conflict" : "failed");
                return;
            }
            setDraft(empty);
            await reload();
        } catch {
            setError("failed");
        } finally {
            setBusy(false);
        }
    }
    return (
        <section className="space-y-4 rounded-lg border p-4">
            <h2 className="text-lg font-semibold">{t("title")}</h2>
            {error ? <p role="alert">{t(error)}</p> : null}
            {topics.map(topic => (
                <div key={topic.id} className="flex items-center gap-3">
                    <span>
                        {topic.title} · {t(topic.status)}
                    </span>
                    <Button
                        variant="outline"
                        disabled={!canEdit || busy}
                        onClick={() => setDraft(topic)}
                    >
                        {t("edit")}
                    </Button>
                    <Button
                        variant="outline"
                        disabled={!canEdit || busy}
                        onClick={() =>
                            void save({
                                ...topic,
                                status: topic.status === "active" ? "closed" : "active",
                            })
                        }
                    >
                        {t(topic.status === "active" ? "close" : "reopen")}
                    </Button>
                </div>
            ))}
            {canEdit ? (
                <form
                    className="space-y-3"
                    onSubmit={event => {
                        event.preventDefault();
                        void save(draft);
                    }}
                >
                    <label className="block">
                        {t("name")}
                        <Input
                            required
                            maxLength={200}
                            value={draft.title}
                            onChange={e => setDraft({ ...draft, title: e.target.value })}
                        />
                    </label>
                    {fields.map(field => (
                        <label className="block" key={field}>
                            {t(field)}
                            <textarea
                                className="block w-full rounded border p-2"
                                value={draft[field].join("\n")}
                                onChange={e =>
                                    setDraft({
                                        ...draft,
                                        [field]: e.target.value.split("\n").filter(Boolean),
                                    })
                                }
                            />
                        </label>
                    ))}
                    <fieldset>
                        <legend>{t("watches")}</legend>
                        <div className="max-h-48 overflow-auto">
                            {documents.map(document => (
                                <label key={document.id} className="block">
                                    <input
                                        type="checkbox"
                                        checked={draft.watches.includes(document.id)}
                                        onChange={e =>
                                            setDraft({
                                                ...draft,
                                                watches: e.target.checked
                                                    ? [...draft.watches, document.id]
                                                    : draft.watches.filter(
                                                          id => id !== document.id
                                                      ),
                                            })
                                        }
                                    />{" "}
                                    {document.title}
                                </label>
                            ))}
                        </div>
                    </fieldset>
                    <Button disabled={busy} type="submit">
                        {t("save")}
                    </Button>
                    {draft.id ? (
                        <Button type="button" variant="outline" onClick={() => setDraft(empty)}>
                            {t("cancel")}
                        </Button>
                    ) : null}
                </form>
            ) : null}
        </section>
    );
}
