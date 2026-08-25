/**
 * Shared types for the provider abstraction layer.
 */

export interface ProviderUsage {
    tokensUsed: number;
    details: Record<string, number>; // e.g. { tokens: 1500, pages: 3 }
}

export interface ProviderResult<T> {
    data: T;
    usage: ProviderUsage;
}
