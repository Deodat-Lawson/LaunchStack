/**
 * Storage port — the boundary core uses to read and write document bytes.
 *
 * Concrete implementations (S3, Vercel Blob, Postgres base64) live in the
 * hosting app; core is handed one via CoreConfig.storage. Keeping this as a
 * port lets core stay unaware of AWS SDK, Vercel-specific types, and the
 * env vars that select a backend at runtime.
 */

export interface StoragePort {
  /** Store a new object. Returns the public URL (or /api/files/ id) and pathname. */
  upload(input: UploadInput): Promise<UploadResult>;

  /**
   * Fetch an object's bytes. Accepts either a URL returned by {@link upload}
   * or a raw key. Returns a fetch-style Response so callers can stream.
   */
  download(urlOrKey: string, init?: RequestInit): Promise<Response>;

  /** Delete an object, identified by URL or key. No-op if the object is gone. */
  delete(urlOrKey: string): Promise<void>;

  /** Identifier for the active backend (e.g. "s3", "database"). */
  readonly provider: string;
}

export interface UploadInput {
  filename: string;
  data: Buffer | ArrayBuffer | Uint8Array;
  contentType?: string;
  /** Optional — the userId the object is being uploaded on behalf of. */
  userId?: string;
}

export interface UploadResult {
  /** Canonical URL the app should store to fetch the object later. */
  url: string;
  /** Provider-specific object path/key. */
  pathname: string;
  contentType?: string;
  provider: string;
}
