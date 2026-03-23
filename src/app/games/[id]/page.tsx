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
  // --- Clock state: refs are the source of truth, state is for rendering ---
  const clockRef = useRef({ red: 0, black: 0 });
  const movesRef = useRef<StoredMove[]>([]);
  const [redTime, setRedTime] = useState(0);
  const [blackTime, setBlackTime] = useState(0);
  /** Which side is currently thinking (for live clock countdown), null = stopped */
  const activeSideRef = useRef<"red" | "black" | null>(null);
  const [, forceRender] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number>(0);
  const resyncPromiseRef = useRef<Promise<void> | null>(null);

  /** Update clock refs and sync to React state for display */
  function setClock(red: number, black: number) {
    const nextRed = Math.max(0, red);
    const nextBlack = Math.max(0, black);
    clockRef.current.red = nextRed;
    clockRef.current.black = nextBlack;
    setRedTime(nextRed);
    setBlackTime(nextBlack);
  }

  function setActiveSide(side: "red" | "black" | null) {
    activeSideRef.current = side;
    lastFrameRef.current = performance.now();
    forceRender((n) => n + 1);
  }

  const applySnapshot = useCallback(
    (data: {
      game: Game;
      redEngine: Engine | null;
      blackEngine: Engine | null;
    }) => {
      const parsedMoves: StoredMove[] = JSON.parse(data.game.moves || "[]");

      if (parsedMoves.length < movesRef.current.length) {
        return;
      }

      setGame(data.game);
      setRedEngine(data.redEngine);
      setBlackEngine(data.blackEngine);
      movesRef.current = parsedMoves;
      setMoves(parsedMoves);
      setCurrentIndex(parsedMoves.length - 1);

      const rTime = data.game.red_time_left || 0;
      const bTime = data.game.black_time_left || 0;

      if (!data.game.result && data.game.started_at && parsedMoves.length > 0) {
        // Late joiner: estimate how long the current engine has been thinking.
        // DB times are from the last completed move; compute wall-clock elapsed since.
        const totalMoveMs = parsedMoves.reduce(
          (sum: number, m: StoredMove) => sum + (m.time_ms || 0),
          0,
        );
        const wallElapsed = (Date.now() / 1000 - data.game.started_at) * 1000;
        const thinkingElapsed = Math.max(0, wallElapsed - totalMoveMs);
        const side = parsedMoves.length % 2 === 0 ? "red" : "black";
        setClock(
          side === "red" ? rTime - thinkingElapsed : rTime,
          side === "black" ? bTime - thinkingElapsed : bTime,
        );
        setActiveSide(side);
        return;
      }

      setClock(rTime, bTime);
      if (!data.game.result && data.game.started_at) {
        setActiveSide("red");
      } else {
        setActiveSide(null);
      }
    },
    [],
  );

  const loadSnapshot = useCallback(
    async (showSpinner: boolean) => {
      if (showSpinner) setLoading(true);

      try {
        const response = await fetch(`/api/games/${id}`);
        if (!response.ok) throw new Error("Game not found");
        const data = await response.json();
        applySnapshot(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Load failed");
      } finally {
        if (showSpinner) setLoading(false);
      }
    },
    [applySnapshot, id],
  );

  const requestResync = useCallback(() => {
    if (!resyncPromiseRef.current) {
      resyncPromiseRef.current = loadSnapshot(false).finally(() => {
        resyncPromiseRef.current = null;
      });
    }
  }, [loadSnapshot]);

  // Fetch game data
  useEffect(() => {
    void loadSnapshot(true);
  }, [loadSnapshot]);

  // WebSocket for live updates with auto-reconnect
  const canSubscribe = !loading && !!game && !game.result;
  useEffect(() => {
    if (!canSubscribe) return;

    let disposed = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectDelay = 1000; // start at 1s, exponential backoff up to 10s
    const MAX_RECONNECT_DELAY = 10_000;

    function connect() {
      if (disposed) return;

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

      ws.onopen = () => {
        console.log("[ws] connected");
        reconnectDelay = 1000; // reset backoff on successful connect
        ws!.send(JSON.stringify({ type: "subscribe", gameId: id }));
        requestResync();
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === "game_start" && msg.gameId === id) {
          setClock(msg.redTime, msg.blackTime);
          setActiveSide("red");
        }
        if (msg.type === "move" && msg.gameId === id) {
          const currentPly = movesRef.current.length;

          if (msg.ply <= currentPly) {
            return;
          }

          if (msg.ply > currentPly + 1) {
            requestResync();
            return;
          }

          const next = [
            ...movesRef.current,
            {
              move: msg.move,
              fen: msg.fen,
              time_ms: msg.timeMs,
              eval: msg.eval,
            },
          ];
          movesRef.current = next;
          setMoves(next);
          setCurrentIndex(msg.ply - 1);

          const nextSide = msg.ply % 2 === 0 ? "red" : "black";

          // Compensate for network delay: the server included movedAt timestamp,
          // so we know how stale the clock values are. Subtract the lag from
          // the side that is NOW thinking (they've already been thinking for `lag` ms).
          const lag = Math.max(0, Date.now() - msg.movedAt);
          setClock(
            nextSide === "red" ? msg.redTime - lag : msg.redTime,
            nextSide === "black" ? msg.blackTime - lag : msg.blackTime,
          );
          setActiveSide(nextSide);
        }
        if (msg.type === "game_end" && msg.gameId === id) {
          setActiveSide(null);
          setGame((prev) =>
            prev ? { ...prev, result: msg.result } : prev,
          );
        }
      };

      ws.onclose = () => {
        if (disposed) return;
        console.log(`[ws] disconnected, reconnecting in ${reconnectDelay}ms...`);
        scheduleReconnect();
      };

      ws.onerror = () => {
        // onclose will fire after onerror, so just log here
        console.warn("[ws] connection error");
      };
    }

    function scheduleReconnect() {
      if (disposed || reconnectTimer) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        reconnectDelay = Math.min(reconnectDelay * 1.5, MAX_RECONNECT_DELAY);
        connect();
      }, reconnectDelay);
    }

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) ws.close();
    };
  }, [canSubscribe, id, requestResync]);

  // --- requestAnimationFrame clock countdown ---
  // Uses delta time for accuracy; caps at 200ms to handle tab backgrounding.
  useEffect(() => {
    function tick(now: number) {
      const side = activeSideRef.current;
      if (side) {
        const delta = Math.min(now - lastFrameRef.current, 200);
        lastFrameRef.current = now;
        const clk = clockRef.current;
        if (side === "red") {
          clk.red = Math.max(0, clk.red - delta);
          setRedTime(clk.red);
        } else {
          clk.black = Math.max(0, clk.black - delta);
          setBlackTime(clk.black);
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

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
