import { parseProvider } from "@launchstack/core/ocr/trigger";

describe("parseProvider", () => {
  it.each(["MARKER", "DOCLING", "marker", "docling"])(
    "accepts OSS provider override %s",
    (provider) => {
      expect(parseProvider(provider)).toBe(provider.toUpperCase());
    },
  );
});
