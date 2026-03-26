export type { TournamentStrategy, TournamentFormat, PairingConfig, RoundContext, Standing, BracketData, BracketMatch } from "./types";
export { RoundRobinStrategy } from "./round-robin";
export { GauntletStrategy } from "./gauntlet";
export { KnockoutStrategy } from "./knockout";
export { SwissStrategy } from "./swiss";

import type { TournamentFormat, TournamentStrategy } from "./types";
import { RoundRobinStrategy } from "./round-robin";
import { GauntletStrategy } from "./gauntlet";
import { KnockoutStrategy } from "./knockout";
import { SwissStrategy } from "./swiss";

export function createStrategy(format: TournamentFormat): TournamentStrategy {
  switch (format) {
    case "round_robin":
      return new RoundRobinStrategy();
    case "gauntlet":
      return new GauntletStrategy();
    case "knockout":
      return new KnockoutStrategy();
    case "swiss":
      return new SwissStrategy();
    default:
      return new RoundRobinStrategy();
  }
}
