import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { getDb, closeDb, ensureSandboxUser } from "../index";
import {
  createUser,
  getUserByUsername,
  getUserById,
  getAllUsers,
  createEngine,
  getEnginesByUser,
  getVisibleEngines,
  getEngineById,
  softDeleteEngine,
  isEngineInRunningTournament,
  updateEngineElo,
  updateEngineStatus,
  getLeaderboard,
  createTournament,
  getTournaments,
  getTournamentById,
  updateTournamentStatus,
  addEngineToTournament,
  getTournamentEntries,
  updateTournamentEntry,
  createGame,
  updateGameResult,
  updateGameStarted,
  getGameById,
  getGamesByTournament,
  getActiveGames,
  searchGames,
} from "../queries";

const TEST_DB = path.join(__dirname, "test.db");

beforeEach(() => {
  // Initialize a fresh database for each test
  getDb(TEST_DB);
});

afterEach(() => {
  closeDb();
  // Clean up the test database files
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = TEST_DB + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
});

describe("Users", () => {
  it("first user becomes admin", () => {
    const user = createUser("alice", "hashedpw1");
    expect(user.username).toBe("alice");
    expect(user.role).toBe("admin");
  });

  it("second user is regular user", () => {
    createUser("alice", "hashedpw1");
    const bob = createUser("bob", "hashedpw2");
    expect(bob.role).toBe("user");
  });

  it("getUserByUsername returns row with password", () => {
    createUser("alice", "hashedpw1");
    const row = getUserByUsername("alice");
    expect(row).toBeDefined();
    expect(row!.password).toBe("hashedpw1");
  });

  it("getUserById strips password", () => {
    const user = createUser("alice", "hashedpw1");
    const fetched = getUserById(user.id);
    expect(fetched).toBeDefined();
    expect(fetched!.username).toBe("alice");
    expect((fetched as unknown as Record<string, unknown>)["password"]).toBeUndefined();
  });

  it("first human user still becomes admin after sandbox user exists", () => {
    ensureSandboxUser(getDb(TEST_DB));
    const user = createUser("alice", "hashedpw1");
    expect(user.role).toBe("admin");
  });

  it("does not include service users in user listings", () => {
    ensureSandboxUser(getDb(TEST_DB));
    expect(getAllUsers()).toEqual([]);
  });
});

describe("Engines", () => {
  it("creates and retrieves engines", () => {
    const user = createUser("alice", "hashedpw1");
    const engine = createEngine(user.id, "PikafishV1", "/bin/pikafish");
    expect(engine.name).toBe("PikafishV1");
    expect(engine.elo).toBe(1500);
    expect(engine.games_played).toBe(0);

    const byId = getEngineById(engine.id);
    expect(byId).toEqual(engine);

    const byUser = getEnginesByUser(user.id);
    expect(byUser).toHaveLength(1);
    expect(byUser[0].id).toBe(engine.id);

    const visible = getVisibleEngines();
    expect(visible).toHaveLength(1);
    expect(visible[0].id).toBe(engine.id);
  });

  it("soft-deletes an engine (sets status to disabled)", () => {
    const user = createUser("alice", "hashedpw1");
    const engine = createEngine(user.id, "PikafishV1", "/bin/pikafish");
    softDeleteEngine(engine.id);
    const deleted = getEngineById(engine.id);
    expect(deleted).toBeDefined();
    expect(deleted!.status).toBe("disabled");
  });

  it("soft-deleted engine disappears from leaderboard but remains queryable", () => {
    const user = createUser("alice", "hashedpw1");
    const engine = createEngine(user.id, "PikafishV1", "/bin/pikafish");
    softDeleteEngine(engine.id);
    expect(getLeaderboard()).toHaveLength(0);
    expect(getEngineById(engine.id)).toBeDefined();
  });

  it("updates engine elo", () => {
    const user = createUser("alice", "hashedpw1");
    const engine = createEngine(user.id, "PikafishV1", "/bin/pikafish");
    updateEngineElo(engine.id, 1600, 5);
    const updated = getEngineById(engine.id);
    expect(updated!.elo).toBe(1600);
    expect(updated!.games_played).toBe(5);
  });

  it("returns leaderboard with owner", () => {
    const alice = createUser("alice", "hashedpw1");
    const bob = createUser("bob", "hashedpw2");
    createEngine(alice.id, "AliceEngine", "/bin/a");
    const eng2 = createEngine(bob.id, "BobEngine", "/bin/b");
    updateEngineElo(eng2.id, 1600, 1);

    const lb = getLeaderboard();
    expect(lb).toHaveLength(2);
    // Sorted by elo desc — BobEngine first
    expect(lb[0].name).toBe("BobEngine");
    expect(lb[0].owner).toBe("bob");
    expect(lb[1].name).toBe("AliceEngine");
    expect(lb[1].owner).toBe("alice");
  });

  it("filters owned engines by status when requested", () => {
    const user = createUser("alice", "hashedpw1");
    const activeEngine = createEngine(user.id, "ActiveEngine", "/bin/a");
    const disabledEngine = createEngine(user.id, "DisabledEngine", "/bin/b");

    updateEngineStatus(disabledEngine.id, "disabled");

    const activeOnly = getEnginesByUser(user.id, "active");
    const disabledOnly = getEnginesByUser(user.id, "disabled");
    const all = getEnginesByUser(user.id);

    expect(activeOnly).toHaveLength(1);
    expect(activeOnly[0].id).toBe(activeEngine.id);
    expect(disabledOnly).toHaveLength(1);
    expect(disabledOnly[0].id).toBe(disabledEngine.id);
    expect(all).toHaveLength(2);
  });

  it("only blocks deletion for engines in running tournaments", () => {
    const user = createUser("alice", "hashedpw1");
    const engine = createEngine(user.id, "PikafishV1", "/bin/pikafish");
    const opponent = createEngine(user.id, "PikafishV2", "/bin/pikafish2");
    const tournament = createTournament(user.id, "Cup", 60, 0);

    // Not in any tournament
    expect(isEngineInRunningTournament(engine.id)).toBe(false);

    // In a pending tournament — should NOT block
    addEngineToTournament(tournament.id, engine.id);
    addEngineToTournament(tournament.id, opponent.id);
    expect(isEngineInRunningTournament(engine.id)).toBe(false);

    // In a running tournament — should block
    updateTournamentStatus(tournament.id, "running");
    expect(isEngineInRunningTournament(engine.id)).toBe(true);

    // Tournament finished — should NOT block
    updateTournamentStatus(tournament.id, "finished");
    expect(isEngineInRunningTournament(engine.id)).toBe(false);
  });
});

describe("Tournaments", () => {
  it("creates and lists tournaments", () => {
    const user = createUser("alice", "hashedpw1");
    const t = createTournament(user.id, "Spring Open", 300, 5, 2);
    expect(t.name).toBe("Spring Open");
    expect(t.owner_id).toBe(user.id);
    expect(t.status).toBe("pending");
    expect(t.time_control_base).toBe(300);
    expect(t.time_control_inc).toBe(5);
    expect(t.rounds).toBe(2);

    const all = getTournaments();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(t.id);
  });

  it("updates tournament status", () => {
    const user = createUser("alice", "hashedpw1");
    const t = createTournament(user.id, "Spring Open", 300, 5);
    updateTournamentStatus(t.id, "running");
    expect(getTournamentById(t.id)!.status).toBe("running");

    updateTournamentStatus(t.id, "finished");
    const finished = getTournamentById(t.id)!;
    expect(finished.status).toBe("finished");
    expect(finished.finished_at).not.toBeNull();
  });
});

describe("Tournament Entries", () => {
  it("adds engines to tournament and updates entries", () => {
    const user = createUser("alice", "hashedpw1");
    const e1 = createEngine(user.id, "Engine1", "/bin/e1");
    const e2 = createEngine(user.id, "Engine2", "/bin/e2");
    const t = createTournament(user.id, "Cup", 180, 2);

    addEngineToTournament(t.id, e1.id);
    addEngineToTournament(t.id, e2.id);

    const entries = getTournamentEntries(t.id);
    expect(entries).toHaveLength(2);
    expect(entries[0].score).toBe(0);

    updateTournamentEntry(t.id, e1.id, 3, 1);
    updateTournamentEntry(t.id, e2.id, 1, 2);

    const updated = getTournamentEntries(t.id);
    // Ordered by score desc
    expect(updated[0].engine_id).toBe(e1.id);
    expect(updated[0].score).toBe(3);
    expect(updated[0].final_rank).toBe(1);
    expect(updated[1].engine_id).toBe(e2.id);
    expect(updated[1].score).toBe(1);
    expect(updated[1].final_rank).toBe(2);
  });
});

describe("Games", () => {
  it("creates and updates game results", () => {
    const user = createUser("alice", "hashedpw1");
    const e1 = createEngine(user.id, "Red", "/bin/r");
    const e2 = createEngine(user.id, "Black", "/bin/b");
    const t = createTournament(user.id, "Match", 60, 0);
    addEngineToTournament(t.id, e1.id);
    addEngineToTournament(t.id, e2.id);

    const game = createGame(t.id, e1.id, e2.id);
    expect(game.result).toBeNull();
    expect(game.moves).toBe("[]");
    expect(game.started_at).toBeNull();

    // Mark started
    updateGameStarted(game.id);
    const started = getGameById(game.id)!;
    expect(started.started_at).not.toBeNull();

    // Active games
    const active = getActiveGames();
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(game.id);

    // Finish game
    const movesJson = JSON.stringify([{ move: "h2e2", fen: "...", time_ms: 100, eval: null }]);
    updateGameResult(game.id, "red", "checkmate", "Checkmate", null, movesJson, 50, 45);

    const finished = getGameById(game.id)!;
    expect(finished.result).toBe("red");
    expect(finished.result_code).toBe("checkmate");
    expect(finished.moves).toBe(movesJson);
    expect(finished.red_time_left).toBe(50);
    expect(finished.black_time_left).toBe(45);
    expect(finished.finished_at).not.toBeNull();

    // No longer active
    expect(getActiveGames()).toHaveLength(0);

    // Games by tournament
    const byTournament = getGamesByTournament(t.id);
    expect(byTournament).toHaveLength(1);
  });

  it("searches games by engine outcome and result code", () => {
    const user = createUser("alice", "hashedpw1");
    const e1 = createEngine(user.id, "Alpha", "/bin/a");
    const e2 = createEngine(user.id, "Beta", "/bin/b");
    const e3 = createEngine(user.id, "Gamma", "/bin/c");
    const t = createTournament(user.id, "Match", 60, 0);
    addEngineToTournament(t.id, e1.id);
    addEngineToTournament(t.id, e2.id);
    addEngineToTournament(t.id, e3.id);

    const g1 = createGame(t.id, e1.id, e2.id);
    const g2 = createGame(t.id, e2.id, e1.id);
    const g3 = createGame(t.id, e1.id, e3.id);

    updateGameResult(
      g1.id,
      "red",
      "checkmate",
      "Checkmate",
      null,
      "[]",
      50,
      45,
    );
    updateGameResult(
      g2.id,
      "black",
      "time_forfeit",
      "Red lost on time",
      JSON.stringify({ side: "red" }),
      "[]",
      40,
      52,
    );
    updateGameResult(
      g3.id,
      "draw",
      "repetition",
      "Repeated position",
      null,
      "[]",
      30,
      30,
    );

    const { games: allGames } = searchGames({ engineId: e1.id, limit: 10, offset: 0 });
    expect(allGames).toHaveLength(3);

    const alphaAsRed = allGames.find((g) => g.id === g1.id);
    expect(alphaAsRed?.engine_side).toBe("red");
    expect(alphaAsRed?.engine_outcome).toBe("win");

    const alphaAsBlack = allGames.find((g) => g.id === g2.id);
    expect(alphaAsBlack?.engine_side).toBe("black");
    expect(alphaAsBlack?.engine_outcome).toBe("win");

    const alphaDraw = allGames.find((g) => g.id === g3.id);
    expect(alphaDraw?.engine_outcome).toBe("draw");

    const { games: wins } = searchGames({
      engineId: e1.id,
      outcome: "win",
      limit: 10,
      offset: 0,
    });
    expect(wins).toHaveLength(2);
    expect(wins.every((g) => g.engine_outcome === "win")).toBe(true);

    const { games: byReason } = searchGames({
      engineId: e1.id,
      resultCode: "checkmate",
      limit: 10,
      offset: 0,
    });
    expect(byReason).toHaveLength(1);
    expect(byReason[0].id).toBe(g1.id);
  });

  it("rejects engine outcome filters without engineId", () => {
    expect(() =>
      searchGames({ outcome: "win", limit: 10, offset: 0 }),
    ).toThrow("searchGames outcome filter requires engineId");
  });
});
