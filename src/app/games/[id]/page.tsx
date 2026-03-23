"use client";

import { useEffect, useState, useCallback, useRef, use } from "react";
import { Board } from "@/components/Board";
import { MoveList } from "@/components/MoveList";
import { EvalChart } from "@/components/EvalChart";
import { Button } from "@/components/ui/button";
import {
  SkipBack,
  ChevronLeft,
  ChevronRight,
  SkipForward,
} from "lucide-react";
import { INITIAL_FEN, uciToSquare, rowOf, colOf } from "@/lib/constants";
import type { StoredMove, Game, Engine } from "@/lib/types";

function uciToLastMove(
  uci: string,
): { from: [number, number]; to: [number, number] } {
  const fromSq = uciToSquare(uci.slice(0, 2));
  const toSq = uciToSquare(uci.slice(2, 4));
  return {
    from: [rowOf(fromSq), colOf(fromSq)],
    to: [rowOf(toSq), colOf(toSq)],
  };
}

function formatTime(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export default function GamePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [game, setGame] = useState<Game | null>(null);
  const [redEngine, setRedEngine] = useState<Engine | null>(null);
  const [blackEngine, setBlackEngine] = useState<Engine | null>(null);
  const [moves, setMoves] = useState<StoredMove[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [redTime, setRedTime] = useState(0);
  const [blackTime, setBlackTime] = useState(0);
  /** Which side is currently thinking (for live clock countdown) */
  const [activeSide, setActiveSide] = useState<"red" | "black" | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch game data
  useEffect(() => {
    fetch(`/api/games/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error("Game not found");
        return r.json();
      })
      .then((data) => {
        setGame(data.game);
        setRedEngine(data.redEngine);
        setBlackEngine(data.blackEngine);
        const parsedMoves: StoredMove[] = JSON.parse(
          data.game.moves || "[]",
        );
        setMoves(parsedMoves);
        setCurrentIndex(parsedMoves.length - 1);
        setRedTime(data.game.red_time_left || 0);
        setBlackTime(data.game.black_time_left || 0);
        // If game is in progress, determine whose turn it is
        if (!data.game.result && data.game.started_at) {
          setActiveSide(parsedMoves.length % 2 === 0 ? "red" : "black");
        }
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [id]);

  // WebSocket for live updates
  useEffect(() => {
    if (!game || game.result) return; // Game is over or not loaded

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "subscribe", gameId: id }));
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "game_start" && msg.gameId === id) {
        // Game just started — red moves first
        setActiveSide("red");
      }
      if (msg.type === "move" && msg.gameId === id) {
        setMoves((prev) => {
          const next = [
            ...prev,
            { move: msg.move, fen: msg.fen, time_ms: 0, eval: msg.eval },
          ];
          // After this move, the OTHER side thinks next
          // Odd-length (1,3,5..) → red just moved → black's turn
          setActiveSide(next.length % 2 === 0 ? "red" : "black");
          return next;
        });
        setCurrentIndex((prev) => prev + 1);
        setRedTime(msg.redTime);
        setBlackTime(msg.blackTime);
      }
      if (msg.type === "game_end" && msg.gameId === id) {
        setActiveSide(null);
        setGame((prev) =>
          prev ? { ...prev, result: msg.result } : prev,
        );
      }
    };

    return () => ws.close();
  }, [id, game?.result]);

  // Live clock countdown — tick every 100ms while a side is thinking
  useEffect(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    if (!activeSide) return;

    tickRef.current = setInterval(() => {
      if (activeSide === "red") {
        setRedTime((t) => Math.max(0, t - 100));
      } else {
        setBlackTime((t) => Math.max(0, t - 100));
      }
    }, 100);

    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [activeSide]);

  // Keyboard navigation
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setCurrentIndex((prev) => Math.max(-1, prev - 1));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setCurrentIndex((prev) =>
          Math.min(moves.length - 1, prev + 1),
        );
      } else if (e.key === "Home") {
        e.preventDefault();
        setCurrentIndex(-1);
      } else if (e.key === "End") {
        e.preventDefault();
        setCurrentIndex(moves.length - 1);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [moves.length]);

  const navigate = useCallback(
    (idx: number) => {
      setCurrentIndex(Math.max(-1, Math.min(moves.length - 1, idx)));
    },
    [moves.length],
  );

  const currentFen =
    currentIndex < 0
      ? INITIAL_FEN
      : moves[currentIndex]?.fen || INITIAL_FEN;

  const lastMove =
    currentIndex >= 0 && moves[currentIndex]
      ? uciToLastMove(moves[currentIndex].move)
      : undefined;

  const redName = redEngine?.name || game?.red_engine_id || "Red";
  const blackName = blackEngine?.name || game?.black_engine_id || "Black";

  if (loading) {
    return (
      <div className="p-8 text-center text-ink-muted">
        加载中...
      </div>
    );
  }

  if (error || !game) {
    return (
      <div className="p-8 text-center text-vermilion">
        {error || "Game not found"}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-[1fr_320px] gap-6">
      {/* Left: Board area */}
      <div className="flex flex-col items-center gap-2">
        {/* Black engine info bar */}
        <div className="w-full max-w-[460px] flex items-center justify-between px-3 py-2 bg-paper-200 rounded-lg">
          <span className="font-semibold text-ink truncate">
            黑 {blackName}
          </span>
          <span className="font-mono text-lg tabular-nums">
            {formatTime(blackTime)}
          </span>
        </div>

        <Board fen={currentFen} lastMove={lastMove} />

        {/* Red engine info bar */}
        <div className="w-full max-w-[460px] flex items-center justify-between px-3 py-2 bg-vermilion/10 rounded-lg">
          <span className="font-semibold text-vermilion truncate">
            红 {redName}
          </span>
          <span className="font-mono text-lg tabular-nums">
            {formatTime(redTime)}
          </span>
        </div>
      </div>

      {/* Right: Info panel */}
      <div className="flex flex-col gap-4">
        {/* Result badge */}
        {game.result && (
          <div
            className={`text-center py-2 rounded-lg font-brush text-lg ${
              game.result === "red"
                ? "bg-vermilion/10 text-vermilion"
                : game.result === "black"
                  ? "bg-paper-300 text-ink"
                  : "bg-paper-200 text-ink-muted"
            }`}
          >
            {game.result === "red"
              ? "红胜"
              : game.result === "black"
                ? "黑胜"
                : "和棋"}
          </div>
        )}

        {/* Move list */}
        <MoveList
          moves={moves}
          currentIndex={currentIndex}
          onSelect={navigate}
        />

        {/* Eval chart */}
        <EvalChart moves={moves} currentIndex={currentIndex} />

        {/* Replay controls */}
        <div className="flex justify-center gap-2">
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => navigate(-1)}
            aria-label="First move"
          >
            <SkipBack className="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => navigate(currentIndex - 1)}
            aria-label="Previous move"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => navigate(currentIndex + 1)}
            aria-label="Next move"
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => navigate(moves.length - 1)}
            aria-label="Last move"
          >
            <SkipForward className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
