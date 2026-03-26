"""Small FEN helpers shared by autoresearch scripts."""

from __future__ import annotations

from engines import smartpy_opt as board_engine


CHAR_FROM_PIECE = {value: key for key, value in board_engine.PIECE_FROM_CHAR.items()}


def board_to_fen(board: board_engine.Board) -> str:
    """Serialize the current board to Xiangqi FEN."""
    rows: list[str] = []
    for r in range(board_engine.ROWS):
        empties = 0
        parts: list[str] = []
        base = r * board_engine.COLS
        for c in range(board_engine.COLS):
            piece = board.sq[base + c]
            if piece == board_engine.EMPTY:
                empties += 1
                continue
            if empties:
                parts.append(str(empties))
                empties = 0
            parts.append(CHAR_FROM_PIECE[piece])
        if empties:
            parts.append(str(empties))
        rows.append("".join(parts))
    side = "w" if board.red_turn else "b"
    return "/".join(rows) + f" {side} - - 0 1"


def fen_side_to_move(fen: str) -> str:
    """Return the FEN side-to-move token, defaulting to white/red."""
    parts = fen.split()
    if len(parts) >= 2 and parts[1] in {"w", "b"}:
        return parts[1]
    return "w"


def internal_to_uci_fen(fen: str) -> str:
    """Compatibility shim for callers that already store UCI-compatible FEN."""
    return fen
