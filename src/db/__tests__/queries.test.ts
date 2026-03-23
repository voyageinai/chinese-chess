import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { getDb, closeDb } from "../index";
import {
  createUser,
  getUserByUsername,
  getUserById,
  createEngine,
  getEnginesByUser,
  getEngineById,
  deleteEngine,
  updateEngineElo,
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
    expect((fetched as Record<string, unknown>)["password"]).toBeUndefined();
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
  });

  it("deletes an engine", () => {
    const user = createUser("alice", "hashedpw1");
    const engine = createEngine(user.id, "PikafishV1", "/bin/pikafish");
    deleteEngine(engine.id);
    expect(getEngineById(engine.id)).toBeUndefined();
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
});

describe("Tournaments", () => {
  it("creates and lists tournaments", () => {
    const t = createTournament("Spring Open", 300, 5, 2);
    expect(t.name).toBe("Spring Open");
    expect(t.status).toBe("pending");
    expect(t.time_control_base).toBe(300);
    expect(t.time_control_inc).toBe(5);
    expect(t.rounds).toBe(2);

    const all = getTournaments();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(t.id);
  });

  it("updates tournament status", () => {
    const t = createTournament("Spring Open", 300, 5);
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
    const t = createTournament("Cup", 180, 2);

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
    const t = createTournament("Match", 60, 0);
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
    updateGameResult(game.id, "red", movesJson, 50, 45);

    const finished = getGameById(game.id)!;
    expect(finished.result).toBe("red");
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
});
