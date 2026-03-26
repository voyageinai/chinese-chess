import { NextRequest, NextResponse } from "next/server";
import { searchGames } from "@/db/queries";
import {
  RESULT_CODE_LABELS_ZH,
  getGameResultLabel,
  getEngineOutcomeLabel,
  translateResult,
} from "@/lib/results";
import type { EngineOutcome } from "@/lib/results";
import type { ResultCode } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const engineId = searchParams.get("engineId") || undefined;
    const rawResult = searchParams.get("result");
    const rawOutcome = searchParams.get("outcome");
    const rawResultCode = searchParams.get("resultCode");
    const result =
      rawResult === "red" || rawResult === "black" || rawResult === "draw"
        ? rawResult
        : undefined;
    const outcome =
      rawOutcome === "win" || rawOutcome === "loss" || rawOutcome === "draw"
        ? (rawOutcome as EngineOutcome)
        : undefined;
    const resultCode =
      rawResultCode && rawResultCode in RESULT_CODE_LABELS_ZH
        ? (rawResultCode as ResultCode)
        : undefined;
    const format = searchParams.get("format") || "json";

    if (rawResult && !result) {
      return NextResponse.json({ error: "Invalid result filter" }, { status: 400 });
    }
    if (rawOutcome && !outcome) {
      return NextResponse.json({ error: "Invalid outcome filter" }, { status: 400 });
    }
    if (rawResultCode && !resultCode) {
      return NextResponse.json({ error: "Invalid resultCode filter" }, { status: 400 });
    }
    if (outcome && !engineId) {
      return NextResponse.json(
        { error: "Outcome filter requires engineId" },
        { status: 400 },
      );
    }

    // Export up to 1000 games
    const { games } = searchGames({
      engineId,
      result,
      outcome,
      resultCode,
      limit: 1000,
      offset: 0,
    });

    if (format === "json") {
      const exportData = games.map(g => ({
        id: g.id,
        red: g.red_engine_name,
        black: g.black_engine_name,
        result: g.result,
        result_label: g.result ? getGameResultLabel(g.result) : null,
        engine_side: g.engine_side,
        engine_outcome: g.engine_outcome,
        engine_outcome_label: g.engine_outcome
          ? getEngineOutcomeLabel(g.engine_outcome)
          : null,
        result_code: g.result_code,
        result_reason: g.result_reason,
        result_reason_zh: translateResult(
          g.result_code,
          g.result_reason,
          g.result_detail,
        ),
        result_detail: g.result_detail,
        opening_fen: g.opening_fen,
        moves: JSON.parse(g.moves || "[]"),
        finished_at: g.finished_at,
      }));

      return new NextResponse(JSON.stringify(exportData, null, 2), {
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="games-export-${Date.now()}.json"`,
        },
      });
    }

    // PGN-like format
    const lines: string[] = [];
    for (const g of games) {
      const resultValue = g.result ?? "draw";
      const resultLabel = getGameResultLabel(resultValue);
      lines.push(`[Event "Chinese Chess Engine Match"]`);
      lines.push(`[Red "${g.red_engine_name}"]`);
      lines.push(`[Black "${g.black_engine_name}"]`);
      lines.push(`[Result "${resultValue === "red" ? "1-0" : resultValue === "black" ? "0-1" : "1/2-1/2"}"]`);
      lines.push(`[ResultLabel "${resultLabel}"]`);
      if (g.engine_side) lines.push(`[EngineSide "${g.engine_side}"]`);
      if (g.engine_outcome) lines.push(`[EngineOutcome "${g.engine_outcome}"]`);
      if (g.result_code) lines.push(`[TerminationCode "${g.result_code}"]`);
      if (g.result_reason) lines.push(`[Termination "${g.result_reason}"]`);
      if (g.result_code || g.result_reason) {
        lines.push(
          `[TerminationZh "${translateResult(g.result_code, g.result_reason, g.result_detail).replaceAll('"', '\\"')}"]`,
        );
      }
      if (g.result_detail) lines.push(`[TerminationDetail "${g.result_detail.replaceAll('"', '\\"')}"]`);
      if (g.opening_fen) lines.push(`[FEN "${g.opening_fen}"]`);
      lines.push("");
      const moves = JSON.parse(g.moves || "[]") as { move: string }[];
      const blackFirst = g.opening_fen?.split(" ")[1] === "b";
      const moveStr = moves.map((m, i) => {
        if (blackFirst) {
          if (i === 0) return `1. ... ${m.move}`;
          const num = Math.floor((i - 1) / 2) + 2;
          return (i - 1) % 2 === 0 ? `${num}. ${m.move}` : m.move;
        }
        const num = Math.floor(i / 2) + 1;
        return i % 2 === 0 ? `${num}. ${m.move}` : m.move;
      }).join(" ");
      lines.push(moveStr);
      lines.push("");
      lines.push("");
    }

    return new NextResponse(lines.join("\n"), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="games-export-${Date.now()}.pgn"`,
      },
    });
  } catch (error) {
    console.error("Export games error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
