import { experimentalEmbedDocument } from "~/lib/embeddings/experimental/pipeline";

async function main() {
  const docArg = process.argv.find((arg) => arg.startsWith("--documentId="));
  if (!docArg) {
    console.error("Usage: pnpm tsx scripts/experimental/embed-document.ts --documentId=123");
    process.exit(1);
  }
  const documentId = Number(docArg.split("=")[1]);
  if (!Number.isInteger(documentId)) {
    console.error("documentId must be an integer");
    process.exit(1);
  }

  const result = await experimentalEmbedDocument({ documentId });
  console.log(
    `[experimental-embeddings] Document ${documentId} embedded via ${result.provider}/${result.model} (${result.embeddedChunkCount} chunks)`,
  );
}

main().catch((error) => {
  console.error("Experimental embedding failed", error);
  process.exit(1);
});
