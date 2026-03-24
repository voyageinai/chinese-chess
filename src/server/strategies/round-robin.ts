import type { TournamentStrategy, PairingConfig, TournamentFormat } from "./types";
import { generateRoundRobinPairings, type Pairing } from "../tournament";

export class RoundRobinStrategy implements TournamentStrategy {
  readonly format: TournamentFormat = "round_robin";

  isRoundBased(): boolean {
    return false;
  }

  generateAllPairings(engineIds: string[], config: PairingConfig): Pairing[] {
    return generateRoundRobinPairings(engineIds, config.rounds, config.openingFens);
  }
}
