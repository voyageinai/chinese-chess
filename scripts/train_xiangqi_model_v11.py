#!/usr/bin/env python3
"""Train XiangqiModelV11 on top of the V10 dual-teacher pipeline."""

from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import scripts.train_xiangqi_model_v10 as base  # noqa: E402


base.base.MODEL_PATH = base.base.MODEL_DIR / "xiangqi_model_v11.npz"
base.base.REPORT_PATH = base.base.MODEL_DIR / "xiangqi_model_v11_report.json"
base.PREV_MODEL_PATH = ROOT / "models" / "xiangqi_model_v10.npz"


if __name__ == "__main__":
    raise SystemExit(base.main())
