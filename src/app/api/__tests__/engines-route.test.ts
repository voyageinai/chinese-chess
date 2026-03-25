import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getCurrentUser,
  getEnginesByUser,
  getVisibleEngines,
  sanitizeEngines,
} = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getEnginesByUser: vi.fn(),
  getVisibleEngines: vi.fn(),
  sanitizeEngines: vi.fn((engines: unknown) => engines),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser,
}));

vi.mock("@/db/queries", () => ({
  getEnginesByUser,
  getVisibleEngines,
}));

vi.mock("@/server/dto", () => ({
  sanitizeEngines,
}));

import { GET } from "@/app/api/engines/route";

describe("GET /api/engines", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentUser.mockResolvedValue({ id: "user-1" });
    getVisibleEngines.mockReturnValue([]);
    getEnginesByUser.mockReturnValue([]);
  });

  it("filters owned engines by active status when requested", async () => {
    const response = await GET(
      new Request("http://localhost/api/engines?scope=owned&status=active"),
    );

    expect(response.status).toBe(200);
    expect(getEnginesByUser).toHaveBeenCalledWith("user-1", "active");
    expect(getVisibleEngines).not.toHaveBeenCalled();
  });

  it("rejects unknown status filters", async () => {
    const response = await GET(
      new Request("http://localhost/api/engines?scope=owned&status=archived"),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid status. Must be 'active' or 'disabled'",
    });
    expect(getEnginesByUser).not.toHaveBeenCalled();
  });
});
