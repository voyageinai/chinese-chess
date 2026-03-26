"use client";

import Link from "next/link";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BracketEntry {
  engine_id: string;
  engine_name: string;
  score: number;
}

interface BracketGame {
  id: string;
  red_engine_id: string;
  black_engine_id: string;
  result: "red" | "black" | "draw" | null;
  started_at: number | null;
  finished_at: number | null;
  round: number | null;
}

interface Matchup {
  engineA: string;
  engineB: string;
  scoreA: number;
  scoreB: number;
  winner: string | null;
  isTie?: boolean;        // seed tiebreak (last resort)
  hasDecider?: boolean;    // had a decider game (3rd game)
  games: BracketGame[];
  isBye?: boolean;
}

interface BracketRound {
  round: number;
  label: string;
  matchups: Matchup[];
}

interface BracketMatchData {
  round: number;
  position: number;
  engineA: string | null;
  engineB: string | null;
  winner: string | null;
  isBye: boolean;
  tiebreak: boolean;
  gameIds: string[];
}

interface BracketDataProp {
  bracketSize: number;
  totalRounds: number;
  seeds: string[];
  matches: BracketMatchData[];
}

interface BracketViewProps {
  entries: BracketEntry[];
  games: BracketGame[];
  engineMap: Record<string, string>;
  status: "pending" | "running" | "finished";
  bracketData?: BracketDataProp | null;
}

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const CARD_H = 88;
const CARD_GAP = 16;
const COL_W = 192;
const CONNECTOR_W = 32;

function getName(engineMap: Record<string, string>, id: string): string {
  return engineMap[id] ?? id.slice(0, 8);
}

function getRoundLabel(round: number, totalRounds: number): string {
  if (round === totalRounds) return "决赛";
  if (round === totalRounds - 1 && totalRounds > 2) return "半决赛";
  if (round === totalRounds - 2 && totalRounds > 3) return "1/4 决赛";
  return `第 ${round} 轮`;
}

// ---------------------------------------------------------------------------
// Data layer (unchanged logic)
// ---------------------------------------------------------------------------

function buildBracket(
  entries: BracketEntry[],
  games: BracketGame[],
  bracketData?: BracketDataProp | null,
): BracketRound[] {
  // Preferred: use persistent bracket data
  if (bracketData) {
    return buildFromBracketData(bracketData, games);
  }

  // Legacy fallback: reconstruct from games
  const n = entries.length;
  if (n < 2) return [];

  const hasRounds = games.some((g) => g.round != null);
  const totalRounds = Math.ceil(Math.log2(n));
  const bracketSize = Math.pow(2, totalRounds);
  const byeCount = bracketSize - n;

  if (hasRounds) {
    return buildFromRounds(entries, games, totalRounds, byeCount);
  }
  return buildFromFlat(entries, games, totalRounds, byeCount);
}

function buildFromBracketData(
  bracketData: BracketDataProp,
  games: BracketGame[],
): BracketRound[] {
  const { totalRounds, matches } = bracketData;
  const gameMap = new Map(games.map((g) => [g.id, g]));
  const rounds: BracketRound[] = [];

  for (let r = 1; r <= totalRounds; r++) {
    const roundMatches = matches
      .filter((m) => m.round === r)
      .sort((a, b) => a.position - b.position);

    const matchups: Matchup[] = roundMatches.map((m) => {
      if (m.isBye) {
        return {
          engineA: m.engineA ?? "",
          engineB: "",
          scoreA: 0,
          scoreB: 0,
          winner: m.winner,
          games: [],
          isBye: true,
        };
      }

      const matchGames = m.gameIds
        .map((id) => gameMap.get(id))
        .filter((g): g is BracketGame => g != null);

      let scoreA = 0;
      let scoreB = 0;
      for (const g of matchGames) {
        if (g.result === "red") {
          if (g.red_engine_id === m.engineA) scoreA++;
          else scoreB++;
        } else if (g.result === "black") {
          if (g.black_engine_id === m.engineA) scoreA++;
          else scoreB++;
        } else if (g.result === "draw") {
          scoreA += 0.5;
          scoreB += 0.5;
        }
      }

      return {
        engineA: m.engineA ?? "",
        engineB: m.engineB ?? "",
        scoreA,
        scoreB,
        winner: m.winner,
        isTie: m.tiebreak,
        hasDecider: m.gameIds.length > 2,
        games: matchGames,
      };
    });

    rounds.push({
      round: r,
      label: getRoundLabel(r, totalRounds),
      matchups,
    });
  }

  return rounds;
}

function buildFromRounds(
  entries: BracketEntry[],
  games: BracketGame[],
  totalRounds: number,
  byeCount: number,
): BracketRound[] {
  const rounds: BracketRound[] = [];
  const seeds = entries.map((e) => e.engine_id);

  const round1Games = games.filter((g) => g.round === 1);
  const round1Matchups: Matchup[] = [];

  for (let i = 0; i < byeCount; i++) {
    round1Matchups.push({
      engineA: seeds[i],
      engineB: "",
      scoreA: 0,
      scoreB: 0,
      winner: seeds[i],
      games: [],
      isBye: true,
    });
  }

  const r1Pairs = groupByMatchup(round1Games);
  for (const m of r1Pairs) round1Matchups.push(m);

  if (round1Matchups.length > 0) {
    rounds.push({
      round: 1,
      label: getRoundLabel(1, totalRounds),
      matchups: round1Matchups,
    });
  }

  for (let r = 2; r <= totalRounds; r++) {
    const roundGames = games.filter((g) => g.round === r);
    const matchups = groupByMatchup(roundGames);
    if (matchups.length > 0 || roundGames.length > 0) {
      rounds.push({
        round: r,
        label: getRoundLabel(r, totalRounds),
        matchups,
      });
    }
  }

  return rounds;
}

/**
 * Legacy path: no round data. Reconstruct bracket purely from game
 * timestamps — split into 2-game chunks per pair, then detect round
 * boundaries by tracking which engines are "busy" (haven't finished
 * their current matchup yet).
 */
function buildFromFlat(
  entries: BracketEntry[],
  games: BracketGame[],
  _totalRounds: number,
  _byeCount: number,
): BracketRound[] {
  const seeds = entries.map((e) => e.engine_id);
  if (games.length === 0) return [];

  // 1) Split games into 2-game matchup chunks, ordered by start time
  const timeSorted = [...games].sort(
    (a, b) => (a.started_at ?? 0) - (b.started_at ?? 0),
  );
  const chunks: { ids: [string, string]; games: BracketGame[]; startTime: number; endTime: number }[] = [];
  const pairBuffer = new Map<string, BracketGame[]>();

  for (const g of timeSorted) {
    const key = [g.red_engine_id, g.black_engine_id].sort().join("|");
    if (!pairBuffer.has(key)) pairBuffer.set(key, []);
    const buf = pairBuffer.get(key)!;
    buf.push(g);
    if (buf.length === 2) {
      chunks.push({
        ids: [g.red_engine_id, g.black_engine_id].sort() as [string, string],
        games: [...buf],
        startTime: Math.min(...buf.map((x) => x.started_at ?? 0)),
        endTime: Math.max(...buf.map((x) => x.finished_at ?? 0)),
      });
      pairBuffer.delete(key);
    }
  }
  for (const [, buf] of pairBuffer) {
    if (buf.length > 0) {
      chunks.push({
        ids: [buf[0].red_engine_id, buf[0].black_engine_id].sort() as [string, string],
        games: [...buf],
        startTime: Math.min(...buf.map((x) => x.started_at ?? 0)),
        endTime: Math.max(...buf.map((x) => x.finished_at ?? 0)),
      });
    }
  }

  // 2) Group chunks into rounds: a chunk belongs to a new round if
  //    any of its engines already appeared in an earlier chunk of the
  //    current round (i.e., an engine can't play twice in the same round).
  const roundGroups: typeof chunks[] = [[]];
  const currentRoundEngines = new Set<string>();

  for (const chunk of chunks) {
    const [a, b] = chunk.ids;
    if (currentRoundEngines.has(a) || currentRoundEngines.has(b)) {
      // Engine already played this round → new round
      roundGroups.push([]);
      currentRoundEngines.clear();
    }
    roundGroups[roundGroups.length - 1].push(chunk);
    currentRoundEngines.add(a);
    currentRoundEngines.add(b);
  }

  // 3) Convert chunks to matchups and build BracketRound[]
  function chunkToMatchup(chunk: typeof chunks[0]): Matchup {
    const [a, b] = chunk.ids;
    let scoreA = 0;
    let scoreB = 0;
    for (const g of chunk.games) {
      if (g.result === "red") {
        if (g.red_engine_id === a) scoreA++;
        else scoreB++;
      } else if (g.result === "black") {
        if (g.black_engine_id === a) scoreA++;
        else scoreB++;
      } else if (g.result === "draw") {
        scoreA += 0.5;
        scoreB += 0.5;
      }
    }
    const allDone = chunk.games.every((g) => g.result);
    let winner: string | null = null;
    let isTie = false;
    if (allDone && chunk.games.length > 0) {
      if (scoreA > scoreB) winner = a;
      else if (scoreB > scoreA) winner = b;
      else {
        winner = seeds.indexOf(a) < seeds.indexOf(b) ? a : b;
        isTie = true;
      }
    }
    return { engineA: a, engineB: b, scoreA, scoreB, winner, isTie, games: chunk.games };
  }

  const rounds: BracketRound[] = [];
  const actualRounds = roundGroups.filter((g) => g.length > 0);

  for (let ri = 0; ri < actualRounds.length; ri++) {
    const group = actualRounds[ri];
    const roundMatchups: Matchup[] = [];

    // Detect byes for round 1: engines not playing but appear later
    if (ri === 0) {
      const playingR1 = new Set<string>();
      for (const c of group) {
        playingR1.add(c.ids[0]);
        playingR1.add(c.ids[1]);
      }
      for (const eid of seeds) {
        if (!playingR1.has(eid)) {
          roundMatchups.push({
            engineA: eid,
            engineB: "",
            scoreA: 0,
            scoreB: 0,
            winner: eid,
            games: [],
            isBye: true,
          });
        }
      }
    }

    for (const chunk of group) {
      roundMatchups.push(chunkToMatchup(chunk));
    }

    rounds.push({
      round: ri + 1,
      label: getRoundLabel(ri + 1, actualRounds.length),
      matchups: roundMatchups,
    });
  }

  return rounds;
}

function groupByMatchup(games: BracketGame[]): Matchup[] {
  const pairMap = new Map<
    string,
    { games: BracketGame[]; ids: [string, string] }
  >();

  for (const g of games) {
    const key = [g.red_engine_id, g.black_engine_id].sort().join("|");
    if (!pairMap.has(key)) {
      pairMap.set(key, {
        games: [],
        ids: [g.red_engine_id, g.black_engine_id].sort() as [string, string],
      });
    }
    pairMap.get(key)!.games.push(g);
  }

  const matchups: Matchup[] = [];
  for (const [, pair] of pairMap) {
    const [a, b] = pair.ids;
    let scoreA = 0;
    let scoreB = 0;

    for (const g of pair.games) {
      if (g.result === "red") {
        if (g.red_engine_id === a) scoreA++;
        else scoreB++;
      } else if (g.result === "black") {
        if (g.black_engine_id === a) scoreA++;
        else scoreB++;
      } else if (g.result === "draw") {
        scoreA += 0.5;
        scoreB += 0.5;
      }
    }

    const allDone = pair.games.every((g) => g.result);
    let winner: string | null = null;
    let isTie = false;
    if (allDone && pair.games.length > 0) {
      if (scoreA > scoreB) winner = a;
      else if (scoreB > scoreA) winner = b;
      else {
        winner = a; // tie: higher seed advances
        isTie = true;
      }
    }

    matchups.push({
      engineA: a,
      engineB: b,
      scoreA,
      scoreB,
      winner,
      isTie,
      games: pair.games,
    });
  }

  return matchups;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Height of one "slot" in a given round */
function slotH(round: number): number {
  return (CARD_H + CARD_GAP) * Math.pow(2, round - 1) - CARD_GAP;
}

/** Top offset of the i-th matchup card in a round (centered in its slot) */
function cardTop(round: number, index: number): number {
  const sh = slotH(round);
  const fullSlot = sh + CARD_GAP;
  return index * fullSlot + (sh - CARD_H) / 2;
}

/** Total bracket height based on first-round matchup count */
function totalH(firstRoundCount: number): number {
  const sh = slotH(1);
  return firstRoundCount * (sh + CARD_GAP) - CARD_GAP;
}

// ---------------------------------------------------------------------------
// Render: main export
// ---------------------------------------------------------------------------

export function BracketView({
  entries,
  games,
  engineMap,
  status,
  bracketData,
}: BracketViewProps) {
  const bracket = buildBracket(entries, games, bracketData);

  if (bracket.length === 0) {
    return (
      <div className="text-center py-8 text-ink-muted">
        <p className="font-brush text-lg">暂无对局数据</p>
      </div>
    );
  }

  const firstRoundCount = bracket[0]?.matchups.length ?? 0;
  const height = totalH(firstRoundCount);

  // Champion
  const lastRound = bracket[bracket.length - 1];
  const finalMatchup = lastRound?.matchups.find((m) => !m.isBye);
  const champion = status === "finished" ? finalMatchup?.winner : null;

  return (
    <section className="space-y-5">
      <h2 className="font-brush text-2xl text-ink">淘汰赛对阵</h2>

      {/* ── Desktop: tree bracket ── */}
      <div className="hidden md:block overflow-x-auto pb-4 -mx-2 px-2">
        <div className="flex items-start" style={{ minHeight: height }}>
          {bracket.map((round, ri) => {
            const isLast = ri === bracket.length - 1;
            return (
              <div key={round.round} className="flex items-start shrink-0">
                {/* Round column */}
                <div className="flex flex-col items-center shrink-0">
                  <span className="text-xs text-ink-muted font-semibold mb-2 whitespace-nowrap">
                    {round.label}
                  </span>
                  <div className="relative" style={{ width: COL_W, height }}>
                    {round.matchups.map((matchup, mi) => (
                      <div
                        key={`${round.round}-${mi}`}
                        className="absolute"
                        style={{
                          top: cardTop(round.round, mi),
                          width: COL_W,
                          height: CARD_H,
                        }}
                      >
                        <MatchupCard matchup={matchup} engineMap={engineMap} />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Connectors between this round and next */}
                {!isLast && (
                  <div
                    className="relative shrink-0"
                    style={{ width: CONNECTOR_W, height }}
                  >
                    {Array.from({
                      length: Math.floor(round.matchups.length / 2),
                    }).map((_, ci) => {
                      const topIdx = ci * 2;
                      const botIdx = ci * 2 + 1;
                      const topCenter =
                        cardTop(round.round, topIdx) + CARD_H / 2;
                      const botCenter =
                        cardTop(round.round, botIdx) + CARD_H / 2;

                      const topMatchup = round.matchups[topIdx];
                      const botMatchup = round.matchups[botIdx];
                      const topResolved = !!topMatchup?.winner;
                      const botResolved = !!botMatchup?.winner;

                      return (
                        <div key={ci}>
                          {/* Top arm: horizontal from card → vertical down */}
                          <div
                            className="absolute"
                            style={{
                              top: topCenter,
                              left: 0,
                              width: CONNECTOR_W / 2,
                              height: (botCenter - topCenter) / 2,
                              borderRight: `2px solid`,
                              borderBottom: `2px solid`,
                              borderColor: topResolved
                                ? "var(--color-paper-400)"
                                : "var(--color-paper-300)",
                            }}
                          />
                          {/* Bottom arm: horizontal from card → vertical up */}
                          <div
                            className="absolute"
                            style={{
                              top: (topCenter + botCenter) / 2,
                              left: 0,
                              width: CONNECTOR_W / 2,
                              height: (botCenter - topCenter) / 2,
                              borderRight: `2px solid`,
                              borderTop: `2px solid`,
                              borderColor: botResolved
                                ? "var(--color-paper-400)"
                                : "var(--color-paper-300)",
                            }}
                          />
                          {/* Exit arm: horizontal to next round */}
                          <div
                            className="absolute"
                            style={{
                              top: (topCenter + botCenter) / 2,
                              left: CONNECTOR_W / 2,
                              width: CONNECTOR_W / 2,
                              height: 0,
                              borderTop: `2px solid`,
                              borderColor:
                                topResolved && botResolved
                                  ? "var(--color-paper-400)"
                                  : "var(--color-paper-300)",
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Champion badge after final round */}
                {isLast && champion && (
                  <div
                    className="flex items-center shrink-0 ml-4"
                    style={{ height }}
                  >
                    <div
                      className="border-2 border-vermilion/40 bg-vermilion/5 rounded-xl px-5 py-4 text-center"
                      style={{
                        marginTop: cardTop(round.round, 0),
                      }}
                    >
                      <p className="text-xs text-vermilion/70 mb-1">冠军</p>
                      <p className="font-brush text-xl text-vermilion">
                        {getName(engineMap, champion)}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Mobile: list fallback ── */}
      <div className="md:hidden space-y-4">
        {champion && (
          <div className="border-2 border-vermilion/40 bg-vermilion/5 rounded-xl px-4 py-3 text-center">
            <p className="text-xs text-vermilion/70 mb-1">冠军</p>
            <p className="font-brush text-xl text-vermilion">
              {getName(engineMap, champion)}
            </p>
          </div>
        )}
        {bracket.map((round) => (
          <div key={round.round}>
            <h3 className="font-brush text-lg text-ink mb-2">{round.label}</h3>
            <div className="space-y-2">
              {round.matchups.map((matchup, mi) => (
                <MatchupCard
                  key={`m-${round.round}-${mi}`}
                  matchup={matchup}
                  engineMap={engineMap}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Render: matchup card
// ---------------------------------------------------------------------------

function MatchupCard({
  matchup,
  engineMap,
}: {
  matchup: Matchup;
  engineMap: Record<string, string>;
}) {
  if (matchup.isBye) {
    return (
      <div className="h-full rounded-lg border border-dashed border-paper-300 bg-paper-50/40 flex items-center justify-between px-3">
        <span className="text-sm font-semibold text-ink truncate">
          {getName(engineMap, matchup.engineA)}
        </span>
        <span className="text-xs text-ink-muted ml-2 shrink-0">轮空晋级</span>
      </div>
    );
  }

  const isComplete = matchup.games.length > 0 && matchup.games.every((g) => g.result);
  const isInProgress = matchup.games.some((g) => g.started_at && !g.result);
  const aWins = matchup.winner === matchup.engineA;
  const bWins = matchup.winner === matchup.engineB;

  // Status label: 已结束 / 加赛晋级 / 种子晋级 / 进行中 / 待开始
  let statusLabel: string;
  if (isComplete) {
    if (matchup.isTie) statusLabel = "种子晋级";
    else if (matchup.hasDecider) statusLabel = "加赛晋级";
    else statusLabel = "已结束";
  } else if (isInProgress) {
    statusLabel = matchup.hasDecider ? "加赛中" : "进行中";
  } else {
    statusLabel = "待开始";
  }

  return (
    <div
      className={`h-full rounded-lg overflow-hidden ring-1 ${
        isComplete
          ? "ring-paper-300 bg-paper-50"
          : isInProgress
            ? "ring-vermilion/30 bg-paper-50"
            : "ring-paper-200 bg-paper-50/60"
      }`}
    >
      {/* Engine rows */}
      <div className="flex flex-col h-full">
        {/* Engine A */}
        <EngineRow
          name={getName(engineMap, matchup.engineA)}
          score={matchup.scoreA}
          isWinner={aWins && !matchup.isTie}
          isTieWinner={aWins && !!matchup.isTie}
        />

        <div className="border-t border-paper-200" />

        {/* Engine B */}
        <EngineRow
          name={getName(engineMap, matchup.engineB)}
          score={matchup.scoreB}
          isWinner={bWins && !matchup.isTie}
          isTieWinner={bWins && !!matchup.isTie}
        />

        {/* Footer */}
        <div className="border-t border-paper-200 px-2.5 py-1 flex items-center justify-between bg-paper-100/40">
          <span className="text-[11px] text-ink-muted">
            {statusLabel}
          </span>
          <div className="flex gap-1.5">
            {matchup.games.map((g, i) => {
              const isDecider = matchup.hasDecider && i === matchup.games.length - 1;
              return (
                <Link
                  key={g.id}
                  href={`/games/${g.id}`}
                  className={`text-[11px] transition-colors ${
                    isDecider
                      ? "text-vermilion/70 hover:text-vermilion font-semibold"
                      : "text-ink-muted hover:text-vermilion"
                  }`}
                >
                  {isDecider ? "决" : `G${i + 1}`}
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function EngineRow({
  name,
  score,
  isWinner,
  isTieWinner,
}: {
  name: string;
  score: number;
  isWinner: boolean;
  isTieWinner: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between px-2.5 flex-1 min-h-[28px] ${
        isWinner
          ? "bg-green-50/80 border-l-[3px] border-l-green-600"
          : isTieWinner
            ? "bg-amber-50/60 border-l-[3px] border-l-amber-500"
            : "border-l-[3px] border-l-transparent"
      }`}
    >
      <span
        className={`text-sm truncate ${
          isWinner
            ? "font-bold text-green-800"
            : isTieWinner
              ? "font-semibold text-amber-800"
              : "text-ink"
        }`}
      >
        {name}
      </span>
      <span
        className={`font-mono text-sm ml-2 tabular-nums ${
          isWinner
            ? "text-green-700 font-semibold"
            : isTieWinner
              ? "text-amber-700 font-semibold"
              : "text-ink-muted"
        }`}
      >
        {score}
      </span>
    </div>
  );
}
