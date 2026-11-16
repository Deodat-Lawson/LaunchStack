import { NextResponse } from "next/server";
import { z } from "zod";
import {
    generateWeeklyReview,
    assertWeeklyReviewWeek,
    weeklyReviewEnabled,
    weeklyReviewServices,
} from "~/server/vantage/weekly-review-service";
import { reviewActor, reviewError, requestKey } from "./_http";
export const maxDuration = 120;
export async function GET(request: Request) {
    const auth = await reviewActor();
    if (!auth.ok) return auth.response;
    try {
        const week = new URL(request.url).searchParams.get("weekStart");
        if (week !== null) assertWeeklyReviewWeek(week);
        const repository = weeklyReviewServices().repository;
        return NextResponse.json({
            enabled: weeklyReviewEnabled(),
            activeId:
                weeklyReviewEnabled() && week && /^\d{4}-\d{2}-\d{2}$/.test(week)
                    ? await repository.active(auth.actor, week)
                    : null,
            runs: weeklyReviewEnabled() ? await repository.list(auth.actor) : [],
        });
    } catch (error) {
        return reviewError(error);
    }
}
export async function POST(request: Request) {
    const auth = await reviewActor(true);
    if (!auth.ok) return auth.response;
    try {
        const body = z
            .object({
                weekStart: z.string().date(),
                expectedActiveId: z.string().uuid().nullable(),
            })
            .strict()
            .parse(await request.json());
        assertWeeklyReviewWeek(body.weekStart);
        const args = { ...body, key: requestKey(request) };
        if (
            request.headers
                .get("Accept")
                ?.split(",")
                .some(value => value.trim().split(";")[0] === "application/x-ndjson")
        ) {
            const encoder = new TextEncoder();
            let connected = true;
            const stream = new ReadableStream<Uint8Array>({
                start(controller) {
                    const send = (event: unknown) => {
                        if (!connected) return;
                        try {
                            controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
                        } catch {
                            connected = false;
                        }
                    };
                    // Cancellation stops observation only. The authorized run retains its own lifecycle.
                    void generateWeeklyReview(auth.actor, args, stage =>
                        send({ type: "stage", stage })
                    )
                        .then(result => send({ type: "result", result }))
                        .catch(async error => {
                            const response = reviewError(error);
                            const body = z
                                .object({ error: z.string() })
                                .parse(await response.json());
                            send({ type: "error", error: body.error, status: response.status });
                        })
                        .finally(() => {
                            if (connected) {
                                try {
                                    controller.close();
                                } catch {
                                    /* disconnected */
                                }
                            }
                            connected = false;
                        });
                },
                cancel() {
                    connected = false;
                },
            });
            return new Response(stream, {
                headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" },
            });
        }
        return NextResponse.json(await generateWeeklyReview(auth.actor, args), { status: 201 });
    } catch (error) {
        if (error instanceof z.ZodError)
            return NextResponse.json({ error: "invalid_review_request" }, { status: 400 });
        return reviewError(error);
    }
}
