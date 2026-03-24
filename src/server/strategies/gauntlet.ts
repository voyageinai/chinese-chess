import type { TournamentStrategy, PairingConfig, TournamentFormat } from "./types";
import type { Pairing } from "../tournament";

/**
 * Gauntlet: one "challenger" engine plays against all other engines.
 * The challenger is the first engine in the list (or specified via config).
 * Each pair plays 2 games (swapping colors) per round.
 */
export class GauntletStrategy implements TournamentStrategy {
  readonly format: TournamentFormat = "gauntlet";

  isRoundBased(): boolean {
    return false;
  }

  generateAllPairings(engineIds: string[], config: PairingConfig): Pairing[] {
    if (engineIds.length < 2) return [];

    const challengerId = config.challengerEngineId || engineIds[0];
    const opponents = engineIds.filter((id) => id !== challengerId);
    const pairings: Pairing[] = [];
    let fenIndex = 0;

    for (const opp of opponents) {
      for (let r = 0; r < config.rounds; r++) {
        const fen = config.openingFens?.length
          ? config.openingFens[fenIndex++ % config.openingFens.length]
          : undefined;
        pairings.push({ red: challengerId, black: opp, startFen: fen });
        pairings.push({ red: opp, black: challengerId, startFen: fen });
      }
    }

    // Shuffle to avoid systematic bias
    for (let i = pairings.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pairings[i], pairings[j]] = [pairings[j], pairings[i]];
    }

    return pairings;
  }
}
