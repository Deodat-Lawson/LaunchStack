import {
    generateUploadButton,
    generateUploadDropzone,
} from "@uploadthing/react";

import type { FileRouter } from "uploadthing/next";

type ClientFileRouter = FileRouter;

export const UploadButton = generateUploadButton<ClientFileRouter>();
export const UploadDropzone = generateUploadDropzone<ClientFileRouter>();
