#!/usr/bin/env python3
"""Train XiangqiModelV8 using the proven V6 architecture with larger teacher data."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import scripts.train_xiangqi_model_v6 as base  # noqa: E402


base.MODEL_PATH = base.MODEL_DIR / "xiangqi_model_v8.npz"
base.REPORT_PATH = base.MODEL_DIR / "xiangqi_model_v8_report.json"


if __name__ == "__main__":
    raise SystemExit(base.main())
