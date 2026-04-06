/**
 * Inngest GitHub Repository Ingestion Function
 *
 * Fetches a public GitHub repo's contents, groups files into logical
 * documents, stores them in Vercel Blob, and dispatches processing
 * events to the existing ingestion pipeline.
 */

import { inngest } from "../client";
import { db } from "~/server/db";
import { document, ocrJobs } from "~/server/db/schema";
import { putFile } from "~/server/storage/vercel-blob";
import {
  fetchGitHubRepo,
  parseGitHubUrl,
  type RepoFile,
} from "~/lib/ingestion/services/github-repo";
import { triggerDocumentProcessing } from "~/lib/ocr/trigger";

const MAX_DOC_CHARS = 80_000;

export const ingestGitHubRepoJob = inngest.createFunction(
  {
    id: "ingest-github-repo",
    name: "Ingest GitHub Repository",
    concurrency: { limit: 3 },
    retries: 1,
  },
  { event: "github/ingest.requested" },
  async ({ event, step }) => {
    const {
      repoUrl,
      owner,
      repo,
      branch,
      path,
      includeCode,
      companyId,
      userId,
      category,
    } = event.data;

    console.log(
      `[IngestGitHub] Starting: ${owner}/${repo}, branch=${branch ?? "default"}, includeCode=${includeCode}`,
    );

    const fetchResult = await step.run("fetch-repo", async () => {
      const result = await fetchGitHubRepo(
        { owner, repo, branch, path },
        { includeCode },
      );
      return {
        branch: result.branch,
        description: result.description,
        fileCount: result.files.length,
        totalFilesInRepo: result.totalFilesInRepo,
        skippedFiles: result.skippedFiles,
        elapsedMs: result.elapsedMs,
        errors: result.errors,
      };
    });

    if (fetchResult.fileCount === 0) {
      console.warn(`[IngestGitHub] No files fetched from ${owner}/${repo}`);
      return { success: false, error: "No processable files found in repository", documentIds: [] };
    }

    const fullResult = await fetchGitHubRepo(
      { owner, repo, branch, path },
      { includeCode },
    );

    const groups = groupFiles(fullResult.files, owner, repo);
    const documentIds: number[] = [];

    for (let i = 0; i < groups.length; i++) {
      const group = groups[i]!;

      const docResult = await step.run(`create-doc-${i}`, async () => {
        const contentBuffer = Buffer.from(group.content, "utf-8");
        const blob = await putFile({
          filename: `github-${owner}-${repo}-${group.name}.txt`,
          data: contentBuffer,
          contentType: "text/plain",
        });

        const companyIdBigInt = BigInt(companyId);
        const [newDocument] = await db
          .insert(document)
          .values({
            url: blob.url,
            title: group.title,
            mimeType: "text/x-github-repo",
            category,
            companyId: companyIdBigInt,
            ocrEnabled: true,
            ocrProcessed: false,
            sourceArchiveName: `${owner}/${repo}`,
            ocrMetadata: {
              repoUrl,
              owner,
              repo,
              branch: fullResult.branch,
              description: fullResult.description,
              fileCount: group.fileCount,
              groupType: group.type,
            },
          } as typeof document.$inferInsert)
          .returning({ id: document.id });

        if (!newDocument) {
          throw new Error(`Failed to create document for ${group.title}`);
        }

        const { jobId } = await triggerDocumentProcessing(
          blob.url,
          group.title,
          companyId,
          userId,
          newDocument.id,
          category,
          {
            mimeType: "text/x-github-repo",
            originalFilename: `${group.name}.md`,
          },
        );

        await db.insert(ocrJobs).values({
          id: jobId,
          companyId: companyIdBigInt,
          userId,
          status: "queued",
          documentUrl: blob.url,
          documentName: group.title,
        });

        return { documentId: newDocument.id, jobId };
      });

      documentIds.push(docResult.documentId);
    }

    console.log(
      `[IngestGitHub] Done: ${documentIds.length} documents created from ${owner}/${repo}`,
    );

    return {
      success: true,
      documentIds,
      filesProcessed: fullResult.files.length,
      documentsCreated: documentIds.length,
      errors: fullResult.errors,
    };
  },
);

interface FileGroup {
  name: string;
  title: string;
  type: "docs" | "code" | "config";
  content: string;
  fileCount: number;
}

function groupFiles(
  files: RepoFile[],
  owner: string,
  repo: string,
): FileGroup[] {
  const groups: FileGroup[] = [];

  const docs = files.filter((f) => f.type === "doc");
  const configs = files.filter((f) => f.type === "config");
  const code = files.filter((f) => f.type === "code");

  if (docs.length > 0) {
    const docGroups = buildContentGroups(docs, "docs", owner, repo);
    groups.push(...docGroups);
  }

  if (configs.length > 0) {
    const content = formatFileGroup(configs, owner, repo);
    if (content.length > 0) {
      groups.push({
        name: "config",
        title: `${owner}/${repo} - Configuration Files`,
        type: "config",
        content,
        fileCount: configs.length,
      });
    }
  }

  if (code.length > 0) {
    const codeGroups = buildContentGroups(code, "code", owner, repo);
    groups.push(...codeGroups);
  }

  return groups;
}

function buildContentGroups(
  files: RepoFile[],
  type: "docs" | "code",
  owner: string,
  repo: string,
): FileGroup[] {
  const groups: FileGroup[] = [];
  let currentFiles: RepoFile[] = [];
  let currentSize = 0;
  let groupIndex = 0;

  for (const file of files) {
    if (currentSize + file.content.length > MAX_DOC_CHARS && currentFiles.length > 0) {
      groups.push(createGroup(currentFiles, type, owner, repo, groupIndex));
      groupIndex++;
      currentFiles = [];
      currentSize = 0;
    }
    currentFiles.push(file);
    currentSize += file.content.length;
  }

  if (currentFiles.length > 0) {
    groups.push(createGroup(currentFiles, type, owner, repo, groupIndex));
  }

  return groups;
}

function createGroup(
  files: RepoFile[],
  type: "docs" | "code",
  owner: string,
  repo: string,
  index: number,
): FileGroup {
  const label = type === "docs" ? "Documentation" : "Source Code";
  const suffix = index > 0 ? ` (Part ${index + 1})` : "";
  return {
    name: `${type}-${index}`,
    title: `${owner}/${repo} - ${label}${suffix}`,
    type,
    content: formatFileGroup(files, owner, repo),
    fileCount: files.length,
  };
}

function formatFileGroup(
  files: RepoFile[],
  owner: string,
  repo: string,
): string {
  const header = `# Repository: ${owner}/${repo}\n\n`;
  const fileContents = files.map((f) => {
    const ext = f.path.includes(".") ? f.path.slice(f.path.lastIndexOf(".") + 1) : "";
    return `## File: ${f.path}\n\n\`\`\`${ext}\n${f.content}\n\`\`\``;
  });
  return header + fileContents.join("\n\n---\n\n");
}
