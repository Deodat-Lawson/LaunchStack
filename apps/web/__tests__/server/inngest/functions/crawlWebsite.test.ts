import { crawlWebsite } from "~/server/inngest/functions/crawlWebsite";
import { uploadFile, type UploadResult } from "~/lib/storage";
import {
    processDocumentUpload,
    type DocumentUploadResult,
} from "~/server/services/document-upload";
import type { WebsiteCrawlEvent } from "~/server/inngest/client";

type CrawlPage = {
    url: string;
    html: string;
    title: string;
    depth: number;
    parentUrl: string | null;
    discoveredLinks: number;
};

type CrawlPagesResult = {
    pages: CrawlPage[];
    totalDiscovered: number;
};

type StoredPage = {
    url: string;
    title: string;
    depth: number;
    parentUrl: string | null;
    documentId: number;
    jobId: string;
};

type CrawlResult = {
    success: true;
    crawlGroupId: string;
    pagesStored: number;
    totalDiscovered: number;
    pages: StoredPage[];
};

type CrawlStep = {
    run: (
        name: string,
        operation: () => Promise<CrawlPagesResult | StoredPage[]>
    ) => Promise<CrawlPagesResult | StoredPage[]>;
};

type CrawlHandler = (context: {
    event: { data: WebsiteCrawlEvent["data"] };
    step: CrawlStep;
}) => Promise<CrawlResult>;

type CreateFunctionResult = {
    fn: CrawlHandler;
};
type MockCrawlFunction = {
    fn: CrawlHandler;
};

jest.mock("~/server/inngest/client", () => ({
    inngest: {
        createFunction: jest.fn(
            (
                _options: unknown,
                _trigger: unknown,
                handler: CrawlHandler
            ): CreateFunctionResult => ({ fn: handler })
        ),
    },
}));

jest.mock("~/lib/storage", () => ({
    uploadFile: jest.fn(),
}));

jest.mock("~/server/services/document-upload", () => ({
    processDocumentUpload: jest.fn(),
}));

const mockUploadFile = uploadFile as jest.MockedFunction<typeof uploadFile>;
const mockProcessDocumentUpload = processDocumentUpload as jest.MockedFunction<
    typeof processDocumentUpload
>;

const pages: CrawlPage[] = [
    {
        url: "https://example.com/",
        html: "<html><head></head><body>home</body></html>",
        title: "Home",
        depth: 0,
        parentUrl: null,
        discoveredLinks: 1,
    },
    {
        url: "https://example.com/about",
        html: "<html><head></head><body>about</body></html>",
        title: "About",
        depth: 1,
        parentUrl: "https://example.com/",
        discoveredLinks: 0,
    },
];

const eventData: WebsiteCrawlEvent["data"] = {
    url: "https://example.com/",
    userId: "user-1",
    companyId: "42",
    category: "Research",
    maxDepth: 1,
    maxPages: 2,
    crawlGroupId: "crawl-group-1",
    requestUrl: "https://app.example.com/upload",
};

function createStep(): CrawlStep {
    return {
        run: async (name, operation) => {
            if (name === "crawl-pages") {
                return { pages, totalDiscovered: pages.length };
            }
            return operation();
        },
    };
}

describe("crawlWebsite page lifecycle failures", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("attempts every page, rejects after a partial failure, and reuses stable keys on retry", async () => {
        let failAboutPage = true;
        let nextDocumentId = 100;

        mockUploadFile.mockImplementation(
            async ({ filename }): Promise<UploadResult> => ({
                url: `https://storage.example/${filename}`,
                pathname: filename,
                contentType: "text/html",
                provider: "s3",
            })
        );
        mockProcessDocumentUpload.mockImplementation(
            async ({ creationKey }): Promise<DocumentUploadResult> => {
                if (failAboutPage && creationKey?.endsWith(":https://example.com/about")) {
                    throw new Error("document dispatch failed");
                }

                const documentId = nextDocumentId++;
                return {
                    document: {
                        id: documentId,
                        title: "stored",
                        url: "https://storage.example/stored",
                        category: "Research",
                    },
                    jobId: `job-${documentId}`,
                    eventIds: [],
                    storageType: "s3",
                    resolvedDocumentUrl: "https://storage.example/stored",
                };
            }
        );
        const mockedCrawlWebsite = crawlWebsite as unknown as MockCrawlFunction;
        const handler = mockedCrawlWebsite.fn;
        const invoke = (): Promise<CrawlResult> =>
            handler({
                event: { data: eventData },
                step: createStep(),
            });

        await expect(invoke()).rejects.toThrow(
            "https://example.com/about: document dispatch failed"
        );

        expect(mockUploadFile).toHaveBeenCalledTimes(2);
        expect(mockProcessDocumentUpload).toHaveBeenCalledTimes(2);
        const firstArgs = mockProcessDocumentUpload.mock.calls[0]?.[0];
        const secondArgs = mockProcessDocumentUpload.mock.calls[1]?.[0];
        expect(firstArgs?.creationKey).toBe("crawl:crawl-group-1:https://example.com/");
        expect(secondArgs?.creationKey).toBe("crawl:crawl-group-1:https://example.com/about");

        failAboutPage = false;
        const retryResult = await invoke();

        expect(retryResult).toMatchObject({
            success: true,
            crawlGroupId: "crawl-group-1",
            pagesStored: 2,
            totalDiscovered: 2,
        });
        expect(retryResult.pages).toHaveLength(2);

        const creationKeys = mockProcessDocumentUpload.mock.calls.map(([args]) => args.creationKey);
        expect(creationKeys.slice(0, 2)).toEqual(creationKeys.slice(2, 4));
    });
});
