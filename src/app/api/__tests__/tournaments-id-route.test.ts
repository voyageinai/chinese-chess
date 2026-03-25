import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getCurrentUser,
  getTournamentById,
  getTournamentEntries,
  addEngineToTournament,
  getEngineById,
  registerRunner,
  logAudit,
} = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getTournamentById: vi.fn(),
  getTournamentEntries: vi.fn(),
  addEngineToTournament: vi.fn(),
  getEngineById: vi.fn(),
  registerRunner: vi.fn(),
  logAudit: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser,
}));

vi.mock("@/db/queries", () => ({
  getTournamentById,
  getTournamentEntries,
  addEngineToTournament,
  getEngineById,
  getGamesByTournament: vi.fn(),
}));

vi.mock("@/server/tournament", () => ({
  TournamentRunner: vi.fn(),
  registerRunner,
}));

vi.mock("@/server/ws", () => ({
  wsHub: {
    broadcast: vi.fn(),
  },
}));

vi.mock("@/server/audit", () => ({
  logAudit,
}));

import { PUT } from "@/app/api/tournaments/[id]/route";

describe("PUT /api/tournaments/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentUser.mockResolvedValue({
      id: "user-1",
      role: "user",
      username: "alice",
      status: "active",
      created_at: 0,
    });
    getTournamentById.mockReturnValue({
      id: "t-1",
      owner_id: "user-1",
      status: "pending",
    });
    getTournamentEntries.mockReturnValue([]);
    addEngineToTournament.mockImplementation(() => {});
    getEngineById.mockReturnValue({
      id: "e-1",
      user_id: "user-2",
      name: "Disabled Engine",
      visibility: "public",
      status: "disabled",
    });
  });

  it("rejects disabled engines even if they are public", async () => {
    const response = await PUT(
      new Request("http://localhost/api/tournaments/t-1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engineId: "e-1" }),
      }),
      { params: Promise.resolve({ id: "t-1" }) },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "引擎已被禁用",
    });
    expect(addEngineToTournament).not.toHaveBeenCalled();
  });
});
