#!/usr/bin/env python3
"""Small UCI client for using external Xiangqi engines as training teachers."""

from __future__ import annotations

import subprocess
import time
import re
from pathlib import Path
from typing import Mapping, Sequence


class UciTeacher:
    def __init__(
        self,
        engine_path: str | Path,
        cwd: str | Path | None = None,
        *,
        variant: str | None = None,
        options: Mapping[str, str | int | bool] | None = None,
        init_commands: Sequence[str] | None = None,
    ):
        resolved = Path(engine_path).resolve()
        self.engine_path = str(resolved)
        self.cwd = str(Path(cwd).resolve()) if cwd is not None else str(resolved.parent)
        self.variant = variant
        self.options = dict(options or {})
        self.init_commands = list(init_commands or [])
        self.proc: subprocess.Popen[str] | None = None
        self.rank_one_based = False
        self._has_variant_option = False

    def start(self) -> None:
        if self.proc is not None:
            return
        self.proc = subprocess.Popen(
            [self.engine_path],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            cwd=self.cwd,
        )
        self._cmd("uci")
        self._wait_for("uciok", 10.0)
        if self.variant is not None:
            self._cmd(f"setoption name UCI_Variant value {self.variant}")
            self.rank_one_based = True
        elif self._has_variant_option:
            self.rank_one_based = True
        for name, value in self.options.items():
            if isinstance(value, bool):
                text = "true" if value else "false"
            else:
                text = str(value)
            self._cmd(f"setoption name {name} value {text}")
        for line in self.init_commands:
            self._cmd(line)
        self._cmd("isready")
        self._wait_for("readyok", 10.0)
        self._cmd("ucinewgame")
        self._cmd("isready")
        self._wait_for("readyok", 10.0)

    def close(self) -> None:
        if self.proc is None:
            return
        try:
            self._cmd("quit")
        except Exception:
            pass
        try:
            self.proc.wait(timeout=2.0)
        except Exception:
            self.proc.kill()
        self.proc = None

    def analyze(
        self,
        fen: str,
        depth: int | None = None,
        movetime: int | None = None,
    ) -> tuple[int, str]:
        if self.proc is None:
            self.start()
        assert self.proc is not None

        self._cmd(f"position fen {fen}")
        go = "go"
        if depth is not None:
            go += f" depth {depth}"
        if movetime is not None:
            go += f" movetime {movetime}"
        if depth is None and movetime is None:
            go += " depth 6"
        self._cmd(go)

        score = 0
        bestmove = "0000"
        deadline = time.perf_counter() + max(15.0, (movetime or 0) / 1000.0 + 10.0)
        while time.perf_counter() < deadline:
            line = self._readline(deadline - time.perf_counter())
            if line is None:
                break
            if line.startswith("info") and " score " in line:
                tokens = line.split()
                for i, token in enumerate(tokens[:-1]):
                    if token == "score" and tokens[i + 1] == "cp":
                        try:
                            score = int(tokens[i + 2])
                        except Exception:
                            pass
                    elif token == "score" and tokens[i + 1] == "mate":
                        try:
                            mate = int(tokens[i + 2])
                            score = 30000 - min(abs(mate), 100) if mate > 0 else -30000 + min(abs(mate), 100)
                        except Exception:
                            pass
            elif line.startswith("bestmove"):
                parts = line.split()
                if len(parts) >= 2:
                    bestmove = parts[1]
                return score, bestmove
        raise TimeoutError(f"Teacher {self.engine_path} timed out on go")

    def uci_to_move(self, uci: str) -> int:
        if not uci or uci == "0000":
            return -1
        try:
            m = re.match(r"^([a-i])(\d{1,2})([a-i])(\d{1,2})$", uci)
            if m is None:
                return -1
            fc = ord(m.group(1)) - 97
            fr_rank = int(m.group(2))
            tc = ord(m.group(3)) - 97
            to_rank = int(m.group(4))
            offset = 10 if self.rank_one_based else 9
            fr = (offset - fr_rank) * 9 + fc
            to = (offset - to_rank) * 9 + tc
            return fr * 90 + to
        except Exception:
            return -1

    def _cmd(self, line: str) -> None:
        if self.proc is None or self.proc.stdin is None:
            raise RuntimeError("teacher process not started")
        self.proc.stdin.write(line + "\n")
        self.proc.stdin.flush()

    def _readline(self, timeout_sec: float) -> str | None:
        if self.proc is None or self.proc.stdout is None:
            return None
        deadline = time.perf_counter() + max(0.0, timeout_sec)
        while time.perf_counter() < deadline:
            line = self.proc.stdout.readline()
            if line:
                return line.strip()
            if self.proc.poll() is not None:
                err = ""
                if self.proc.stderr is not None:
                    err = self.proc.stderr.read().strip()
                raise RuntimeError(f"teacher exited unexpectedly: {err}")
            time.sleep(0.01)
        return None

    def _wait_for(self, token: str, timeout_sec: float) -> None:
        deadline = time.perf_counter() + timeout_sec
        while time.perf_counter() < deadline:
            line = self._readline(deadline - time.perf_counter())
            if line is None:
                continue
            if "option name UCI_Variant" in line:
                self._has_variant_option = True
            if line == token or line.startswith(token):
                return
        raise TimeoutError(f"timed out waiting for {token} from {self.engine_path}")


__all__ = ["UciTeacher"]
