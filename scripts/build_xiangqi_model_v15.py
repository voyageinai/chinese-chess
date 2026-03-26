#!/usr/bin/env python3
"""Build a single-file uploadable XiangqiModelV15 engine."""

from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import scripts.build_xiangqi_model_v14 as base  # noqa: E402


MODEL_PATH = ROOT / "models" / "xiangqi_model_v15.npz"
OUTPUT_PATH = ROOT / "engines" / "xiangqi_model_v15.py"
EXPLICIT_SCALE = 0.0


def build() -> None:
    base.MODEL_PATH = MODEL_PATH
    base.OUTPUT_PATH = OUTPUT_PATH
    base.build()
    text = OUTPUT_PATH.read_text()
    text = text.replace("XiangqiModelV14", "XiangqiModelV15")
    text = text.replace("builtin-residual-policy-v14", "builtin-residual-policy-v15")
    text = text.replace("MODEL_EXPLICIT_SCALE = 0.25", f"MODEL_EXPLICIT_SCALE = {EXPLICIT_SCALE}")
    OUTPUT_PATH.write_text(text)


if __name__ == "__main__":
    build()
