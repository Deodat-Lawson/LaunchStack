import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';
import { MarketingPlatformEnum } from '~/lib/tools/marketing-pipeline/types';
import { publishContent } from '~/lib/tools/marketing-pipeline/publish';

export const runtime = 'nodejs';
export const maxDuration = 30;

const PublishSchema = z.object({
    platform: MarketingPlatformEnum,
    message: z.string().min(1).max(5000),
    title: z.string().max(300).optional(),
});

export async function POST(request: Request) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json(
                { success: false, message: 'Unauthorized' },
                { status: 401 },
            );
        }

        const body = (await request.json()) as unknown;
        const validation = PublishSchema.safeParse(body);
        if (!validation.success) {
            return NextResponse.json(
                { success: false, message: 'Invalid input', errors: validation.error.flatten() },
                { status: 400 },
            );
        }

        const { platform, message, title } = validation.data;
        const result = await publishContent(platform, message, title);

        if (!result.success) {
            return NextResponse.json(
                { success: false, message: result.error ?? 'Publish failed', platform },
                { status: 502 },
            );
        }

        return NextResponse.json({
            success: true,
            platform,
            postUrl: result.postUrl,
        });
    } catch (error) {
        console.error('[marketing-pipeline/publish] POST error:', error);
        return NextResponse.json(
            {
                success: false,
                message: 'Failed to publish content',
                error: 'Failed to publish content',
            },
            { status: 500 },
        );
    }
}
