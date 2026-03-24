import { NextRequest, NextResponse } from "next/server";
import { searchGames } from "@/db/queries";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const engineId = searchParams.get("engineId") || undefined;
    const result = searchParams.get("result") as "red" | "black" | "draw" | undefined;
    const format = searchParams.get("format") || "json";

    // Export up to 1000 games
    const { games } = searchGames({ engineId, result: result || undefined, limit: 1000, offset: 0 });

    if (format === "json") {
      const exportData = games.map(g => ({
        id: g.id,
        red: g.red_engine_name,
        black: g.black_engine_name,
        result: g.result,
        result_reason: g.result_reason,
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
      lines.push(`[Event "Chinese Chess Engine Match"]`);
      lines.push(`[Red "${g.red_engine_name}"]`);
      lines.push(`[Black "${g.black_engine_name}"]`);
      lines.push(`[Result "${g.result === "red" ? "1-0" : g.result === "black" ? "0-1" : "1/2-1/2"}"]`);
      if (g.result_reason) lines.push(`[Termination "${g.result_reason}"]`);
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
