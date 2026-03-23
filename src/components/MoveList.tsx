"use client";

import type { StoredMove } from "@/lib/types";

interface MoveListProps {
  moves: StoredMove[];
  currentIndex: number; // -1 = start position, 0 = after first move, etc.
  onSelect: (index: number) => void;
}

export function MoveList({ moves, currentIndex, onSelect }: MoveListProps) {
  // Group moves into pairs: (red move, black move)
  const pairs: { moveNum: number; red: StoredMove; black?: StoredMove }[] = [];
  for (let i = 0; i < moves.length; i += 2) {
    pairs.push({
      moveNum: Math.floor(i / 2) + 1,
      red: moves[i],
      black: moves[i + 1],
    });
  }

  return (
    <div className="rounded-lg border border-paper-300 bg-paper-50 overflow-hidden">
      <div className="px-3 py-2 border-b border-paper-300 bg-paper-100">
        <h3 className="font-brush text-base text-ink">棋谱</h3>
      </div>
      <div className="max-h-80 overflow-y-auto">
        {pairs.length === 0 ? (
          <div className="px-3 py-6 text-center text-ink-muted text-sm">
            暂无着法
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-ink-muted text-xs">
                <th className="w-10 py-1 text-center">#</th>
                <th className="py-1 text-left pl-2">红方</th>
                <th className="py-1 text-left pl-2">黑方</th>
              </tr>
            </thead>
            <tbody>
              {pairs.map((pair) => {
                const redIdx = (pair.moveNum - 1) * 2;
                const blackIdx = redIdx + 1;
                return (
                  <tr
                    key={pair.moveNum}
                    className="border-t border-paper-200/50"
                  >
                    <td className="text-center text-ink-muted font-mono text-xs py-0.5">
                      {pair.moveNum}
                    </td>
                    <td className="pl-2 py-0.5">
                      <button
                        onClick={() => onSelect(redIdx)}
                        className={`px-1.5 py-0.5 rounded font-mono text-xs transition-colors ${
                          currentIndex === redIdx
                            ? "bg-vermilion text-paper-50 font-semibold"
                            : "text-vermilion hover:bg-paper-200/60"
                        }`}
                      >
                        {pair.red.move}
                      </button>
                    </td>
                    <td className="pl-2 py-0.5">
                      {pair.black && (
                        <button
                          onClick={() => onSelect(blackIdx)}
                          className={`px-1.5 py-0.5 rounded font-mono text-xs transition-colors ${
                            currentIndex === blackIdx
                              ? "bg-ink text-paper-50 font-semibold"
                              : "text-ink hover:bg-paper-200/60"
                          }`}
                        >
                          {pair.black.move}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
