import { readUploadThingResult } from "~/app/utils/uploadthing";

describe("readUploadThingResult", () => {
  it("returns canonical {url, ref} from serverData", () => {
    const result = readUploadThingResult({
      url: "https://utfs.io/f/client-url",
      serverData: {
        url: "https://utfs.io/f/server-url",
        ref: {
          adapter: "uploadthing",
          storageLocationId: "uploadthing:app_test@us-east-1",
          key: "ut_key_123",
        },
      },
    });

    expect(result).toEqual({
      url: "https://utfs.io/f/server-url",
      ref: {
        adapter: "uploadthing",
        storageLocationId: "uploadthing:app_test@us-east-1",
        key: "ut_key_123",
      },
    });
  });

  it("falls back to client url when serverData.url is missing", () => {
    const result = readUploadThingResult({
      url: "https://utfs.io/f/client-url",
      serverData: {
        ref: {
          adapter: "uploadthing",
          storageLocationId: "uploadthing:app_test@us-east-1",
          key: "ut_key_456",
        },
      },
    });

    expect(result.url).toBe("https://utfs.io/f/client-url");
    expect(result.ref.key).toBe("ut_key_456");
  });

  it("throws when callback did not return ref", () => {
    expect(() =>
      readUploadThingResult({
        url: "https://utfs.io/f/client-url",
        serverData: {
          url: "https://utfs.io/f/server-url",
        },
      }),
    ).toThrow("UploadThing: callback did not return a canonical object ref.");
  });
});
