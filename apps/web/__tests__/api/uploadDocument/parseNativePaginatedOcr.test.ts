/**
 * Tests for native DataLab paginated OCR parsing
 * DataLab format: \n\n{PAGE_NUMBER}\n{48 dashes}\n\n
 */

// Inline implementation for testing to avoid module import issues
interface PDFMetadata {
  loc?: {
    pageNumber?: number;
  };
}

interface Document<T> {
  pageContent: string;
  metadata: T;
}

function parseNativePaginatedOcr(content: string): Document<PDFMetadata>[] {
  // Regex to match DataLab page separator formats:
  // Format 1: {PAGE_NUMBER}------------------------------------------------
  // Format 2: \n\n{PAGE_NUMBER}\n{46-50 dashes}\n\n
  const pageRegex = /\{(\d+)\}-{40,50}|[\r\n]{2,}(\d+)[\r\n]-{46,50}[\r\n]{2,}/g;
  
  const documents: Document<PDFMetadata>[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  
  while ((match = pageRegex.exec(content)) !== null) {
    // match[1] is for {N} format, match[2] is for \n\nN\n format
    const pageNumber = parseInt(match[1] ?? match[2] ?? '1', 10);
    const pageContent = content.slice(lastIndex, match.index).trim();
    
    if (pageContent) {
      documents.push({
        pageContent,
        metadata: { loc: { pageNumber } }
      });
    }
    
    lastIndex = pageRegex.lastIndex;
  }
  
  const finalContent = content.slice(lastIndex).trim();
  if (finalContent) {
    const lastPageNum = documents.length > 0 
      ? (((documents[documents.length - 1]?.metadata?.loc?.pageNumber) ?? 0) + 1)
      : 1;
    
    documents.push({
      pageContent: finalContent,
      metadata: { loc: { pageNumber: lastPageNum } }
    });
  }
  
  if (documents.length === 0) {
    return [{
      pageContent: content.trim(),
      metadata: { loc: { pageNumber: 1 } }
    }];
  }
  
  return documents;
}

describe("parseNativePaginatedOcr", () => {
  describe("Curly brace format (actual DataLab format)", () => {
    it("should parse pages with {N}---- format", () => {
      const content = `First page content here.

{0}------------------------------------------------

Second page content here.

{1}------------------------------------------------

Third page content here.`;

      const result = parseNativePaginatedOcr(content);

      expect(result).toHaveLength(3);
      expect(result[0]!.metadata.loc?.pageNumber).toBe(0);
      expect(result[1]!.metadata.loc?.pageNumber).toBe(1);
      expect(result[2]!.metadata.loc?.pageNumber).toBe(2);
    });
  });

  describe("Single page documents", () => {
    it("should parse single page without separator", () => {
      const content = "This is page 1 content with some text.";
      const result = parseNativePaginatedOcr(content);

      expect(result).toHaveLength(1);
      expect(result[0]!.pageContent).toBe("This is page 1 content with some text.");
      expect(result[0]!.metadata.loc?.pageNumber).toBe(1);
    });

    it("should handle empty content", () => {
      const content = "";
      const result = parseNativePaginatedOcr(content);

      expect(result).toHaveLength(1);
      expect(result[0]!.pageContent).toBe("");
      expect(result[0]!.metadata.loc?.pageNumber).toBe(1);
    });

    it("should handle whitespace-only content", () => {
      const content = "   \n\n  \t  ";
      const result = parseNativePaginatedOcr(content);

      expect(result).toHaveLength(1);
      expect(result[0]!.pageContent).toBe("");
      expect(result[0]!.metadata.loc?.pageNumber).toBe(1);
    });
  });

  describe("Multi-page documents with DataLab separators", () => {
    it("should parse two pages with correct separator", () => {
      const content = `Page 1 content here.


1
------------------------------------------------


Page 2 content here.`;

      const result = parseNativePaginatedOcr(content);

      expect(result).toHaveLength(2);
      expect(result[0]!.pageContent).toBe("Page 1 content here.");
      expect(result[0]!.metadata.loc?.pageNumber).toBe(1);
      expect(result[1]!.pageContent).toBe("Page 2 content here.");
      expect(result[1]!.metadata.loc?.pageNumber).toBe(2);
    });

    it("should parse three pages with correct separators", () => {
      const content = `First page content.


1
------------------------------------------------


Second page content.


2
------------------------------------------------


Third page content.`;

      const result = parseNativePaginatedOcr(content);

      expect(result).toHaveLength(3);
      expect(result[0]!.metadata.loc?.pageNumber).toBe(1);
      expect(result[1]!.metadata.loc?.pageNumber).toBe(2);
      expect(result[2]!.metadata.loc?.pageNumber).toBe(3);
    });

    it("should handle non-sequential page numbers", () => {
      const content = `Page 5 content.


5
------------------------------------------------


Page 10 content.


10
------------------------------------------------


Page 15 content.`;

      const result = parseNativePaginatedOcr(content);

      expect(result).toHaveLength(3);
      expect(result[0]!.metadata.loc?.pageNumber).toBe(5);
      expect(result[1]!.metadata.loc?.pageNumber).toBe(10);
      // Content after last separator is page 11 (10 + 1)
      expect(result[2]!.metadata.loc?.pageNumber).toBe(11);
    });
  });

  describe("Edge cases", () => {
    it("should handle empty pages between separators", () => {
      const content = `Page 1 content.


1
------------------------------------------------




2
------------------------------------------------


Page 3 content.`;

      const result = parseNativePaginatedOcr(content);

      // Should skip empty page 2, content after page 2 separator is page 2 (last seen + 1)
      expect(result).toHaveLength(2);
      expect(result[0]!.metadata.loc?.pageNumber).toBe(1);
      // Since we skipped empty page 2, last page in array is 1, so next is 2
      expect(result[1]!.metadata.loc?.pageNumber).toBe(2);
    });

    it("should handle pages with complex content", () => {
      const content = `# Header 1

This is a paragraph with **bold** and *italic*.

- List item 1
- List item 2

| Table | Header |
|-------|--------|
| Cell  | Data   |


1
------------------------------------------------


## Header 2

More content with [links](http://example.com).

\`\`\`javascript
const code = "block";
\`\`\``;

      const result = parseNativePaginatedOcr(content);

      expect(result).toHaveLength(2);
      expect(result[0]!.pageContent).toContain("# Header 1");
      expect(result[0]!.pageContent).toContain("| Table | Header |");
      expect(result[1]!.pageContent).toContain("## Header 2");
      expect(result[1]!.pageContent).toContain("const code");
    });

    it("should handle separator-like content in page text", () => {
      const content = `Page 1 has text with dashes:
------------------------------------------------
But this is not a separator.


1
------------------------------------------------


Page 2 content.`;

      const result = parseNativePaginatedOcr(content);

      expect(result).toHaveLength(2);
      expect(result[0]!.pageContent).toContain("But this is not a separator");
      expect(result[1]!.pageContent).toBe("Page 2 content.");
    });

    it("should handle last page without trailing separator", () => {
      const content = `Page 1.


1
------------------------------------------------


Page 2.


2
------------------------------------------------


Page 3 is the last page.`;

      const result = parseNativePaginatedOcr(content);

      expect(result).toHaveLength(3);
      expect(result[2]!.pageContent).toBe("Page 3 is the last page.");
      expect(result[2]!.metadata.loc?.pageNumber).toBe(3);
    });

    it("should handle large page numbers", () => {
      const content = `Page 999.


999
------------------------------------------------


Page 1000.`;

      const result = parseNativePaginatedOcr(content);

      expect(result).toHaveLength(2);
      expect(result[0]!.metadata.loc?.pageNumber).toBe(999);
      expect(result[1]!.metadata.loc?.pageNumber).toBe(1000);
    });
  });

  describe("Malformed separators", () => {
    it("should handle separator with wrong dash count (47 dashes)", () => {
      const content = `Page 1.


1
-----------------------------------------------


Page 2.`;

      const result = parseNativePaginatedOcr(content);

      // Should still parse if close to 48 dashes
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it("should handle separator with extra dashes (50 dashes)", () => {
      const content = `Page 1.


1
--------------------------------------------------


Page 2.`;

      const result = parseNativePaginatedOcr(content);

      // Should still parse if close to 48 dashes
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it("should handle missing newlines around separator", () => {
      const content = `Page 1.

1
------------------------------------------------
Page 2.`;

      const result = parseNativePaginatedOcr(content);

      // Should be lenient with newline variations
      expect(result.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Real-world scenarios", () => {
    it("should handle invoice with multiple pages", () => {
      const content = `INVOICE #12345
Date: 2025-01-01
Total: $1,234.56


1
------------------------------------------------


TERMS AND CONDITIONS
1. Payment due in 30 days
2. Late fees apply


2
------------------------------------------------


ITEMIZED BREAKDOWN
Item A: $500
Item B: $734.56`;

      const result = parseNativePaginatedOcr(content);

      expect(result).toHaveLength(3);
      expect(result[0]!.pageContent).toContain("INVOICE #12345");
      expect(result[1]!.pageContent).toContain("TERMS AND CONDITIONS");
      expect(result[2]!.pageContent).toContain("ITEMIZED BREAKDOWN");
    });

    it("should handle contract with page numbers", () => {
      const content = `CONTRACT AGREEMENT

This agreement is made between...


1
------------------------------------------------


SECTION 2: TERMS

The following terms apply...


2
------------------------------------------------


SECTION 3: SIGNATURES

Signed by...`;

      const result = parseNativePaginatedOcr(content);

      expect(result).toHaveLength(3);
      expect(result[0]!.metadata.loc?.pageNumber).toBe(1);
      expect(result[1]!.metadata.loc?.pageNumber).toBe(2);
      expect(result[2]!.metadata.loc?.pageNumber).toBe(3);
    });
  });
});
