export type {
	DeleteOutcome,
	DeleteResult,
	ObjectRef,
	StorageAdapter,
	StoragePort,
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
