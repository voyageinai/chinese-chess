#!/usr/bin/env python3
"""Build a single-file uploadable compact Xiangqi model."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import scripts.build_xiangqi_model_v6 as base  # noqa: E402


def _camel_name(name: str) -> str:
    return "".join(part.capitalize() for part in name.split("_"))


def build(model_name: str, output_name: str | None = None, engine_name: str | None = None) -> Path:
    output_stem = output_name or model_name
    built_engine_name = engine_name or _camel_name(output_stem)
    model_path = ROOT / "models" / f"{model_name}.npz"
    output_path = ROOT / "engines" / f"{output_stem}.py"
    if not model_path.exists():
        raise FileNotFoundError(model_path)

    old_model_path = base.MODEL_PATH
    old_output_path = base.OUTPUT_PATH
    try:
        base.MODEL_PATH = model_path
        base.OUTPUT_PATH = output_path
        base.build()

        text = output_path.read_text(encoding="utf-8")
        text = text.replace("XiangqiModelV6", built_engine_name)
        text = text.replace("builtin-residual-policy-v6", f"builtin-residual-policy-{output_stem.replace('_', '-')}")
        output_path.write_text(text, encoding="utf-8")
    finally:
        base.MODEL_PATH = old_model_path
        base.OUTPUT_PATH = old_output_path

    return output_path


def main() -> int:
    parser = argparse.ArgumentParser(description="Build a compact distilled Xiangqi model into a single-file engine.")
    parser.add_argument("--model-name", type=str, default="xiangqi_model_v16_pikafish_small")
    parser.add_argument("--output-name", type=str, default=None)
    parser.add_argument("--engine-name", type=str, default=None)
    args = parser.parse_args()

    output_path = build(
        model_name=args.model_name,
        output_name=args.output_name,
        engine_name=args.engine_name,
    )
    print(output_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
