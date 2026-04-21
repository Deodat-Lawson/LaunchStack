"use client";

import { useState } from "react";

export default function HomePage() {
    const [question, setQuestion] = useState("");
    const [answer, setAnswer] = useState("");
    const [references, setReferences] = useState<number[]>([]);
    const [loading, setLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState("");

    async function handleAsk() {
        setLoading(true);
        setErrorMsg("");
        setAnswer("");
        setReferences([]);

        try {
            console.log("sent")
            const response = await fetch("/api/question", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ question }),
            });

            if (!response.ok) {
                const rawErrorData:unknown = await response.json();
                if (typeof rawErrorData !== "object") {
                    throw new Error(`Request failed with status ${response.status}`);
                }
                const errorData = rawErrorData as { error?: string };
                throw new Error(errorData.error ?? "Request failed");
            }

            const rawData:unknown = await response.json();
            if (typeof rawData !== "object") {
                throw new Error("Invalid response from server");
            }
            const data = rawData as { answer: string; references: number[] };
            setAnswer(data.answer);
            setReferences(data.references);
        } catch (err: unknown) {
            if (err instanceof Error) {
                setErrorMsg(err.message);
            } else {
                setErrorMsg(`Non-Error thrown: ${String(err)}`);
            }
        } finally {
            setLoading(false);
        }
    }

    return (
        <main style={{ padding: "2rem" }}>
            <h1>Ask About the PDF</h1>
            <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                rows={4}
                style={{ width: "100%" }}
                placeholder="Ask a question about the PDF..."
            />
            <br />
            <button onClick={handleAsk} disabled={!question || loading}>
                {loading ? "Asking..." : "Ask"}
            </button>
            {errorMsg && <p style={{ color: "red" }}>Error: {errorMsg}</p>}
            {answer && (
                <div style={{ marginTop: "1rem" }}>
                    <h2>Answer</h2>
                    <p>{answer}</p>
                    {references.length > 0 && (
                        <p><b>References (pages):</b> {references.join(", ")}</p>
                    )}
                </div>
            )}
        </main>
    );
}