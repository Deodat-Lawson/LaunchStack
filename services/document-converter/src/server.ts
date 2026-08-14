/**
 * Entry point. The ONLY place process.env is read (once, at boot).
 * Invalid configuration is a readable startup failure, never a
 * half-configured running service.
 */
import { createApp } from "./app.js";
import { loadConfig, type Config } from "./config.js";
import { log } from "./logger.js";

let config: Config;
try {
  config = loadConfig(process.env);
} catch (err) {
  // Plain text on purpose: this is the message an operator reads at boot.
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

const app = createApp(config);

app.listen(config.port, "0.0.0.0", () => {
  log("info", "document-converter listening", {
    port: config.port,
    docling: config.doclingServeUrl ? "configured" : "not-configured",
    allowedFetchOrigins: config.allowedFetchOrigins,
  });
});
