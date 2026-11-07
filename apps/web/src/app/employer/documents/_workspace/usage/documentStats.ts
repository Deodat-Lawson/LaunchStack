/**
 * One document's opens, as the document sheet shows them
 * (`GET /api/company/documents/[documentId]/stats`). The Usage tab's
 * Documents screen opens the sheet from a `UsageDocumentRow`, which carries
 * every field of `DocumentStat`.
 */

export interface TrendDataPoint {
    date: string;
    count: number;
}

export interface DocumentStat {
    id: number;
    title: string;
    category: string;
    views: number;
    lastViewedAt: string | null;
    createdAt: string;
}

export interface Viewer {
    name: string;
    email: string;
    avatarUrl: string | null;
    viewedAt: string;
    role: string;
}

export interface DocumentDetails {
    id: number;
    title: string;
    category: string;
    createdAt: string;
    totalViews: number;
    uniqueViewers: number;
    recentViewers: Viewer[];
    viewsTrend: TrendDataPoint[];
}
