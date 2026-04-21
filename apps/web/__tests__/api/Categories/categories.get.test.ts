import { GET } from "~/app/api/Categories/GetCategories/route";
import { auth } from "@clerk/nextjs/server";
import { db } from "~/server/db/index";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("~/server/db/index", () => ({
  db: {
    select: jest.fn(),
  },
}));

describe("GET /api/Categories/GetCategories", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should allow an authenticated employer to get categories", async () => {
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: "employer-user-123" });

    const mockCategories = [
      { id: 1, name: "Category 1", companyId: 1 },
      { id: 2, name: "Category 2", companyId: 1 },
      { id: 3, name: "Category 3", companyId: 1 },
    ];

    // First call: user lookup
    // Second call: categories lookup
    const mockSelect = jest.fn()
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([
            { userId: "employer-user-123", role: "employer", companyId: 1 }
          ]),
        }),
      })
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue(mockCategories),
        }),
      });

    (db.select as jest.Mock) = mockSelect;

    const request = new Request("http://localhost/api/Categories/GetCategories", {
      method: "GET",
    });

    const response = await GET(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual(mockCategories);
    expect(json).toHaveLength(3);
  });

  it("should allow an authenticated owner to get categories", async () => {
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: "owner-user-456" });

    const mockCategories = [
      { id: 10, name: "Owner Category 1", companyId: 2 },
      { id: 11, name: "Owner Category 2", companyId: 2 },
    ];

    const mockSelect = jest.fn()
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([
            { userId: "owner-user-456", role: "owner", companyId: 2 }
          ]),
        }),
      })
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue(mockCategories),
        }),
      });

    (db.select as jest.Mock) = mockSelect;

    const request = new Request("http://localhost/api/Categories/GetCategories", {
      method: "GET",
    });

    const response = await GET(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual(mockCategories);
    expect(json).toHaveLength(2);
  });

  it("should return empty array if no categories exist for company", async () => {
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: "employer-user-789" });

    const mockSelect = jest.fn()
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([
            { userId: "employer-user-789", role: "employer", companyId: 3 }
          ]),
        }),
      })
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([]), // No categories
        }),
      });

    (db.select as jest.Mock) = mockSelect;

    const request = new Request("http://localhost/api/Categories/GetCategories", {
      method: "GET",
    });

    const response = await GET(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual([]);
    expect(json).toHaveLength(0);
  });

  it("should return 400 if user is not found", async () => {
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: "invalid-user-999" });

    // Mock user lookup - return empty array (user not found)
    const mockSelect = jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue([]),
      }),
    });
    (db.select as jest.Mock) = mockSelect;

    const request = new Request("http://localhost/api/Categories/GetCategories", {
      method: "GET",
    });

    const response = await GET(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toBe("Invalid user.");
  });

  it("should return 400 if user has invalid role (employee)", async () => {
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: "employee-user-111" });

    // Mock user lookup - return employee (invalid role)
    const mockSelect = jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue([
          { userId: "employee-user-111", role: "employee", companyId: 4 }
        ]),
      }),
    });
    (db.select as jest.Mock) = mockSelect;

    const request = new Request("http://localhost/api/Categories/GetCategories", {
      method: "GET",
    });

    const response = await GET(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toBe("Invalid user role.");
  });

  it("should return 500 on database error during user lookup", async () => {
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: "test-user-123" });

    // Mock database error on user lookup
    const mockSelect = jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockRejectedValue(new Error("Database connection failed")),
      }),
    });
    (db.select as jest.Mock) = mockSelect;

    const request = new Request("http://localhost/api/Categories/GetCategories", {
      method: "GET",
    });

    const response = await GET(request);
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json.error).toBe("Unable to fetch documents");
  });

  it("should return 500 on database error during categories fetch", async () => {
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: "employer-user-123" });

    // First call succeeds (user lookup), second call fails (categories fetch)
    const mockSelect = jest.fn()
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([
            { userId: "employer-user-123", role: "employer", companyId: 1 }
          ]),
        }),
      })
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockRejectedValue(new Error("Failed to fetch categories")),
        }),
      });

    (db.select as jest.Mock) = mockSelect;

    const request = new Request("http://localhost/api/Categories/GetCategories", {
      method: "GET",
    });

    const response = await GET(request);
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json.error).toBe("Unable to fetch documents");
  });

  it("should return 400 if auth returns null userId", async () => {
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: null });

    const mockSelect = jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue([]),
      }),
    });
    (db.select as jest.Mock) = mockSelect;

    const request = new Request("http://localhost/api/Categories/GetCategories", {
      method: "GET",
    });

    const response = await GET(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toBe("Invalid user.");
  });

  it("should only return categories for the user's company", async () => {
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: "employer-user-123" });

    // Categories for company 1 only
    const mockCategories = [
      { id: 1, name: "Company 1 Category", companyId: 1 },
      { id: 2, name: "Another Company 1 Category", companyId: 1 },
    ];

    const mockSelect = jest.fn()
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([
            { userId: "employer-user-123", role: "employer", companyId: 1 }
          ]),
        }),
      })
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue(mockCategories),
        }),
      });

    (db.select as jest.Mock) = mockSelect;

    const request = new Request("http://localhost/api/Categories/GetCategories", {
      method: "GET",
    });

    const response = await GET(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    // Verify all categories belong to companyId 1
    json.forEach((category: any) => {
      expect(category.companyId).toBe(1);
    });
  });
});