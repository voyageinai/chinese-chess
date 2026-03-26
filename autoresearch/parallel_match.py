"""Parallel match runner for fast engine evaluation.

Runs multiple 1+1s games concurrently using ProcessPoolExecutor.
10-core machine → 4 parallel games → ~4x speedup.

Usage:
    python -m autoresearch.parallel_match engines/xiangqi-nnue-v5.js engines/xiangqi-engine-v5.js
    python -m autoresearch.parallel_match engines/xiangqi-nnue-v5.js engines/xiangqi-nnue-v6.js --games 20
"""
from __future__ import annotations

import argparse
import math
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from autoresearch.match_driver import play_game, GameResult


def _sprt_should_stop(wins: int, draws: int, losses: int,
                      elo0: float = 0.0, elo1: float = 30.0,
                      alpha: float = 0.10, beta: float = 0.10) -> str | None:
    """Sequential Probability Ratio Test for engine matches.

    Returns "accept" (engine is better), "reject" (engine is not better), or None (continue).
    Uses score-rate model: each game is a trial with score W=1, D=0.5, L=0.
    """
    n = wins + draws + losses
    if n < 6:
        return None

    def elo_to_prob(elo):
        return 1.0 / (1.0 + 10.0 ** (-elo / 400.0))

    p0 = elo_to_prob(elo0)
    p1 = elo_to_prob(elo1)

    score = wins + draws * 0.5
    s = score / n

    eps = 1e-10
    if s <= eps:
        return "reject"
    if s >= 1 - eps:
        return "accept"

    llr = n * (s * math.log(max(p1, eps) / max(p0, eps)) +
               (1 - s) * math.log(max(1 - p1, eps) / max(1 - p0, eps)))

    lower = math.log(beta / (1 - alpha))
    upper = math.log((1 - beta) / alpha)

    if llr >= upper:
        return "accept"
    if llr <= lower:
        return "reject"
    return None


def _run_single_game(args: tuple) -> dict:
    """Run a single game. Designed for ProcessPoolExecutor."""
    game_idx, engine1_cmd, engine2_cmd, our_is_red, wtime, btime, winc, binc, game_timeout = args
    try:
        r = play_game(
            engine1_cmd=engine1_cmd,
            engine2_cmd=engine2_cmd,
            wtime=wtime, btime=btime, winc=winc, binc=binc,
            game_timeout=game_timeout,
        )
        return {
            "game_idx": game_idx,
            "our_is_red": our_is_red,
            "winner": r.winner,
            "reason": r.reason,
            "move_count": r.move_count,
        }
    except Exception as e:
        return {
            "game_idx": game_idx,
            "our_is_red": our_is_red,
            "winner": "draw",
            "reason": f"error:{e}",
            "move_count": 0,
        }


def run_match(
    engine1: str,
    engine2: str,
    n_games: int = 20,
    wtime: int = 1000,
    btime: int = 1000,
    winc: int = 1000,
    binc: int = 1000,
    game_timeout: int = 300,
    workers: int = 4,
) -> dict:
    """Run a parallel match between two engines.

    engine1 is "our" engine; engine2 is the opponent.
    Games alternate colors: even = engine1 red, odd = engine1 black.

    Returns dict with win_rate, wins, draws, losses, perp_losses, details.
    """
    # Detect engine type (node vs python)
    def _cmd(engine_path: str) -> list[str]:
        if engine_path.endswith(".js"):
            return ["node", engine_path]
        return ["python3", engine_path]

    cmd1 = _cmd(engine1)
    cmd2 = _cmd(engine2)

    # Build task list
    tasks = []
    for i in range(n_games):
        if i % 2 == 0:
            e1, e2, our_red = cmd1, cmd2, True
        else:
            e1, e2, our_red = cmd2, cmd1, False
        tasks.append((i, e1, e2, our_red, wtime, btime, winc, binc, game_timeout))

    # Run in parallel
    t0 = time.time()
    results = [None] * n_games
    wins, draws, losses, perp_losses, completed = 0, 0, 0, 0, 0
    sprt_stopped = False
    with ProcessPoolExecutor(max_workers=workers) as executor:
        futures = {executor.submit(_run_single_game, task): task[0] for task in tasks}
        for future in as_completed(futures):
            r = future.result()
            results[r["game_idx"]] = r

            our_red = r["our_is_red"]
            winner = r["winner"]
            reason = r["reason"]
            is_our_win = (winner == "red" and our_red) or (winner == "black" and not our_red)
            is_draw = winner == "draw"

            if is_draw:
                draws += 1
                tag = "D"
            elif is_our_win:
                wins += 1
                tag = "W"
            else:
                losses += 1
                tag = "L"
                if "perpetual" in reason:
                    perp_losses += 1

            completed += 1
            side = "R" if our_red else "B"
            print(f"G{r['game_idx']+1:2d}[{side}]: {tag} {reason} ({r['move_count']} moves)")

            # SPRT early termination check
            n = wins + draws + losses
            score = wins + 0.5 * draws
            sprt = _sprt_should_stop(wins, draws, losses)
            if sprt == "reject":
                print(f"SPRT REJECT after {completed} games: wr={score/n:.3f}")
                sprt_stopped = True
                break

    elapsed = time.time() - t0

    total = wins + draws + losses
    wr = (wins + 0.5 * draws) / total if total > 0 else 0.0
    elo = _elo_diff(wr)

    print(f"TOTAL: W={wins} D={draws} L={losses} (perp_L={perp_losses}) "
          f"wr={wr:.3f} elo={elo:+d} [{elapsed:.1f}s, {workers} workers]")

    return {
        "win_rate": wr,
        "elo": elo,
        "wins": wins,
        "draws": draws,
        "losses": losses,
        "perp_losses": perp_losses,
        "games": total,
        "elapsed": elapsed,
        "details": results,
    }


def _elo_diff(wr: float) -> int:
    if wr >= 1.0:
        return 800
    if wr <= 0.0:
        return -800
    return int(round(400 * math.log10(wr / (1 - wr))))


def main() -> None:
    parser = argparse.ArgumentParser(description="Parallel engine match runner (1+1s)")
    parser.add_argument("engine1", help="Our engine path")
    parser.add_argument("engine2", help="Opponent engine path")
    parser.add_argument("--games", "-n", type=int, default=20)
    parser.add_argument("--wtime", type=int, default=1000)
    parser.add_argument("--btime", type=int, default=1000)
    parser.add_argument("--winc", type=int, default=1000)
    parser.add_argument("--binc", type=int, default=1000)
    parser.add_argument("--timeout", type=int, default=300)
    parser.add_argument("--workers", "-w", type=int, default=4)
    args = parser.parse_args()

    run_match(
        engine1=args.engine1,
        engine2=args.engine2,
        n_games=args.games,
        wtime=args.wtime,
        btime=args.btime,
        winc=args.winc,
        binc=args.binc,
        game_timeout=args.timeout,
        workers=args.workers,
    )


if __name__ == "__main__":
    main()
