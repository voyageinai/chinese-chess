import fs from "fs";
import path from "path";
import * as queries from "@/db/queries";
import type { Engine } from "@/lib/types";
import { SANDBOX_USER_ID } from "@/lib/service-users";

function getSandboxEnginesForTournament(tournamentId: string): Engine[] {
  const seen = new Set<string>();
  const sandboxEngines: Engine[] = [];

  for (const entry of queries.getTournamentEntries(tournamentId)) {
    if (seen.has(entry.engine_id)) continue;
    seen.add(entry.engine_id);

    const engine = queries.getEngineById(entry.engine_id);
    if (engine?.user_id === SANDBOX_USER_ID) {
      sandboxEngines.push(engine);
    }
  }

  return sandboxEngines;
}

export function cleanupSandboxTournamentResources(tournamentId: string): void {
  const sandboxEngines = getSandboxEnginesForTournament(tournamentId);

  queries.deleteSandboxTournament(tournamentId);

  for (const engine of sandboxEngines) {
    try {
      fs.rmSync(path.dirname(engine.binary_path), { recursive: true, force: true });
    } catch (error) {
      console.error(`[sandbox] Failed to remove files for engine ${engine.id}:`, error);
    }

    try {
      queries.hardDeleteEngine(engine.id);
    } catch (error) {
      console.error(`[sandbox] Failed to delete engine ${engine.id}:`, error);
    }
  }
}
