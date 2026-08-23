export type {
	DeleteOutcome,
	DeleteResult,
	GetSignedUrlOptions,
	ObjectRef,
	StorageAdapter,
	StoragePort,
	TargetedStoragePort,
	UploadInput,
	UploadResult,
} from "./types";
export { configureStorage, getStoragePort } from "./slot";
export type {
	CreateInMemoryStoragePortOptions,
	InMemoryStoragePort,
	InMemoryStoredObject,
} from "./memory";
export { createInMemoryStoragePort } from "./memory";
