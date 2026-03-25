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

const REASON_ZH: Record<string, string> = {
  "Checkmate": "将杀",
  "Stalemate": "困毙",
  "Red lost on time": "红方超时",
  "Black lost on time": "黑方超时",
  "Red lost by perpetual check": "红方长将判负",
  "Black lost by perpetual check": "黑方长将判负",
  "Mutual perpetual check": "双方长将，判和",
  "Threefold repetition": "三次重复局面",
  "120-move rule": "120步无吃子，判和",
  "Game aborted": "对局中止",
  "Internal error": "系统异常",
  "red engine crashed": "红方引擎崩溃",
  "black engine crashed": "黑方引擎崩溃",
  "red engine failed to respond": "红方引擎无响应",
  "black engine failed to respond": "黑方引擎无响应",
  "Red engine failed to initialize": "红方引擎启动失败",
  "Black engine failed to initialize": "黑方引擎启动失败",
};

function translateReason(reason: string): string {
  if (REASON_ZH[reason]) return REASON_ZH[reason];
  // Handle dynamic reasons like "red engine made illegal move: h2e2"
  if (reason.includes("illegal move")) return reason.replace(/^(\w+) engine made illegal move:/, "$1方引擎走出非法着法:");
  if (reason.includes("invalid move")) return reason.replace(/^(\w+) engine returned invalid move:/, "$1方引擎返回无效着法:");
  return reason;
}

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

/** Which side moves at a given ply, accounting for opening_fen turn. */
function sideAtPly(ply: number, openingFen?: string | null): "red" | "black" {
  const blackFirst = openingFen?.split(" ")[1] === "b";
  return (ply % 2 === 0) === !blackFirst ? "red" : "black";
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
  const [thinkingInfo, setThinkingInfo] = useState<{
    side: "red" | "black";
    depth: number | null;
    eval: number | null;
    nodes: number | null;
    pv: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number>(0);
  const resyncPromiseRef = useRef<Promise<void> | null>(null);
  /** Timestamp of the last WS message for this game — used by polling fallback */
  const lastWsMessageRef = useRef<number>(Date.now());

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
        const side = sideAtPly(parsedMoves.length, data.game.opening_fen);
        setClock(
          side === "red" ? rTime - thinkingElapsed : rTime,
          side === "black" ? bTime - thinkingElapsed : bTime,
        );
        setActiveSide(side);
        return;
      }

      setClock(rTime, bTime);
      if (!data.game.result && data.game.started_at) {
        setActiveSide(sideAtPly(0, data.game.opening_fen));
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
        const response = await fetch(`/api/games/${id}`, { cache: "no-store" });
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
        lastWsMessageRef.current = Date.now(); // prevent polling from firing right after reconnect
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        // Track last WS activity for this game — polling fallback uses this
        if ("gameId" in msg && msg.gameId === id) {
          lastWsMessageRef.current = Date.now();
        }
        if (msg.type === "game_start" && msg.gameId === id) {
          setClock(msg.redTime, msg.blackTime);
          // Determine first mover from startFen if provided
          if (msg.startFen) {
            const parts = msg.startFen.split(" ");
            setActiveSide(parts[1] === "b" ? "black" : "red");
          } else {
            setActiveSide("red");
          }
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
              depth: msg.depth ?? null,
            },
          ];
          movesRef.current = next;
          setMoves(next);
          setCurrentIndex(msg.ply - 1);

          const nextSide = sideAtPly(msg.ply, game?.opening_fen);

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
        if (msg.type === "engine_thinking" && msg.gameId === id) {
          setThinkingInfo({
            side: msg.side,
            depth: msg.depth,
            eval: msg.eval,
            nodes: msg.nodes,
            pv: msg.pv,
          });
        }
        if (msg.type === "game_end" && msg.gameId === id) {
          setActiveSide(null);
          setThinkingInfo(null);
          setGame((prev) =>
            prev ? { ...prev, result: msg.result, result_reason: msg.reason } : prev,
          );
          // Fetch complete final state — ensures all moves and clocks are correct
          // even if some move messages were lost before game_end
          requestResync();
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
  }, [canSubscribe, game?.opening_fen, id, requestResync]);

  // --- Resync on tab visibility change ---
  // When the user switches back to this tab, the rAF clock may have drifted
  // (capped at 200ms per frame) and WS messages may have been throttled/dropped.
  useEffect(() => {
    if (!canSubscribe) return;

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        lastFrameRef.current = performance.now(); // prevent clock jump
        requestResync();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [canSubscribe, requestResync]);

  // --- Polling fallback for silent WS failures ---
  // If no WS message arrives for 5 seconds during an active game, fetch via HTTP.
  // This catches cases where the WS connection appears alive but messages are lost
  // (tab backgrounding, proxy buffering, network micro-outages).
  useEffect(() => {
    if (!canSubscribe) return;

    const POLL_FALLBACK_MS = 5_000;
    const timer = setInterval(() => {
      if (Date.now() - lastWsMessageRef.current >= POLL_FALLBACK_MS) {
        requestResync();
        lastWsMessageRef.current = Date.now(); // prevent hammering
      }
    }, POLL_FALLBACK_MS);

    return () => clearInterval(timer);
  }, [canSubscribe, requestResync]);

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

  const baseFen = game?.opening_fen || INITIAL_FEN;
  const currentFen =
    currentIndex < 0
      ? baseFen
      : moves[currentIndex]?.fen || baseFen;

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

        {/* Engine thinking info (live) */}
        {thinkingInfo && !game.result && (
          <div className="w-full max-w-[460px] px-3 py-2 bg-paper-200/50 rounded-lg">
            <div className="flex items-center gap-2 text-xs font-mono text-ink-muted">
              <span className={thinkingInfo.side === "red" ? "text-vermilion" : "text-ink"}>
                {thinkingInfo.side === "red" ? "红" : "黑"}
              </span>
              {thinkingInfo.depth != null && <span>D{thinkingInfo.depth}</span>}
              {thinkingInfo.nodes != null && (
                <span>{thinkingInfo.nodes > 1000000
                  ? `${(thinkingInfo.nodes / 1000000).toFixed(1)}M`
                  : thinkingInfo.nodes > 1000
                    ? `${(thinkingInfo.nodes / 1000).toFixed(0)}K`
                    : thinkingInfo.nodes} 节点</span>
              )}
              {thinkingInfo.eval != null && (
                <span className={thinkingInfo.eval > 0 ? "text-vermilion" : thinkingInfo.eval < 0 ? "text-ink" : ""}>
                  {thinkingInfo.eval > 0 ? "+" : ""}{(thinkingInfo.eval / 100).toFixed(2)}
                </span>
              )}
            </div>
            {thinkingInfo.pv && (
              <p className="text-xs font-mono text-ink-muted/70 mt-1 truncate">
                {thinkingInfo.pv}
              </p>
            )}
          </div>
        )}
        {/* Stored depth for replay (non-live) */}
        {(game.result || !thinkingInfo) && currentIndex >= 0 && moves[currentIndex]?.depth != null && (
          <div className="w-full max-w-[460px] text-center text-xs text-ink-muted font-mono py-1">
            深度 {moves[currentIndex].depth}
          </div>
        )}
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
            {game.result_reason && (
              <span className="block text-sm font-sans text-ink-muted mt-1">
                {translateReason(game.result_reason)}
              </span>
            )}
          </div>
        )}

        {/* Move list */}
        <MoveList
          moves={moves}
          currentIndex={currentIndex}
          onSelect={navigate}
          blackMovesFirst={game?.opening_fen?.split(" ")[1] === "b"}
        />

        {/* Eval chart */}
        <EvalChart moves={moves} currentIndex={currentIndex} />

        {/* Replay controls */}
        <div className="flex justify-center gap-2 sticky bottom-0 z-10 bg-paper-100/90 backdrop-blur-sm py-3 -mx-1 px-1 md:static md:bg-transparent md:backdrop-blur-none md:py-0 md:mx-0 md:px-0">
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
