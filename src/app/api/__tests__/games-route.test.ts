import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { searchGames } = vi.hoisted(() => ({
  searchGames: vi.fn(),
}));

vi.mock("@/db/queries", () => ({
  searchGames,
}));

import { GET } from "@/app/api/games/route";

describe("GET /api/games", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchGames.mockReturnValue({ games: [], total: 0 });
  });

  it("rejects outcome filter without engineId", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/games?outcome=win"),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Outcome filter requires engineId",
    });
    expect(searchGames).not.toHaveBeenCalled();
  });

  it("passes engine, outcome and reason filters through to searchGames", async () => {
    const response = await GET(
      new NextRequest(
        "http://localhost/api/games?engineId=e-1&outcome=loss&result=black&resultCode=time_forfeit&page=2&limit=5",
      ),
    );

    expect(response.status).toBe(200);
    expect(searchGames).toHaveBeenCalledWith({
      engineId: "e-1",
      result: "black",
      outcome: "loss",
      resultCode: "time_forfeit",
      limit: 5,
      offset: 5,
    });
    await expect(response.json()).resolves.toMatchObject({
      games: [],
      total: 0,
      page: 2,
      limit: 5,
      totalPages: 0,
    });
  });
});
