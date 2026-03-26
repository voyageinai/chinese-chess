#!/usr/bin/env python3
"""Build a single-file uploadable XiangqiModelV5 engine."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import scripts.build_xiangqi_model_v3 as base_build


MODEL_PATH = ROOT / "models" / "xiangqi_model_v5.npz"
OUTPUT_PATH = ROOT / "engines" / "xiangqi_model_v5.py"


def build() -> None:
    old_model_path = base_build.MODEL_PATH
    old_output_path = base_build.OUTPUT_PATH
    try:
        base_build.MODEL_PATH = MODEL_PATH
        base_build.OUTPUT_PATH = OUTPUT_PATH
        base_build.build()
        text = OUTPUT_PATH.read_text()
        text = text.replace("XiangqiModelV3", "XiangqiModelV5")
        text = text.replace("builtin-residual-v3", "builtin-residual-v5")
        OUTPUT_PATH.write_text(text)
    finally:
        base_build.MODEL_PATH = old_model_path
        base_build.OUTPUT_PATH = old_output_path


if __name__ == "__main__":
    build()
