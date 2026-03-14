/**
 * Slack webhook integration — sends notifications when predictive analysis
 * finds critical (high-priority) missing documents.
 */

export type SlackNotificationPayload = {
    documentTitle: string;
    analysisType: string;
    highPriorityCount: number;
    totalMissing: number;
    topIssues: Array<{
        name: string;
        priority: string;
        reason: string;
    }>;
    documentUrl?: string;
};

type SlackBlock =
    | { type: 'header'; text: { type: 'plain_text'; text: string } }
    | { type: 'section'; text: { type: 'mrkdwn'; text: string } }
    | { type: 'divider' }
    | { type: 'context'; elements: Array<{ type: 'mrkdwn'; text: string }> };

function buildSlackBlocks(payload: SlackNotificationPayload): SlackBlock[] {
    const blocks: SlackBlock[] = [
        {
            type: 'header',
            text: {
                type: 'plain_text',
                text: `Document Analysis Alert: ${payload.documentTitle}`,
            },
        },
        {
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `*${payload.highPriorityCount} high-priority* issue${payload.highPriorityCount !== 1 ? 's' : ''} found in *${payload.documentTitle}*\nAnalysis type: \`${payload.analysisType}\` | Total missing: ${payload.totalMissing}`,
            },
        },
        { type: 'divider' },
    ];

    for (const issue of payload.topIssues.slice(0, 5)) {
        const priorityEmoji = issue.priority === 'high' ? ':red_circle:' : ':large_orange_circle:';
        blocks.push({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `${priorityEmoji} *${issue.name}*\n${issue.reason}`,
            },
        });
    }

    if (payload.documentUrl) {
        blocks.push({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `<${payload.documentUrl}|View Document>`,
            },
        });
    }

    blocks.push({
        type: 'context',
        elements: [
            {
                type: 'mrkdwn',
                text: `Sent by Launchstack Predictive Analysis | ${new Date().toISOString()}`,
            },
        ],
    });

    return blocks;
}

/**
 * Send a Slack notification via incoming webhook.
 * Returns true on success, false on failure (never throws).
 */
export async function sendSlackNotification(
    payload: SlackNotificationPayload,
    webhookUrl?: string,
): Promise<boolean> {
    const url = webhookUrl ?? process.env.SLACK_WEBHOOK_URL;
    if (!url) {
        console.warn('[Slack] No webhook URL configured — skipping notification');
        return false;
    }

    try {
        const blocks = buildSlackBlocks(payload);
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: `Launchstack: ${payload.highPriorityCount} high-priority issues found in "${payload.documentTitle}"`,
                blocks,
            }),
        });

        if (!response.ok) {
            console.error(`[Slack] Webhook failed: ${response.status} ${response.statusText}`);
            return false;
        }

        return true;
    } catch (error) {
        console.error('[Slack] Notification error:', error);
        return false;
    }
}

/**
 * Convenience: check analysis results and send a Slack alert
 * if any high-priority missing documents were found.
 */
export async function notifyOnCriticalFindings(
    documentTitle: string,
    analysisType: string,
    missingDocuments: Array<{ documentName: string; priority: string; reason: string }>,
    documentUrl?: string,
): Promise<boolean> {
    const highPriority = missingDocuments.filter(d => d.priority === 'high');
    if (highPriority.length === 0) return false;

    return sendSlackNotification({
        documentTitle,
        analysisType,
        highPriorityCount: highPriority.length,
        totalMissing: missingDocuments.length,
        topIssues: highPriority.slice(0, 5).map(d => ({
            name: d.documentName,
            priority: d.priority,
            reason: d.reason,
        })),
        documentUrl,
    });
}
