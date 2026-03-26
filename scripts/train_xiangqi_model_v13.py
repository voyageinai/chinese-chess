#!/usr/bin/env python3
"""Train XiangqiModelV13 as a scaled-up V12 run."""

from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import scripts.train_xiangqi_model_v12 as base  # noqa: E402


base.base.base.MODEL_PATH = base.base.base.MODEL_DIR / "xiangqi_model_v13.npz"
base.base.base.REPORT_PATH = base.base.base.MODEL_DIR / "xiangqi_model_v13_report.json"
base.PREV_MODEL_PATH = ROOT / "models" / "xiangqi_model_v12.npz"


DEFAULT_ARGS = [
    "--secondary-mode",
    "classic",
    "--samples",
    "8000",
    "--games",
    "320",
    "--primary-movetime",
    "80",
    "--secondary-movetime",
    "60",
    "--primary-weight",
    "0.80",
    "--secondary-weight",
    "0.20",
    "--disagreement-cp",
    "70",
    "--opening-random-plies",
    "24",
    "--max-game-plies",
    "38",
    "--hidden-dim",
    "16",
    "--factor-dim",
    "5",
    "--epochs",
    "20",
    "--lr",
    "0.00032",
]


if __name__ == "__main__":
    if len(sys.argv) == 1:
        sys.argv.extend(DEFAULT_ARGS)
    raise SystemExit(base.main())
