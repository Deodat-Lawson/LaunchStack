/** Connection config for the engine's Postgres pool — the `db` slice of the engine config. */
export interface DbConfig {
    /** Postgres connection string (DATABASE_URL shape). */
    url: string;
    /** Max concurrent connections per pool. Defaults to 10. */
    maxConnections?: number;
}
