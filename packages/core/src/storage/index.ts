export type {
<<<<<<< HEAD
	DeleteOutcome,
	DeleteResult,
	ObjectRef,
	StorageAdapter,
	StoragePort,
	UploadInput,
	UploadResult,
=======
  DeleteResult,
  ObjectRef,
  StoragePort,
  UploadInput,
  UploadResult,
>>>>>>> 4e365dff2f6519db028a2c29e80a4de5c898f4f4
} from "./types";
export { configureStorage, getStoragePort } from "./slot";
export type {
	CreateInMemoryStoragePortOptions,
	InMemoryStoragePort,
	InMemoryStoredObject,
} from "./memory";
export { createInMemoryStoragePort } from "./memory";
