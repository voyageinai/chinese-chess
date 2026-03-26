import type { Color, ResultCode } from "./types";

export type ResultDetail = Record<string, string | number | boolean | null>;
export type EngineOutcome = "win" | "loss" | "draw";

export const RESULT_CODE_LABELS_ZH: Record<ResultCode, string> = {
  king_capture: "吃将胜",
  checkmate: "将杀",
  stalemate: "困毙",
  perpetual_check: "长将判负",
  mutual_perpetual_check: "双方长将判和",
  perpetual_chase: "长捉判负",
  mutual_perpetual_chase: "双方长捉判和",
  repetition: "重复局面",
  natural_move_limit: "自然限着",
  time_forfeit: "超时判负",
  illegal_move: "非法着法",
  invalid_move: "无效着法",
  engine_crash: "引擎崩溃",
  engine_init_failed: "引擎启动失败",
  engine_no_response: "引擎无响应",
  game_aborted: "对局中止",
  internal_error: "系统异常",
};

export const RESULT_CODE_OPTIONS = Object.entries(RESULT_CODE_LABELS_ZH).map(
  ([value, label]) => ({ value: value as ResultCode, label }),
);

function toTitleSide(side: Color): string {
  return side === "red" ? "Red" : "Black";
}

function toChineseSide(side: Color): string {
  return side === "red" ? "红方" : "黑方";
}

export function stringifyResultDetail(detail?: ResultDetail | null): string | null {
  if (!detail) return null;
  return JSON.stringify(detail);
}

export function parseResultDetail(detail: string | null | undefined): ResultDetail | null {
  if (!detail) return null;
  try {
    const parsed = JSON.parse(detail);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as ResultDetail;
    }
  } catch {
    // Ignore malformed legacy detail values and fall back to reason text.
  }
  return null;
}

export function formatResultReason(
  code: ResultCode,
  detail?: ResultDetail | null,
): string {
  const side = detail?.side === "red" || detail?.side === "black"
    ? detail.side
    : null;
  const move = typeof detail?.move === "string" ? detail.move : null;

  switch (code) {
    case "king_capture":
      return "King capture";
    case "checkmate":
      return "Checkmate";
    case "stalemate":
      return "Stalemate";
    case "perpetual_check":
      return `${toTitleSide(side ?? "red")} lost by perpetual check`;
    case "mutual_perpetual_check":
      return "Mutual perpetual check";
    case "perpetual_chase":
      return `${toTitleSide(side ?? "red")} lost by perpetual chase`;
    case "mutual_perpetual_chase":
      return "Mutual perpetual chase";
    case "repetition":
      return "Repeated position";
    case "natural_move_limit":
      return "Natural move limit";
    case "time_forfeit":
      return `${toTitleSide(side ?? "red")} lost on time`;
    case "illegal_move":
      return `${side ?? "red"} engine made illegal move: ${move ?? ""}`.trim();
    case "invalid_move":
      return `${side ?? "red"} engine returned invalid move: ${move ?? ""}`.trim();
    case "engine_crash":
      return `${side ?? "red"} engine crashed`;
    case "engine_init_failed":
      return `${toTitleSide(side ?? "red")} engine failed to initialize`;
    case "engine_no_response":
      return `${side ?? "red"} engine failed to respond`;
    case "game_aborted":
      return "Game aborted";
    case "internal_error":
      return "Internal error";
  }
}

export function getResultCodeLabel(code: ResultCode): string {
  return RESULT_CODE_LABELS_ZH[code];
}

export function getGameResultLabel(result: "red" | "black" | "draw"): string {
  switch (result) {
    case "red":
      return "红胜";
    case "black":
      return "黑胜";
    case "draw":
      return "和棋";
  }
}

export function getEngineOutcomeLabel(outcome: EngineOutcome): string {
  switch (outcome) {
    case "win":
      return "胜";
    case "loss":
      return "负";
    case "draw":
      return "和";
  }
}

export function getEnginePerspective(
  engineId: string | null | undefined,
  redEngineId: string,
  blackEngineId: string,
  result: "red" | "black" | "draw" | null,
): { side: Color; outcome: EngineOutcome | null } | null {
  if (!engineId) return null;
  if (engineId !== redEngineId && engineId !== blackEngineId) return null;

  const side: Color = engineId === redEngineId ? "red" : "black";
  if (!result) return { side, outcome: null };
  if (result === "draw") return { side, outcome: "draw" };

  return {
    side,
    outcome: result === side ? "win" : "loss",
  };
}

const LEGACY_REASON_ZH: Record<string, string> = {
  Checkmate: "将杀",
  Stalemate: "困毙",
  "Red lost on time": "红方超时",
  "Black lost on time": "黑方超时",
  "Red lost by perpetual check": "红方长将判负",
  "Black lost by perpetual check": "黑方长将判负",
  "Mutual perpetual check": "双方长将，判和",
  "Threefold repetition": "三次重复局面",
  "Repeated position": "重复局面判和",
  "120-move rule": "120步无吃子，判和",
  "Natural move limit": "自然限着，判和",
  "Game aborted": "对局中止",
  "Internal error": "系统异常",
  "red engine crashed": "红方引擎崩溃",
  "black engine crashed": "黑方引擎崩溃",
  "red engine failed to respond": "红方引擎无响应",
  "black engine failed to respond": "黑方引擎无响应",
  "Red engine failed to initialize": "红方引擎启动失败",
  "Black engine failed to initialize": "黑方引擎启动失败",
};

export function translateResult(
  code: ResultCode | null | undefined,
  reason: string | null | undefined,
  detail: string | null | undefined,
): string {
  const parsedDetail = parseResultDetail(detail);
  const side = parsedDetail?.side === "red" || parsedDetail?.side === "black"
    ? parsedDetail.side
    : null;
  const move = typeof parsedDetail?.move === "string" ? parsedDetail.move : null;

  if (code) {
    switch (code) {
      case "king_capture":
        return "吃将胜";
      case "checkmate":
        return "将杀";
      case "stalemate":
        return "困毙";
      case "perpetual_check":
        return `${toChineseSide(side ?? "red")}长将判负`;
      case "mutual_perpetual_check":
        return "双方长将，判和";
      case "perpetual_chase":
        return `${toChineseSide(side ?? "red")}长捉判负`;
      case "mutual_perpetual_chase":
        return "双方长捉，判和";
      case "repetition":
        return "重复局面判和";
      case "natural_move_limit":
        return "自然限着，判和";
      case "time_forfeit":
        return `${toChineseSide(side ?? "red")}超时`;
      case "illegal_move":
        return `${toChineseSide(side ?? "red")}引擎走出非法着法${move ? `: ${move}` : ""}`;
      case "invalid_move":
        return `${toChineseSide(side ?? "red")}引擎返回无效着法${move ? `: ${move}` : ""}`;
      case "engine_crash":
        return `${toChineseSide(side ?? "red")}引擎崩溃`;
      case "engine_init_failed":
        return `${toChineseSide(side ?? "red")}引擎启动失败`;
      case "engine_no_response":
        return `${toChineseSide(side ?? "red")}引擎无响应`;
      case "game_aborted":
        return "对局中止";
      case "internal_error":
        return "系统异常";
    }
  }

  if (reason && LEGACY_REASON_ZH[reason]) return LEGACY_REASON_ZH[reason];
  if (reason?.includes("illegal move")) {
    return reason.replace(/^(\w+) engine made illegal move:/, "$1方引擎走出非法着法:");
  }
  if (reason?.includes("invalid move")) {
    return reason.replace(/^(\w+) engine returned invalid move:/, "$1方引擎返回无效着法:");
  }
  return reason ?? "";
}
