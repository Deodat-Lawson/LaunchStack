import { selectSamplePages } from "~/lib/ocr/complexity";

describe("OCR Complexity Module", () => {
  describe("selectSamplePages", () => {
    describe("small documents (totalPages <= 3)", () => {
      it("should return all pages for single-page document", () => {
        const result = selectSamplePages(1);
        expect(result).toEqual([1]);
      });

      it("should return all pages for 2-page document", () => {
        const result = selectSamplePages(2);
        expect(result).toEqual([1, 2]);
      });

      it("should return all pages for 3-page document", () => {
        const result = selectSamplePages(3);
        expect(result).toEqual([1, 2, 3]);
      });
    });

    describe("medium documents (4-20 pages)", () => {
      it("should select first, middle, and last pages for 4-page document", () => {
        const result = selectSamplePages(4);

        expect(result).toContain(1); // First page
        expect(result).toContain(4); // Last page
        expect(result).toContain(2); // Middle: ceil(4/2) = 2
        expect(result.length).toBeLessThanOrEqual(5);
      });

      it("should select first, middle, and last pages for 5-page document", () => {
        const result = selectSamplePages(5);

        expect(result).toContain(1); // First page
        expect(result).toContain(5); // Last page
        expect(result).toContain(3); // Middle: ceil(5/2) = 3
        expect(result.length).toBeLessThanOrEqual(5);
      });

      it("should select first, middle, and last pages for 10-page document", () => {
        const result = selectSamplePages(10);

        expect(result).toContain(1);  // First page
        expect(result).toContain(10); // Last page
        expect(result).toContain(5);  // Middle: ceil(10/2) = 5
        expect(result.length).toBeLessThanOrEqual(5);
      });

      it("should select first, middle, and last pages for 20-page document", () => {
        const result = selectSamplePages(20);

        expect(result).toContain(1);  // First page
        expect(result).toContain(20); // Last page
        expect(result).toContain(10); // Middle: ceil(20/2) = 10
        expect(result.length).toBeLessThanOrEqual(5);
      });
    });

    describe("large documents (>20 pages)", () => {
      it("should include a random page for documents with more than 20 pages", () => {
        // Run multiple times to account for randomness
        const results: number[][] = [];
        for (let i = 0; i < 10; i++) {
          results.push(selectSamplePages(50));
        }

        // All results should contain first, middle, and last
        results.forEach((result) => {
          expect(result).toContain(1);  // First page
          expect(result).toContain(50); // Last page
          expect(result).toContain(25); // Middle: ceil(50/2) = 25
        });

        // At least some results should have 4 pages (with random)
        const hasRandomPage = results.some((r) => r.length >= 4);
        expect(hasRandomPage).toBe(true);
      });

      it("should select appropriate pages for 100-page document", () => {
        const result = selectSamplePages(100);

        expect(result).toContain(1);   // First page
        expect(result).toContain(100); // Last page
        expect(result).toContain(50);  // Middle: ceil(100/2) = 50
        expect(result.length).toBeLessThanOrEqual(5);
      });

      it("should select appropriate pages for 500-page document", () => {
        const result = selectSamplePages(500);

        expect(result).toContain(1);   // First page
        expect(result).toContain(500); // Last page
        expect(result).toContain(250); // Middle: ceil(500/2) = 250
        expect(result.length).toBeLessThanOrEqual(5);
      });
    });

    describe("result ordering and uniqueness", () => {
      it("should return pages in sorted ascending order", () => {
        const result = selectSamplePages(100);

        for (let i = 1; i < result.length; i++) {
          expect(result[i]).toBeGreaterThan(result[i - 1]!);
        }
      });

      it("should not contain duplicate pages", () => {
        const result = selectSamplePages(50);
        const uniquePages = new Set(result);
        expect(uniquePages.size).toBe(result.length);
      });

      it("should return unique pages even for edge case page counts", () => {
        // Test various page counts to ensure no duplicates
        const testCases = [4, 5, 6, 7, 8, 10, 15, 21, 25, 50, 100];

        testCases.forEach((totalPages) => {
          const result = selectSamplePages(totalPages);
          const uniquePages = new Set(result);
          expect(uniquePages.size).toBe(result.length);
        });
      });
    });

    describe("page number validity", () => {
      it("should only return page numbers >= 1", () => {
        const testCases = [1, 5, 10, 50, 100];

        testCases.forEach((totalPages) => {
          const result = selectSamplePages(totalPages);
          result.forEach((page) => {
            expect(page).toBeGreaterThanOrEqual(1);
          });
        });
      });

      it("should only return page numbers <= totalPages", () => {
        const testCases = [1, 5, 10, 50, 100];

        testCases.forEach((totalPages) => {
          const result = selectSamplePages(totalPages);
          result.forEach((page) => {
            expect(page).toBeLessThanOrEqual(totalPages);
          });
        });
      });

      it("should return integers only", () => {
        const testCases = [1, 5, 10, 50, 100];

        testCases.forEach((totalPages) => {
          const result = selectSamplePages(totalPages);
          result.forEach((page) => {
            expect(Number.isInteger(page)).toBe(true);
          });
        });
      });
    });

    describe("max sample limit", () => {
      it("should never return more than 5 pages", () => {
        const testCases = [1, 3, 5, 10, 20, 50, 100, 500, 1000];

        testCases.forEach((totalPages) => {
          const result = selectSamplePages(totalPages);
          expect(result.length).toBeLessThanOrEqual(5);
        });
      });

      it("should return exactly totalPages when totalPages <= 3", () => {
        expect(selectSamplePages(1).length).toBe(1);
        expect(selectSamplePages(2).length).toBe(2);
        expect(selectSamplePages(3).length).toBe(3);
      });
    });

    describe("edge cases", () => {
      it("should handle zero pages gracefully", () => {
        const result = selectSamplePages(0);
        expect(result).toEqual([]);
      });

      it("should handle very large page counts", () => {
        const result = selectSamplePages(10000);

        expect(result).toContain(1);     // First page
        expect(result).toContain(10000); // Last page
        expect(result).toContain(5000);  // Middle
        expect(result.length).toBeLessThanOrEqual(5);
      });

      it("should handle boundary case at 21 pages (first with random)", () => {
        // Run multiple times due to randomness
        const results: number[][] = [];
        for (let i = 0; i < 10; i++) {
          results.push(selectSamplePages(21));
        }

        results.forEach((result) => {
          expect(result).toContain(1);  // First page
          expect(result).toContain(21); // Last page
          expect(result).toContain(11); // Middle: ceil(21/2) = 11
        });
      });
    });

    describe("sampling strategy validation", () => {
      it("should always include first page for documents > 3 pages", () => {
        const testCases = [4, 5, 10, 20, 50, 100];

        testCases.forEach((totalPages) => {
          const result = selectSamplePages(totalPages);
          expect(result[0]).toBe(1);
        });
      });

      it("should always include last page for documents > 3 pages", () => {
        const testCases = [4, 5, 10, 20, 50, 100];

        testCases.forEach((totalPages) => {
          const result = selectSamplePages(totalPages);
          expect(result).toContain(totalPages);
        });
      });

      it("should always include middle page for documents > 3 pages", () => {
        const testCases = [
          { total: 4, expectedMiddle: 2 },
          { total: 5, expectedMiddle: 3 },
          { total: 10, expectedMiddle: 5 },
          { total: 20, expectedMiddle: 10 },
          { total: 100, expectedMiddle: 50 },
        ];

        testCases.forEach(({ total, expectedMiddle }) => {
          const result = selectSamplePages(total);
          expect(result).toContain(expectedMiddle);
        });
      });
    });

    describe("random page selection (documents > 20 pages)", () => {
      it("should select random page between 2 and totalPages-1", () => {
        // Run multiple times to test randomness boundaries
        const allRandomPages: number[] = [];

        for (let i = 0; i < 50; i++) {
          const result = selectSamplePages(100);
          // Find pages that aren't first (1), middle (50), or last (100)
          const possibleRandomPages = result.filter(
            (p) => p !== 1 && p !== 50 && p !== 100
          );
          allRandomPages.push(...possibleRandomPages);
        }

        // All random pages should be within valid range
        allRandomPages.forEach((page) => {
          expect(page).toBeGreaterThanOrEqual(2);
          expect(page).toBeLessThanOrEqual(99);
        });

        // Should have some variation in random pages
        const uniqueRandomPages = new Set(allRandomPages);
        expect(uniqueRandomPages.size).toBeGreaterThan(1);
      });
    });

    describe("consistency checks", () => {
      it("should produce consistent results for small documents (no randomness)", () => {
        const results10Pages: number[][] = [];
        for (let i = 0; i < 5; i++) {
          results10Pages.push(selectSamplePages(10));
        }

        // All results for 10 pages should be identical (no random page added)
        const firstResult = results10Pages[0];
        results10Pages.forEach((result) => {
          expect(result).toEqual(firstResult);
        });
      });

      it("should always return array type", () => {
        const testCases = [0, 1, 5, 10, 50, 100];

        testCases.forEach((totalPages) => {
          const result = selectSamplePages(totalPages);
          expect(Array.isArray(result)).toBe(true);
        });
      });
    });
  });
});
