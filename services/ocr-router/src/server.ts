import express from "express";
import { determineDocumentRouting, renderPagesToImages } from "./complexity.js";

const app = express();

// Accept large PDF buffers
app.use(express.json({ limit: "100mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

/**
 * POST /route
 * Accepts a document URL, returns a routing decision (which OCR provider to use).
 * Body: { documentUrl: string, env: { OCR_DEFAULT_PROVIDER?, OCR_WORKER_URL?, AZURE_DOC_INTELLIGENCE_KEY?, ... } }
 */
app.post("/route", async (req, res) => {
  try {
    const { documentUrl, env } = req.body as {
      documentUrl: string;
      env?: Record<string, string>;
    };

    if (!documentUrl) {
      res.status(400).json({ error: "documentUrl is required" });
      return;
    }

    // Inject env vars so the routing logic can check provider availability
    if (env) {
      for (const [key, value] of Object.entries(env)) {
        process.env[key] = value;
      }
    }

    const decision = await determineDocumentRouting(documentUrl);
    res.json(decision);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Route decision failed:", message);
    res.status(500).json({ error: message });
  }
});

/**
 * POST /render-pages
 * Accepts a PDF buffer + page indices, returns rendered PNG images as base64.
 * Body: { buffer: string (base64), pageIndices: number[] }
 */
app.post("/render-pages", async (req, res) => {
  try {
    const { buffer, pageIndices } = req.body as {
      buffer: string;
      pageIndices: number[];
    };

    if (!buffer || !pageIndices) {
      res.status(400).json({ error: "buffer (base64) and pageIndices are required" });
      return;
    }

    const pdfBuffer = Buffer.from(buffer, "base64");
    const images = await renderPagesToImages(pdfBuffer.buffer, pageIndices);

    // Return images as base64 strings
    const imagesBase64 = images.map((img) => Buffer.from(img).toString("base64"));
    res.json({ images: imagesBase64 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Page rendering failed:", message);
    res.status(500).json({ error: message });
  }
});

const port = parseInt(process.env.PORT ?? "8002", 10);
app.listen(port, "0.0.0.0", () => {
  console.log(`OCR Router listening on port ${port}`);
});
