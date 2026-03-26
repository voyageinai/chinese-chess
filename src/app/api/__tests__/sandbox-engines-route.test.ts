import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  validateWorkerAuth,
  denyWorkerAuth,
  isDistributedEnabled,
  getVisibleEngines,
  sanitizeEngines,
} = vi.hoisted(() => ({
  validateWorkerAuth: vi.fn(),
  denyWorkerAuth: vi.fn(() => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })),
  isDistributedEnabled: vi.fn(),
  getVisibleEngines: vi.fn(),
  sanitizeEngines: vi.fn((engines: unknown) => engines),
}));

vi.mock("@/server/distributed/auth", () => ({
  validateWorkerAuth,
  denyWorkerAuth,
  isDistributedEnabled,
}));

vi.mock("@/db/queries", () => ({
  getVisibleEngines,
}));

vi.mock("@/server/dto", () => ({
  sanitizeEngines,
}));

import { GET } from "@/app/api/internal/sandbox/engines/route";

describe("GET /api/internal/sandbox/engines", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isDistributedEnabled.mockReturnValue(true);
    validateWorkerAuth.mockReturnValue(true);
    getVisibleEngines.mockReturnValue([{ id: "e-1", name: "Pikafish", elo: 1600 }]);
  });

  it("returns sanitized visible engines for authenticated workers", async () => {
    const response = await GET(new Request("http://localhost/api/internal/sandbox/engines"));

    expect(response.status).toBe(200);
    expect(getVisibleEngines).toHaveBeenCalledTimes(1);
    expect(sanitizeEngines).toHaveBeenCalledWith([{ id: "e-1", name: "Pikafish", elo: 1600 }]);
    await expect(response.json()).resolves.toEqual({
      engines: [{ id: "e-1", name: "Pikafish", elo: 1600 }],
    });
  });

  it("rejects unauthenticated workers", async () => {
    validateWorkerAuth.mockReturnValue(false);

    const response = await GET(new Request("http://localhost/api/internal/sandbox/engines"));

    expect(response.status).toBe(401);
    expect(getVisibleEngines).not.toHaveBeenCalled();
  });
});
