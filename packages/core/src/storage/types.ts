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

  /** Delete an object by its provider-owned opaque identity. */
  deleteRef(ref: ObjectRef): Promise<DeleteResult>;

  /** Delete multiple objects by provider-owned opaque identity. */
  deleteMany(refs: readonly ObjectRef[]): Promise<DeleteResult[]>;

  /**
   * Deprecated URL/key compatibility shim.
   *
   * New callers must use {@link deleteRef}. URL promotion belongs in the
   * hosting adapter, not in core.
   */
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

/** Provider-owned, immutable storage identity. Callers must not parse URLs into refs. */
export interface ObjectRef {
  adapter: "s3" | "vercel-blob" | "database" | "uploadthing";
  storageLocationId: string;
  key: string;
}

export interface DeleteResult {
  ref: ObjectRef;
  outcome: "deleted" | "not_found" | "retryable" | "blocked" | "rejected";
  errorCode?: string;
  message?: string;
}

export interface UploadResult {
  /** Canonical URL the app should store to fetch the object later. */
  url: string;
  /** Provider-specific object path/key. */
  pathname: string;
  /** Provider-owned identity minted by the adapter at upload time. */
  ref: ObjectRef;
  contentType?: string;
  provider: string;
}
