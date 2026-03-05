import type { PdfChunk, DocumentInsight } from "~/app/api/agents/predictive-document-analysis/types";
import stringSimilarity from 'string-similarity-js';

// ---------------------------------------------------------------------------
// Layer 1 — Deterministic insight extraction (zero LLM cost)
// ---------------------------------------------------------------------------

// ── Document format detection ─────────────────────────────────

export type DocumentFormat = 'slides' | 'prose' | 'mixed';

export function detectDocumentFormat(chunks: PdfChunk[]): DocumentFormat {
    if (chunks.length === 0) return 'mixed';

    const totalChars = chunks.reduce((s, c) => s + (c.content?.length ?? 0), 0);
    const avgChunkLen = totalChars / chunks.length;
    const totalPages = new Set(chunks.map(c => c.page)).size;

    const bulletPattern = /[●•○◦▪▸▹►–—]\s|^\s*[-*]\s/m;
    const bulletChunks = chunks.filter(c => bulletPattern.test(c.content ?? ''));
    const bulletRatio = bulletChunks.length / chunks.length;

    if (avgChunkLen < 500 && totalPages > 15 && bulletRatio > 0.25) return 'slides';
    if (avgChunkLen > 1200 && bulletRatio < 0.15) return 'prose';
    return 'mixed';
}

// ── Sentence boundary helper ──────────────────────────────────

function extractSurroundingSentence(text: string, matchIndex: number, matchLength: number): string {
    const sentenceBreak = /[.!?]\s+|[\n\r]{2,}/;

    let start = matchIndex;
    const searchBack = text.slice(Math.max(0, matchIndex - 300), matchIndex);
    const backParts = searchBack.split(sentenceBreak);
    if (backParts.length > 1) {
        start = matchIndex - (backParts[backParts.length - 1]?.length ?? 0);
    } else {
        start = Math.max(0, matchIndex - 300);
    }

    let end = matchIndex + matchLength;
    const searchForward = text.slice(end, end + 300);
    const fwdMatch = searchForward.match(sentenceBreak);
    if (fwdMatch?.index !== undefined) {
        end = end + fwdMatch.index + fwdMatch[0].length;
    } else {
        end = Math.min(text.length, end + 300);
    }

    return text.slice(start, end).trim();
}

// ── extractDeadlines ──────────────────────────────────────────

const DEADLINE_PATTERNS = [
    /\b(?:due|deadline)\s*(?:on|by|:)?\s*(.{3,40}?\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b[^.!?\n]{0,30})/gi,
    /\b(?:due|deadline)\s*(?:on|by|:)?\s*(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)/gi,
    /\b(?:submit|turn\s*in|hand\s*in)\s+(?:by|before)\s+(.{3,60})/gi,
    /\b(homework\s+\d+[^.!?\n]{0,60}(?:due|deadline)[^.!?\n]{0,40})/gi,
    /\b(assignment\s+\d+[^.!?\n]{0,60}(?:due|deadline)[^.!?\n]{0,40})/gi,
    /\b(?:homework|assignment|project|paper|essay|lab)\s+\d*\s*(?:is\s+)?due\b[^.!?\n]{0,60}/gi,
    /\b(?:quiz|exam|test|midterm|final)\s+(?:on|:)\s*(.{3,60})/gi,
    /\b(midterm|final\s+exam|final\s+project)[^.!?\n]{0,80}/gi,
];

export function extractDeadlines(chunks: PdfChunk[]): DocumentInsight[] {
    const seen = new Set<string>();
    const results: DocumentInsight[] = [];

    for (const chunk of chunks) {
        const text = chunk.content ?? '';
        if (!text) continue;

        for (const pattern of DEADLINE_PATTERNS) {
            pattern.lastIndex = 0;
            let match: RegExpExecArray | null;
            while ((match = pattern.exec(text)) !== null) {
                const matchedText = match[0].trim();
                const normalizedKey = matchedText.toLowerCase().replace(/\s+/g, ' ').slice(0, 60);
                if (seen.has(normalizedKey)) continue;
                seen.add(normalizedKey);

                const sentence = extractSurroundingSentence(text, match.index, match[0].length);
                const title = matchedText.length > 60
                    ? matchedText.slice(0, 57) + '...'
                    : matchedText;

                results.push({
                    category: 'deadline',
                    severity: 'warning',
                    title,
                    detail: sentence,
                    page: chunk.page,
                    sourceQuote: matchedText,
                    date: match[1]?.trim(),
                });
            }
        }
    }

    return results;
}

// ── extractRecurringReferences (rewritten with anti-header heuristics) ─────

const CAPITALIZED_PHRASE = /(?:[A-Z][a-zA-Z]+(?:'s)?(?:[\s,&]+|[-])){1,4}[A-Z][a-zA-Z]+/g;
const QUOTED_TITLE = /"([^"]{5,80})"/g;

const STOPLIST = new Set([
    'the', 'this', 'that', 'these', 'those', 'page', 'slide',
    'please', 'note', 'see', 'also', 'section', 'chapter',
    'figure', 'table', 'part', 'item', 'class', 'lecture',
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday',
    'saturday', 'sunday', 'january', 'february', 'march', 'april',
    'may', 'june', 'july', 'august', 'september', 'october',
    'november', 'december', 'spring', 'fall', 'summer', 'winter',
    'common', 'design', 'overview', 'introduction', 'review',
    'summary', 'conclusion', 'questions', 'discussion', 'agenda',
    'outline', 'objectives', 'learning', 'today', 'next',
    'evaluation', 'prototype', 'prototyping', 'testing',
    'analysis', 'methodology', 'framework', 'approach',
    'project', 'assignment', 'activity', 'exercise',
    'high', 'low', 'mid', 'fidelity',
]);

function isStopPhrase(phrase: string): boolean {
    const words = phrase.toLowerCase().split(/\s+/);
    if (words.length < 2) return true;
    if (words.every(w => STOPLIST.has(w))) return true;
    if (words.length === 2 && words.some(w => STOPLIST.has(w ?? ''))) return true;
    if (words[0] && STOPLIST.has(words[0]) && words.length <= 3) return true;
    if (/^(In|On|At|By|For|To|The|This|That|If|As|Or|An?|What|Why|How|When|Where)\s/i.test(phrase)) return true;
    return false;
}

type PhraseInfo = {
    phrase: string;
    pages: Set<number>;
    firstPage: number;
    contexts: string[];
};

function computeMaxGap(pages: Set<number>): number {
    const sorted = [...pages].sort((a, b) => a - b);
    let maxGap = 0;
    for (let i = 1; i < sorted.length; i++) {
        maxGap = Math.max(maxGap, (sorted[i] ?? 0) - (sorted[i - 1] ?? 0));
    }
    return maxGap;
}

function contextsAreDiverse(contexts: string[], threshold = 0.8): boolean {
    if (contexts.length <= 1) return false;
    for (let i = 1; i < contexts.length; i++) {
        const sim = stringSimilarity(
            (contexts[0] ?? '').toLowerCase().slice(0, 200),
            (contexts[i] ?? '').toLowerCase().slice(0, 200),
        );
        if (sim < threshold) return true;
    }
    return false;
}

export function extractRecurringReferences(
    chunks: PdfChunk[],
    format: DocumentFormat = 'mixed',
): DocumentInsight[] {
    const sectionHeaders = new Set<string>();
    for (const chunk of chunks) {
        if (chunk.sectionHeading) {
            sectionHeaders.add(chunk.sectionHeading.toLowerCase().replace(/\s+/g, ' ').trim());
        }
    }

    const frequencyMap = new Map<string, PhraseInfo>();

    for (const chunk of chunks) {
        const text = chunk.content ?? '';
        if (!text) continue;

        const phrases: string[] = [];

        CAPITALIZED_PHRASE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = CAPITALIZED_PHRASE.exec(text)) !== null) {
            phrases.push(m[0].trim());
        }

        QUOTED_TITLE.lastIndex = 0;
        while ((m = QUOTED_TITLE.exec(text)) !== null) {
            if (m[1]) phrases.push(m[1].trim());
        }

        for (const raw of phrases) {
            if (isStopPhrase(raw)) continue;

            const key = raw.toLowerCase().replace(/\s+/g, ' ');

            let matchesHeader = false;
            for (const header of sectionHeaders) {
                if (stringSimilarity(key, header) > 0.7 || header.includes(key) || key.includes(header)) {
                    matchesHeader = true;
                    break;
                }
            }
            if (matchesHeader) continue;

            const existing = frequencyMap.get(key);
            if (existing) {
                existing.pages.add(chunk.page);
                if (existing.contexts.length < 4) {
                    const idx = text.indexOf(raw);
                    if (idx >= 0) {
                        existing.contexts.push(extractSurroundingSentence(text, idx, raw.length));
                    }
                }
            } else {
                const idx = text.indexOf(raw);
                const context = idx >= 0
                    ? extractSurroundingSentence(text, idx, raw.length)
                    : raw;

                frequencyMap.set(key, {
                    phrase: raw,
                    pages: new Set([chunk.page]),
                    firstPage: chunk.page,
                    contexts: [context],
                });
            }
        }
    }

    const minPages = format === 'slides' ? 5 : 3;
    const minGap = format === 'slides' ? 10 : 3;

    const allPages = new Set(chunks.map(c => c.page));
    const totalPageCount = allPages.size;
    const firstPageContent = chunks
        .filter(c => c.page === Math.min(...allPages))
        .map(c => (c.content ?? '').toLowerCase())
        .join(' ');

    const recurring = [...frequencyMap.values()]
        .filter(info => {
            if (info.pages.size < minPages) return false;
            if (computeMaxGap(info.pages) < minGap) return false;
            if (!contextsAreDiverse(info.contexts)) return false;

            const key = info.phrase.toLowerCase().replace(/\s+/g, ' ');
            if (firstPageContent.includes(key) && info.pages.size / totalPageCount > 0.08) {
                return false;
            }
            return true;
        })
        .sort((a, b) => b.pages.size - a.pages.size)
        .slice(0, 5);

    return recurring.map(info => ({
        category: 'key-reference' as const,
        severity: 'note' as const,
        title: info.phrase,
        detail: `Referenced on ${info.pages.size} pages (${[...info.pages].sort((a, b) => a - b).join(', ')})`,
        page: info.firstPage,
        sourceQuote: info.contexts[0]
            ? (info.contexts[0].length > 200 ? info.contexts[0].slice(0, 197) + '...' : info.contexts[0])
            : undefined,
    }));
}

// ── extractResourceSuggestions ─────────────────────────────────

const URL_REGEX = /https?:\/\/[^\s<>"')\]},]+/gi;

const VIDEO_DOMAINS = new Set([
    'youtube.com', 'youtu.be', 'vimeo.com', 'dailymotion.com',
    'twitch.tv', 'wistia.com', 'loom.com',
]);

const RESOURCE_ACTION_RE = /\b(?:watch|view|see|check\s*out|review|read|visit|explore|look\s*at|refer\s*to|go\s*to)\b/i;
const RESOURCE_FRAMING_RE = /\b(?:recommended|suggested|required|optional|useful|helpful|important|reference|supplementary|additional)\s+(?:reading|viewing|video|resource|material|link)/i;

function isVideoDomain(hostname: string): boolean {
    const cleaned = hostname.replace(/^www\./, '');
    return VIDEO_DOMAINS.has(cleaned);
}

const TRAILING_JUNK_RE = /\s+(?:et|and|or|the|a|an|in|on|of|for|by|to|at|is|are|was|with|from)\s*$/i;

function cleanSnippet(words: string[], maxWords: number): string {
    let snippet = words.slice(0, maxWords).join(' ');
    snippet = snippet.replace(TRAILING_JUNK_RE, '');
    if (snippet.length < 4 && words.length > maxWords) {
        snippet = words.slice(0, maxWords + 2).join(' ').replace(TRAILING_JUNK_RE, '');
    }
    return snippet;
}

function buildResourceTitle(url: string, context: string, hostname: string): string {
    if (isVideoDomain(hostname)) {
        const contextClean = context.replace(/https?:\/\/[^\s]+/g, '').trim();
        const words = contextClean.split(/\s+/).filter(w => w.length > 1 && !/^[●•○▪►–—*]$/.test(w));
        const snippet = cleanSnippet(words, 6);
        if (snippet.length > 5) return `Watch: ${snippet}`;
        return `Watch: Video on ${hostname.replace(/^www\./, '')}`;
    }

    const actionMatch = context.match(RESOURCE_ACTION_RE);
    if (actionMatch) {
        const afterAction = context.slice((actionMatch.index ?? 0) + actionMatch[0].length).trim();
        const clean = afterAction.replace(/https?:\/\/[^\s]+/g, '').trim();
        const words = clean.split(/\s+/).filter(w => w.length > 1);
        const snippet = cleanSnippet(words, 6);
        if (snippet.length > 5) {
            const verb = actionMatch[0].charAt(0).toUpperCase() + actionMatch[0].slice(1).toLowerCase();
            return `${verb}: ${snippet}`;
        }
    }

    const domain = hostname.replace(/^www\./, '');
    try {
        const parsed = new URL(url);
        const path = parsed.pathname.replace(/\/+$/, '');
        if (path && path !== '/') {
            const pathSnippet = path.length > 30 ? path.slice(0, 27) + '...' : path;
            return `Resource: ${domain}${pathSnippet}`;
        }
    } catch { /* skip */ }

    return `Resource: ${domain}`;
}

export function extractResourceSuggestions(chunks: PdfChunk[]): DocumentInsight[] {
    const seen = new Set<string>();
    const results: DocumentInsight[] = [];

    for (const chunk of chunks) {
        const text = chunk.content ?? '';
        if (!text) continue;

        URL_REGEX.lastIndex = 0;
        let urlMatch: RegExpExecArray | null;
        while ((urlMatch = URL_REGEX.exec(text)) !== null) {
            const rawUrl = urlMatch[0].replace(/[.,;:!?)]+$/, '');
            if (seen.has(rawUrl)) continue;
            seen.add(rawUrl);

            let hostname: string;
            try {
                hostname = new URL(rawUrl).hostname;
            } catch {
                continue;
            }

            const contextStart = Math.max(0, urlMatch.index - 200);
            const contextEnd = Math.min(text.length, urlMatch.index + urlMatch[0].length + 200);
            const contextWindow = text.slice(contextStart, contextEnd);

            const hasActionVerb = RESOURCE_ACTION_RE.test(contextWindow);
            const hasFraming = RESOURCE_FRAMING_RE.test(contextWindow);
            const isVideo = isVideoDomain(hostname);

            if (!hasActionVerb && !hasFraming && !isVideo) continue;

            const sentence = extractSurroundingSentence(text, urlMatch.index, urlMatch[0].length);
            const title = buildResourceTitle(rawUrl, contextWindow, hostname);

            results.push({
                category: 'resource',
                severity: 'note',
                title,
                detail: sentence.replace(/https?:\/\/[^\s]+/g, '').trim() || `Resource linked on page ${chunk.page}`,
                page: chunk.page,
                url: rawUrl,
                sourceQuote: sentence.length > 200 ? sentence.slice(0, 197) + '...' : sentence,
            });
        }
    }

    return results;
}

// ── extractActionItems ────────────────────────────────────────

const ASSIGNMENT_PATTERNS = [
    /\b(entrance\s+ticket\s*\d*)[^.!?\n]{0,80}/gi,
    /\b(activity\s+\d+)[^.!?\n]{0,80}/gi,
    /\b(exercise\s+\d+)[^.!?\n]{0,80}/gi,
    /\b(lab\s+\d+)[^.!?\n]{0,80}/gi,
    /\b(homework\s+\d+)(?!\s*(?:is\s+)?due)[^.!?\n]{0,80}/gi,
    /\b(quiz\s+\d+)(?!\s+on)[^.!?\n]{0,80}/gi,
    /\b(project\s+\d+)[^.!?\n]{0,80}/gi,
];

const PLATFORM_TASK_RE = /\b(?:post|submit|upload|share|register|sign\s*up|enroll|respond|reply|introduce\s+yourself|self[- ]?intro(?:duction)?)\s+(?:on|to|via|at|in|through)\s+(canvas|courselore|piazza|blackboard|moodle|teams|slack|gradescope|sakai|brightspace|discord|github|google\s*(?:classroom|drive|docs|forms))[^.!?\n]{0,60}/gi;

const IMPERATIVE_RE = /^(?:complete|prepare|bring|create|write|read|review|finish|attend|watch|sign\s*up\s+for|set\s*up|make\s*sure|don'?t\s+forget|remember\s+to)\s+[^.!?\n]{5,80}/gim;

const URGENCY_RE = /\b(?:before\s+(?:next|class|lecture|lab|section)|by\s+(?:end\s+of|next|tomorrow|monday|tuesday|wednesday|thursday|friday)|asap|immediately|today|tonight)\b/i;

export function extractActionItems(chunks: PdfChunk[]): DocumentInsight[] {
    const seen = new Set<string>();
    const results: DocumentInsight[] = [];

    function addResult(matchedText: string, text: string, matchIndex: number, matchLength: number, page: number) {
        const normalizedKey = matchedText.toLowerCase().replace(/\s+/g, ' ').slice(0, 60);
        if (seen.has(normalizedKey)) return;
        seen.add(normalizedKey);

        const sentence = extractSurroundingSentence(text, matchIndex, matchLength);
        const title = matchedText.length > 60
            ? matchedText.slice(0, 57) + '...'
            : matchedText;

        const isUrgent = URGENCY_RE.test(sentence);

        results.push({
            category: 'action-item',
            severity: isUrgent ? 'warning' : 'note',
            title,
            detail: sentence,
            page,
            sourceQuote: matchedText,
        });
    }

    for (const chunk of chunks) {
        const text = chunk.content ?? '';
        if (!text) continue;

        for (const pattern of ASSIGNMENT_PATTERNS) {
            pattern.lastIndex = 0;
            let match: RegExpExecArray | null;
            while ((match = pattern.exec(text)) !== null) {
                addResult(match[0].trim(), text, match.index, match[0].length, chunk.page);
            }
        }

        PLATFORM_TASK_RE.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = PLATFORM_TASK_RE.exec(text)) !== null) {
            addResult(match[0].trim(), text, match.index, match[0].length, chunk.page);
        }

        IMPERATIVE_RE.lastIndex = 0;
        while ((match = IMPERATIVE_RE.exec(text)) !== null) {
            addResult(match[0].trim(), text, match.index, match[0].length, chunk.page);
        }
    }

    return results;
}

// ── extractCaveats ────────────────────────────────────────────

const CAVEAT_PATTERNS: Array<{ pattern: RegExp; severity: 'warning' | 'note' }> = [
    { pattern: /\b(academic\s+integrity\s*(?:code|policy|violation)?)[^.!?\n]{0,100}/gi, severity: 'warning' },
    { pattern: /\b(plagiarism\s+(?:policy|will|is|results?)[^.!?\n]{0,80})/gi, severity: 'warning' },
    { pattern: /\b(honor\s+code)[^.!?\n]{0,80}/gi, severity: 'warning' },
    { pattern: /\b(zero\s+tolerance)[^.!?\n]{0,80}/gi, severity: 'warning' },
    { pattern: /\b(will\s+result\s+in\s+(?:a\s+)?(?:failing|zero|grade\s+of|expulsion|suspension|penalty))[^.!?\n]{0,60}/gi, severity: 'warning' },
    { pattern: /\b(generative\s+AI|ChatGPT|AI[- ]?(?:generated|policy|use|tools?))\b[^.!?\n]{0,100}/gi, severity: 'note' },
    { pattern: /\b((?:is|are)\s+(?:prohibited|not\s+allowed|strictly\s+forbidden|not\s+permitted))[^.!?\n]{0,80}/gi, severity: 'warning' },
    { pattern: /\b((?:required|mandatory|prerequisite|must\s+(?:complete|attend|submit|bring|have)))[^.!?\n]{0,80}/gi, severity: 'note' },
    { pattern: /\b(late\s+(?:penalty|submission|work|assignments?)\s*(?:policy|will|:)?)[^.!?\n]{0,80}/gi, severity: 'warning' },
    { pattern: /\b(attendance\s+(?:policy|is\s+(?:required|mandatory)))[^.!?\n]{0,80}/gi, severity: 'note' },
];

export function extractCaveats(chunks: PdfChunk[]): DocumentInsight[] {
    const seen = new Set<string>();
    const pagePatternCount = new Map<string, number>();
    const results: DocumentInsight[] = [];

    for (const chunk of chunks) {
        const text = chunk.content ?? '';
        if (!text) continue;

        for (let pi = 0; pi < CAVEAT_PATTERNS.length; pi++) {
            const { pattern, severity } = CAVEAT_PATTERNS[pi]!;
            const pagePatternKey = `${chunk.page}:${pi}`;
            const hitCount = pagePatternCount.get(pagePatternKey) ?? 0;
            if (hitCount >= 1) continue;

            pattern.lastIndex = 0;
            let match: RegExpExecArray | null;
            while ((match = pattern.exec(text)) !== null) {
                if ((pagePatternCount.get(pagePatternKey) ?? 0) >= 1) break;

                const matchedText = match[0].trim();
                const normalizedKey = matchedText.toLowerCase().replace(/\s+/g, ' ').slice(0, 60);
                if (seen.has(normalizedKey)) continue;

                let tooSimilar = false;
                for (const existing of results) {
                    if (existing.page === chunk.page &&
                        stringSimilarity(normalizedKey, existing.title.toLowerCase().slice(0, 60)) > 0.4) {
                        tooSimilar = true;
                        break;
                    }
                }
                if (tooSimilar) continue;

                seen.add(normalizedKey);
                pagePatternCount.set(pagePatternKey, (pagePatternCount.get(pagePatternKey) ?? 0) + 1);

                const sentence = extractSurroundingSentence(text, match.index, match[0].length);
                const title = matchedText.length > 60
                    ? matchedText.slice(0, 57) + '...'
                    : matchedText;

                results.push({
                    category: 'caveat',
                    severity,
                    title,
                    detail: sentence,
                    page: chunk.page,
                    sourceQuote: matchedText,
                });
            }
        }
    }

    return results;
}

// ── Combined deterministic extraction ─────────────────────────

export function extractDeterministicInsights(chunks: PdfChunk[]): DocumentInsight[] {
    const format = detectDocumentFormat(chunks);
    return [
        ...extractDeadlines(chunks),
        ...extractResourceSuggestions(chunks),
        ...extractActionItems(chunks),
        ...extractCaveats(chunks),
        ...extractRecurringReferences(chunks, format),
    ];
}
