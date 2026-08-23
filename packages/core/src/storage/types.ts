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

export interface GetSignedUrlOptions {
  expiresIn?: number;
}

export interface TargetedStoragePort {
  /** Adapter/backend this handle is pinned to. */
  readonly adapter: StorageAdapter;
  /** Identifier for the active backend (e.g. "s3", "database"). */
  readonly provider: string;

  /** Store a new object using the explicitly targeted adapter. */
  put(input: UploadInput): Promise<UploadResult>;

  /** Fetch an object's bytes by canonical reference. */
  get(ref: ObjectRef, init?: RequestInit): Promise<Response>;

  /** Delete an object by canonical reference with a stable per-item outcome. */
  delete(ref: ObjectRef): Promise<DeleteResult>;

  /** Batch delete canonical refs, preserving one outcome per requested ref. */
  deleteMany(refs: readonly ObjectRef[]): Promise<DeleteResult[]>;

  /** Generate a signed or shareable URL for the adapter-owned object. */
  getSignedUrl(ref: ObjectRef, opts?: GetSignedUrlOptions): Promise<string>;
}

export interface StoragePort {
  /** Store a new object using the host's default storage backend. */
  put(input: UploadInput): Promise<UploadResult>;

  /** Fetch an object's bytes by canonical reference. */
  get(ref: ObjectRef, init?: RequestInit): Promise<Response>;

  /**
   * @deprecated Legacy URL/key read shim kept for migration. New code should
   * resolve a canonical ObjectRef and call {@link get}.
   */
  get(urlOrKey: string, init?: RequestInit): Promise<Response>;

  /** Delete an object by canonical reference with a stable per-item outcome. */
  delete(ref: ObjectRef): Promise<DeleteResult>;

  /**
   * @deprecated URL/key delete shim kept only for migration. New code must use
   * canonical ObjectRefs and avoid URL parsing outside legacy promotion.
   */
  delete(urlOrKey: string): Promise<void>;

  /** Batch delete canonical refs, preserving one outcome per requested ref. */
  deleteMany(refs: readonly ObjectRef[]): Promise<DeleteResult[]>;

  /** Generate a signed or shareable URL for the object. */
  getSignedUrl(ref: ObjectRef, opts?: GetSignedUrlOptions): Promise<string>;

  /** Pin a handle to one concrete adapter instead of the default backend. */
  forAdapter(adapter: StorageAdapter): TargetedStoragePort;

  /** Store a new object. Returns the public URL (or /api/files/ id) and pathname. */
  /** @deprecated Use {@link put}. */
  upload(input: UploadInput): Promise<UploadResult>;

  /**
   * Fetch an object's bytes. Accepts either a URL returned by {@link upload}
   * or a raw key. Returns a fetch-style Response so callers can stream.
   */
  /** @deprecated Use {@link get}. */
  download(urlOrKey: string, init?: RequestInit): Promise<Response>;

  /** Delete an object by canonical reference with a stable per-item outcome. */
  /** @deprecated Use {@link delete}. */
  deleteRef(ref: ObjectRef): Promise<DeleteResult>;

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
  /** Canonical object reference. Required for every successful upload. */
  ref: ObjectRef;
  contentType?: string;
  provider: string;
}
