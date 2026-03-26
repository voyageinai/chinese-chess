#!/usr/bin/env python3
"""Build a single-file uploadable XiangqiModelV13 engine."""

from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import scripts.build_xiangqi_model_v12 as base  # noqa: E402


base.base.base.MODEL_PATH = ROOT / "models" / "xiangqi_model_v13.npz"
base.base.base.OUTPUT_PATH = ROOT / "engines" / "xiangqi_model_v13.py"


def build() -> None:
    base.build()
    text = base.base.base.OUTPUT_PATH.read_text()
    text = text.replace("XiangqiModelV12", "XiangqiModelV13")
    text = text.replace("builtin-residual-policy-v12", "builtin-residual-policy-v13")
    base.base.base.OUTPUT_PATH.write_text(text)


if __name__ == "__main__":
    build()
