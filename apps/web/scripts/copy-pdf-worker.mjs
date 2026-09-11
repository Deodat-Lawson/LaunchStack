/**
 * Copy the pdf.js worker into public/ so the PDF viewer has no CDN dependency.
 *
 * The viewer used to default `workerSrc` to cdn.jsdelivr.net, which meant an
 * air-gapped or network-restricted instance could not render a PDF at all. The
 * documented escape hatch (NEXT_PUBLIC_PDF_WORKER_URL) could not fix that
 * either: NEXT_PUBLIC_* values are inlined at build time, so someone running
 * the published GHCR image cannot change one.
 *
 * The worker version must match the pdfjs-dist that react-pdf actually loads —
 * the component reads `pdfjs.version` from react-pdf's own re-export, and a
 * mismatch makes pdf.js refuse to start. So resolve it *through* react-pdf
 * rather than from this package's own dependency, which can differ.
 */
import { createRequire } from "node:module";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));

const reactPdfEntry = require.resolve("react-pdf", { paths: [path.join(here, "..")] });
const pdfjsPkg = require.resolve("pdfjs-dist/package.json", {
  paths: [path.dirname(reactPdfEntry)],
});
const pdfjsDir = path.dirname(pdfjsPkg);

const source = path.join(pdfjsDir, "build", "pdf.worker.min.mjs");
const destDir = path.join(here, "..", "public");
const dest = path.join(destDir, "pdf.worker.min.mjs");

await mkdir(destDir, { recursive: true });
await copyFile(source, dest);

const { version } = require(pdfjsPkg);
console.log(`[pdf-worker] copied pdfjs-dist@${version} worker to public/pdf.worker.min.mjs`);
