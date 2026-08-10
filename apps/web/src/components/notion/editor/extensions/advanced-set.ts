/**
 * The structural blocks as one list, so `buildExtensions` stays readable.
 */

import type { Extensions } from "@tiptap/core";

import {
    BreadcrumbBlock,
    PageLink,
    SyncedBlock,
    TableOfContentsBlock,
    TemplateButton,
} from "./advanced";

export const advancedExtensions: Extensions = [
    PageLink,
    TableOfContentsBlock,
    BreadcrumbBlock,
    SyncedBlock,
    TemplateButton,
];
