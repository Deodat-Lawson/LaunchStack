/**
 * Storage port — the boundary core uses to read and write document bytes.
 *
 * Concrete implementations (S3, Vercel Blob, Postgres base64) live in the
 * hosting app; core is handed one via CoreConfig.storage. Keeping this as a
 * port lets core stay unaware of AWS SDK, Vercel-specific types, and the
 * env vars that select a backend at runtime.
 */

export type StorageAdapter =
  | "s3"
  | "database"
  | "vercel-blob"
  | "uploadthing";

export interface ObjectRef {
  /** Adapter/backend identifier that owns this object. */
  readonly adapter: StorageAdapter;
  /** Stable identifier for the configured location/tenant within an adapter. */
  readonly storageLocationId: string;
  /** Provider-native object key/path (or synthetic id for DB-backed objects). */
  readonly key: string;
}

export type DeleteOutcome = "deleted" | "not_found" | "blocked" | "retryable" | "rejected";

export interface DeleteResult {
  ref: ObjectRef;
  outcome: DeleteOutcome;
  /** Provider/error-family code for non-success outcomes. */
  errorCode?: string;
  /** Human-readable detail for non-success outcomes. */
  message?: string;
}

export interface StoragePort {
  /** Store a new object. Returns the public URL (or /api/files/ id) and pathname. */
  upload(input: UploadInput): Promise<UploadResult>;

  /**
   * Fetch an object's bytes. Accepts either a URL returned by {@link upload}
   * or a raw key. Returns a fetch-style Response so callers can stream.
   */
  download(urlOrKey: string, init?: RequestInit): Promise<Response>;

<<<<<<< HEAD
  /** Delete an object by canonical reference with a stable per-item outcome. */
  deleteRef(ref: ObjectRef): Promise<DeleteResult>;

  /** Batch delete canonical refs, preserving one outcome per requested ref. */
  deleteMany(refs: readonly ObjectRef[]): Promise<DeleteResult[]>;

  /**
   * @deprecated URL/key delete shim kept only for migration. New code must use
   * `deleteRef` / `deleteMany` and avoid URL parsing outside legacy promotion.
=======
  /** Delete an object by its provider-owned opaque identity. */
  deleteRef(ref: ObjectRef): Promise<DeleteResult>;

  /** Delete multiple objects by provider-owned opaque identity. */
  deleteMany(refs: readonly ObjectRef[]): Promise<DeleteResult[]>;

  /**
   * Deprecated URL/key compatibility shim.
   *
   * New callers must use {@link deleteRef}. URL promotion belongs in the
   * hosting adapter, not in core.
>>>>>>> 4e365dff2f6519db028a2c29e80a4de5c898f4f4
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
<<<<<<< HEAD
  /** Canonical object reference. Required for every successful upload. */
=======
  /** Provider-owned identity minted by the adapter at upload time. */
>>>>>>> 4e365dff2f6519db028a2c29e80a4de5c898f4f4
  ref: ObjectRef;
  contentType?: string;
  provider: string;
}
