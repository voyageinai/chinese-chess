#!/usr/bin/env python3
"""Build a single-file uploadable XiangqiModelV9 engine."""

from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import scripts.build_xiangqi_model_v6 as base  # noqa: E402


base.MODEL_PATH = ROOT / "models" / "xiangqi_model_v9.npz"
base.OUTPUT_PATH = ROOT / "engines" / "xiangqi_model_v9.py"


def build() -> None:
    base.build()
    text = base.OUTPUT_PATH.read_text()
    text = text.replace("XiangqiModelV6", "XiangqiModelV9")
    text = text.replace("builtin-residual-policy-v6", "builtin-residual-policy-v9")
    base.OUTPUT_PATH.write_text(text)


if __name__ == "__main__":
    build()
