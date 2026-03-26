#!/usr/bin/env python3
"""Build a single-file uploadable XiangqiModelV10 engine."""

from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import scripts.build_xiangqi_model_v6 as base  # noqa: E402


base.MODEL_PATH = ROOT / "models" / "xiangqi_model_v10.npz"
base.OUTPUT_PATH = ROOT / "engines" / "xiangqi_model_v10.py"


def build() -> None:
    base.build()
    text = base.OUTPUT_PATH.read_text()
    text = text.replace("XiangqiModelV6", "XiangqiModelV10")
    text = text.replace("builtin-residual-policy-v6", "builtin-residual-policy-v10")
    text = text.replace("            return 900_000 + prior // 4\n", "            return 900_000\n")
    text = text.replace("            return 800_000 + prior // 4\n", "            return 800_000\n")
    text = text.replace("        return self.history[move] + prior // 4\n", "        return self.history[move]\n")
    base.OUTPUT_PATH.write_text(text)


if __name__ == "__main__":
    build()
