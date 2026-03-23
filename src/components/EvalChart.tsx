"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import type { StoredMove } from "@/lib/types";

interface EvalChartProps {
  moves: StoredMove[];
  currentIndex: number; // -1 = start, 0+ = move index
}

export function EvalChart({ moves, currentIndex }: EvalChartProps) {
  // Convert centipawns to pawns, clamp for display
  const data = moves.map((m, i) => {
    const evalPawns = m.eval !== null ? m.eval / 100 : 0;
    // Clamp to [-10, 10] for readable chart
    const clamped = Math.max(-10, Math.min(10, evalPawns));
    return {
      moveNum: i + 1,
      eval: clamped,
      rawEval: evalPawns,
    };
  });

  if (data.length === 0) {
    return (
      <div className="rounded-lg border border-paper-300 bg-paper-50 overflow-hidden">
        <div className="px-3 py-2 border-b border-paper-300 bg-paper-100">
          <h3 className="font-brush text-base text-ink">评估曲线</h3>
        </div>
        <div className="px-3 py-6 text-center text-ink-muted text-sm">
          暂无评估数据
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-paper-300 bg-paper-50 overflow-hidden">
      <div className="px-3 py-2 border-b border-paper-300 bg-paper-100">
        <h3 className="font-brush text-base text-ink">评估曲线</h3>
      </div>
      <div className="px-2 py-3">
        <ResponsiveContainer width="100%" height={160}>
          <AreaChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: -10 }}>
            <defs>
              <linearGradient id="evalGradientPos" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#8b3020" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#8b3020" stopOpacity={0.05} />
              </linearGradient>
              <linearGradient id="evalGradientNeg" x1="0" y1="1" x2="0" y2="0">
                <stop offset="0%" stopColor="#3d3020" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#3d3020" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="moveNum"
              tick={{ fontSize: 10, fill: "#9c8b75" }}
              axisLine={{ stroke: "#e8ddc5" }}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "#9c8b75" }}
              axisLine={{ stroke: "#e8ddc5" }}
              tickLine={false}
              domain={[-10, 10]}
              ticks={[-5, 0, 5]}
            />
            <ReferenceLine
              y={0}
              stroke="#9c8b75"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            {/* Vertical line at current move */}
            {currentIndex >= 0 && currentIndex < data.length && (
              <ReferenceLine
                x={currentIndex + 1}
                stroke="#8b3020"
                strokeWidth={1.5}
                strokeOpacity={0.6}
              />
            )}
            <Tooltip
              contentStyle={{
                backgroundColor: "#faf8f3",
                border: "1px solid #e8ddc5",
                borderRadius: 6,
                fontSize: 12,
                color: "#3d3020",
              }}
              formatter={(value) => [
                `${Number(value) > 0 ? "+" : ""}${Number(value).toFixed(2)}`,
                "评估",
              ]}
              labelFormatter={(label) => `第 ${label} 手`}
            />
            <Area
              type="monotone"
              dataKey="eval"
              stroke="#8b3020"
              strokeWidth={1.5}
              fill="url(#evalGradientPos)"
              baseValue={0}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
