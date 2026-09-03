export declare class UnsubscribeSecretMissingError extends Error {
    constructor();
}
export interface UnsubscribeClaims {
    companyId: number;
    email: string;
}
/**
 * Mint a token for one address of one company. The address is lower-cased
 * first so the token matches the form the suppression list stores.
 */
export declare function createUnsubscribeToken(claims: UnsubscribeClaims, env?: Record<string, string | undefined>): string;
/**
 * Verify a token and return what it authorises, or null if it was not issued
 * by us. Comparison is constant-time so a caller cannot search for a valid
 * signature a byte at a time.
 */
export declare function verifyUnsubscribeToken(token: string, env?: Record<string, string | undefined>): UnsubscribeClaims | null;
//# sourceMappingURL=unsubscribe-token.d.ts.map