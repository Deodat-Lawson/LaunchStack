/**
 * Content filter guardrail — detects PII and toxic content in agent outputs.
 */

const PII_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
    { name: 'SSN', pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
    { name: 'Credit Card', pattern: /\b(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6(?:011|5\d{2}))[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g },
    { name: 'Email', pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g },
    { name: 'Phone', pattern: /\b(?:\+1[- ]?)?\(?\d{3}\)?[- ]?\d{3}[- ]?\d{4}\b/g },
    { name: 'IP Address', pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
    { name: 'Bank Account', pattern: /\b\d{8,17}\b/g },
];

const TOXIC_PATTERNS = [
    /\b(?:kill|murder|harm|attack|destroy)\s+(?:yourself|himself|herself|themselves|people)\b/i,
    /\b(?:bomb|explosive|weapon)\s+(?:making|instructions|how\s+to)\b/i,
];

export type PIIDetection = {
    type: string;
    count: number;
    redacted: boolean;
};

export type ContentFilterResult = {
    passed: boolean;
    piiDetected: PIIDetection[];
    toxicContentDetected: boolean;
    filteredOutput?: string;
};

export function filterContent(text: string): ContentFilterResult {
    const piiDetected: PIIDetection[] = [];
    let filteredOutput = text;
    let hasPII = false;

    for (const { name, pattern } of PII_PATTERNS) {
        const resetPattern = new RegExp(pattern.source, pattern.flags);
        const matches = text.match(resetPattern);
        if (matches && matches.length > 0) {
            // Don't flag generic short number sequences that are likely page numbers or IDs
            if (name === 'Bank Account' || name === 'Phone') {
                const contextualMatches = matches.filter(m => {
                    const idx = text.indexOf(m);
                    const surrounding = text.slice(Math.max(0, idx - 30), idx + m.length + 30).toLowerCase();
                    return surrounding.includes('account') || surrounding.includes('phone') ||
                           surrounding.includes('call') || surrounding.includes('routing') ||
                           surrounding.includes('bank');
                });
                if (contextualMatches.length === 0) continue;
            }

            hasPII = true;
            piiDetected.push({ type: name, count: matches.length, redacted: true });
            filteredOutput = filteredOutput.replace(resetPattern, `[${name} REDACTED]`);
        }
    }

    let toxicContentDetected = false;
    for (const pattern of TOXIC_PATTERNS) {
        if (pattern.test(text)) {
            toxicContentDetected = true;
            break;
        }
    }

    return {
        passed: !hasPII && !toxicContentDetected,
        piiDetected,
        toxicContentDetected,
        filteredOutput: hasPII ? filteredOutput : undefined,
    };
}
