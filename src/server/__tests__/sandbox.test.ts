import fs from "fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getTournamentEntries,
  getEngineById,
  deleteSandboxTournament,
  hardDeleteEngine,
} = vi.hoisted(() => ({
  getTournamentEntries: vi.fn(),
  getEngineById: vi.fn(),
  deleteSandboxTournament: vi.fn(),
  hardDeleteEngine: vi.fn(),
}));

vi.mock("@/db/queries", () => ({
  getTournamentEntries,
  getEngineById,
  deleteSandboxTournament,
  hardDeleteEngine,
}));

import { cleanupSandboxTournamentResources } from "@/server/sandbox";

describe("cleanupSandboxTournamentResources", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTournamentEntries.mockReturnValue([
      { engine_id: "sandbox-engine" },
      { engine_id: "normal-engine" },
    ]);
    getEngineById.mockImplementation((engineId: string) => {
      if (engineId === "sandbox-engine") {
        return {
          id: "sandbox-engine",
          user_id: "__sandbox__",
          binary_path: "/tmp/sandbox/engine.bin",
        };
      }
      if (engineId === "normal-engine") {
        return {
          id: "normal-engine",
          user_id: "user-1",
          binary_path: "/tmp/user/engine.bin",
        };
      }
      return undefined;
    });
  });

  it("removes tournament data and sandbox-owned engines", () => {
    const rmSyncSpy = vi.spyOn(fs, "rmSync").mockImplementation(() => undefined);

    cleanupSandboxTournamentResources("t-1");

    expect(deleteSandboxTournament).toHaveBeenCalledWith("t-1");
    expect(rmSyncSpy).toHaveBeenCalledWith("/tmp/sandbox", { recursive: true, force: true });
    expect(hardDeleteEngine).toHaveBeenCalledWith("sandbox-engine");
    expect(hardDeleteEngine).not.toHaveBeenCalledWith("normal-engine");

    rmSyncSpy.mockRestore();
  });
});
