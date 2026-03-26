#!/usr/bin/env python3
"""Build a single-file uploadable XiangqiModelV11 engine."""

from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import scripts.build_xiangqi_model_v10 as base  # noqa: E402


base.base.MODEL_PATH = ROOT / "models" / "xiangqi_model_v11.npz"
base.base.OUTPUT_PATH = ROOT / "engines" / "xiangqi_model_v11.py"


def build() -> None:
    base.build()
    text = base.base.OUTPUT_PATH.read_text()
    text = text.replace("XiangqiModelV10", "XiangqiModelV11")
    text = text.replace("builtin-residual-policy-v10", "builtin-residual-policy-v11")
    text = text.replace("                + prior // 16\n", "                + prior // 32\n")
    base.base.OUTPUT_PATH.write_text(text)


if __name__ == "__main__":
    build()
