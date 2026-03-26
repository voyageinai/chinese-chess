#!/usr/bin/env python3
"""Compile trained NNUE weights into a JavaScript UCI engine based on v5.js.

Reads the base JS engine (engines/xiangqi-engine-v5.js) and a trained NPZ model,
then outputs a single-file JS UCI engine combining v5's alpha-beta search with
NNUE evaluation.

Usage:
    python scripts/build_js_engine.py
    python scripts/build_js_engine.py --model autoresearch/models/latest.npz
    python scripts/build_js_engine.py --output engines/xiangqi-nnue-v5.js
"""

from __future__ import annotations

import argparse
import base64
import struct
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]


def _f64_inline(arr: np.ndarray) -> str:
    """Format a small array as an inline JS Float64Array."""
    flat = arr.astype(np.float64).ravel()
    elems = ",".join(f"{v:.8g}" for v in flat)
    return f"new Float64Array([{elems}])"


def _i8_inline(arr: np.ndarray) -> str:
    """Format a small int8 array as an inline JS Int8Array."""
    flat = arr.astype(np.int8).ravel()
    elems = ",".join(str(int(v)) for v in flat)
    return f"new Int8Array([{elems}])"


def _f64_base64(arr: np.ndarray) -> str:
    """Encode a large array as base64 Float32 -> Float64Array for compactness."""
    flat = arr.astype(np.float32).ravel()
    raw = flat.tobytes()
    b64 = base64.b64encode(raw).decode("ascii")
    return (
        f"new Float64Array(new Float32Array("
        f"new Uint8Array(Buffer.from(\"{b64}\",\"base64\")).buffer))"
    )


def _scalar(arr: np.ndarray) -> str:
    """Extract a scalar value."""
    v = float(arr)
    return f"{v:.8g}"


def _generate_weight_block(model: dict) -> str:
    """Generate all NNUE weight constant declarations."""
    lines: list[str] = []
    lines.append("// ============================================================")
    lines.append("// NNUE weights (compiled from trained model)")
    lines.append("// ============================================================")

    # Dimensions
    emb = model["emb"]  # (15, 90, 32)
    hidden = emb.shape[2]
    factor = model["red_fac"].shape[2]

    lines.append(f"const HIDDEN={hidden},FACTOR={factor};")

    # Large arrays: flatten to (15*90*hidden) etc., use base64
    # emb: (15, 90, 32) -> flatten to (15*90*32)
    lines.append(f"const NN_EMB={_f64_base64(emb)};")

    # lin_w: (15, 90) -> flatten to (15*90)
    lin_w = model["lin_w"]
    lines.append(f"const NN_LW={_f64_base64(lin_w)};")

    # red_fac / black_fac: (15, 90, factor)
    lines.append(f"const NN_RF={_f64_base64(model['red_fac'])};")
    lines.append(f"const NN_BF={_f64_base64(model['black_fac'])};")

    # Small arrays (inline)
    # hidden_bias: (32,)
    lines.append(f"const NN_HB={_f64_inline(model['hidden_bias'])};")

    # lin_tempo: (2,)
    lines.append(f"const NN_LT={_f64_inline(model['lin_tempo'])};")

    # tempo: (2, 32)
    lines.append(f"const NN_TMP={_f64_inline(model['tempo'])};")

    # phase_vec: (32,)
    lines.append(f"const NN_PV={_f64_inline(model['phase_vec'])};")

    # red_king_bias / black_king_bias: (9, 32)
    lines.append(f"const NN_RKB={_f64_inline(model['red_king_bias'])};")
    lines.append(f"const NN_BKB={_f64_inline(model['black_king_bias'])};")

    # red_king_vec / black_king_vec: (9, factor)
    lines.append(f"const NN_RKV={_f64_inline(model['red_king_vec'])};")
    lines.append(f"const NN_BKV={_f64_inline(model['black_king_vec'])};")

    # king_pair_bias: (9, 9)
    lines.append(f"const NN_KPB={_f64_inline(model['king_pair_bias'])};")

    # out_w: (32,)
    lines.append(f"const NN_OW={_f64_inline(model['out_w'])};")

    # Scalars
    lines.append(f"const NN_OB={_scalar(model['out_bias'])};")
    lines.append(f"const NN_PO_S={_scalar(model['phase_out'])};")
    lines.append(f"const NN_AC={_scalar(model['act_clip'])};")
    lines.append(f"const NN_MC={_scalar(model['max_correction'])};")

    # Phase inverse: total phase from PHASE_W = [0,0,1,1,2,4,2,0]
    # Max phase = 2*A(1) + 2*B(1) + 2*N(2) + 2*R(4) + 2*C(2) = 2+2+4+8+4 = 20
    lines.append("const NN_PINV=1/20;")

    # Bucket maps: int8
    lines.append(f"const NN_RBK={_i8_inline(model['red_bucket'])};")
    lines.append(f"const NN_BBK={_i8_inline(model['black_bucket'])};")

    # NNUE accumulator state
    lines.append("")
    lines.append("// NNUE accumulator state (mutable)")
    lines.append("const nnAcc_=new Float64Array(HIDDEN);")
    lines.append("let nnLin_=0;")
    lines.append("const nnRedSum_=new Float64Array(FACTOR);")
    lines.append("const nnBlkSum_=new Float64Array(FACTOR);")

    return "\n".join(lines)


def _generate_nnue_init() -> str:
    """Generate NNUE init code for loadFen (after board is populated)."""
    return """\
  // -- NNUE init --
  nnLin_=0;
  for(let i=0;i<HIDDEN;i++)nnAcc_[i]=NN_HB[i];
  nnRedSum_.fill(0);nnBlkSum_.fill(0);
  for(let s=0;s<BS;s++){
    if(!sq_[s])continue;
    const pl=(sq_[s]+PO)*BS+s;
    nnLin_+=NN_LW[pl];
    const eOff=pl*HIDDEN,rfOff=pl*FACTOR,bfOff=pl*FACTOR;
    for(let i=0;i<HIDDEN;i++)nnAcc_[i]+=NN_EMB[eOff+i];
    for(let i=0;i<FACTOR;i++){nnRedSum_[i]+=NN_RF[rfOff+i];nnBlkSum_[i]+=NN_BF[bfOff+i];}
  }"""


def _generate_nnue_make() -> str:
    """Generate NNUE incremental update code for makeMove."""
    return """\
  {
    const pp=(piece+PO)*BS;
    nnLin_+=NN_LW[pp+to]-NN_LW[pp+fr];
    const eoF=(pp+fr)*HIDDEN,eoT=(pp+to)*HIDDEN;
    const rfF=(pp+fr)*FACTOR,rfT=(pp+to)*FACTOR;
    const bfF=(pp+fr)*FACTOR,bfT=(pp+to)*FACTOR;
    for(let i=0;i<HIDDEN;i++)nnAcc_[i]+=NN_EMB[eoT+i]-NN_EMB[eoF+i];
    for(let i=0;i<FACTOR;i++){
      nnRedSum_[i]+=NN_RF[rfT+i]-NN_RF[rfF+i];
      nnBlkSum_[i]+=NN_BF[bfT+i]-NN_BF[bfF+i];
    }
    if(cap){
      const cp=(cap+PO)*BS+to;
      nnLin_-=NN_LW[cp];
      const ceO=cp*HIDDEN,crfO=cp*FACTOR;
      for(let i=0;i<HIDDEN;i++)nnAcc_[i]-=NN_EMB[ceO+i];
      for(let i=0;i<FACTOR;i++){nnRedSum_[i]-=NN_RF[crfO+i];nnBlkSum_[i]-=NN_BF[crfO+i];}
    }
  }"""


def _generate_nnue_undo() -> str:
    """Generate NNUE undo code for undoMove (reverse of makeMove)."""
    return """\
  {
    const pp=(piece+PO)*BS;
    nnLin_+=NN_LW[pp+fr]-NN_LW[pp+to];
    const eoF=(pp+fr)*HIDDEN,eoT=(pp+to)*HIDDEN;
    const rfF=(pp+fr)*FACTOR,rfT=(pp+to)*FACTOR;
    const bfF=(pp+fr)*FACTOR,bfT=(pp+to)*FACTOR;
    for(let i=0;i<HIDDEN;i++)nnAcc_[i]+=NN_EMB[eoF+i]-NN_EMB[eoT+i];
    for(let i=0;i<FACTOR;i++){
      nnRedSum_[i]+=NN_RF[rfF+i]-NN_RF[rfT+i];
      nnBlkSum_[i]+=NN_BF[bfF+i]-NN_BF[bfT+i];
    }
    if(cap){
      const cp=(cap+PO)*BS+to;
      nnLin_+=NN_LW[cp];
      const ceO=cp*HIDDEN,crfO=cp*FACTOR;
      for(let i=0;i<HIDDEN;i++)nnAcc_[i]+=NN_EMB[ceO+i];
      for(let i=0;i<FACTOR;i++){nnRedSum_[i]+=NN_RF[crfO+i];nnBlkSum_[i]+=NN_BF[crfO+i];}
    }
  }"""


def _generate_board_eval() -> str:
    """Generate the NNUE-based boardEval replacement."""
    return """\
function boardEval(){
  const base=redTurn?score_:-score_;
  const phase=(redPh+blackPh)*NN_PINV;
  const side=redTurn?0:1;
  const rkb=redKing_>=0?NN_RBK[redKing_]:4;
  const bkb=blackKing_>=0?NN_BBK[blackKing_]:4;
  let corr=nnLin_+NN_LT[side]+NN_OB+phase*NN_PO_S+NN_KPB[rkb*9+bkb];
  const tO=side*HIDDEN,rkO=rkb*HIDDEN,bkO=bkb*HIDDEN;
  for(let i=0;i<HIDDEN;i++){
    let x=nnAcc_[i]+NN_TMP[tO+i]+phase*NN_PV[i]+NN_RKB[rkO+i]+NN_BKB[bkO+i];
    if(x<=0)continue;
    if(x>NN_AC)x=NN_AC;
    corr+=NN_OW[i]*(x*x/NN_AC);
  }
  const rkfO=rkb*FACTOR,bkfO=bkb*FACTOR;
  for(let i=0;i<FACTOR;i++)corr+=nnRedSum_[i]*NN_RKV[rkfO+i]+nnBlkSum_[i]*NN_BKV[bkfO+i];
  if(corr>NN_MC)corr=NN_MC;else if(corr<-NN_MC)corr=-NN_MC;
  return(base+corr)|0;
}"""


def _generate_policy_block(policy: dict) -> str:
    """Generate policy weight constants and scoring function."""
    lines = []
    lines.append("// Policy weights (piece+to, phase-bucketed)")
    pp = policy["policy_piece"].astype(np.int16).ravel()
    lines.append(f"const POL_PIECE=new Int16Array([{','.join(str(int(v)) for v in pp)}]);")
    pt = policy["policy_to"].astype(np.int16).ravel()
    raw = pt.tobytes()
    b64 = base64.b64encode(raw).decode("ascii")
    lines.append(f'const POL_TO=new Int16Array(new Uint8Array(Buffer.from("{b64}","base64")).buffer);')
    nb = policy["norm_black"].astype(np.int8).ravel()
    lines.append(f"const POL_NORM=new Int8Array([{','.join(str(int(v)) for v in nb)}]);")
    lines.append("function polBucket(){const t=redPh+blackPh;return t>=27?0:t>=14?1:2;}")
    lines.append(
        "function polPrior(move){"
        "const fr=(move/MS)|0,to=move-fr*MS;"
        "const p=sq_[fr];if(!p)return 0;"
        "const pt=p>0?p:-p;"
        "const nto=p<0?POL_NORM[to]:to;"
        "const b=polBucket();"
        "return POL_PIECE[b*8+pt]+POL_TO[(b*8+pt)*90+nto];"
        "}"
    )
    return "\n".join(lines)


def build(
    model_path: str = "autoresearch/models/latest.npz",
    base_engine: str = "engines/xiangqi-engine-v9b.js",
    output_path: str = "engines/xiangqi-nnue-v9b.js",
    engine_name: str = "XiangqiNNUE-v9b",
    policy_path: str = "autoresearch/models/policy_v11.npz",
) -> None:
    """Build a JS UCI engine with NNUE eval from trained weights."""
    model_file = ROOT / model_path
    base_file = ROOT / base_engine
    out_file = ROOT / output_path
    policy_file = ROOT / policy_path

    # Load model
    print(f"Loading model from {model_file} ...")
    model = dict(np.load(str(model_file), allow_pickle=False))

    # Validate expected keys
    expected_keys = {
        "emb", "lin_w", "red_fac", "black_fac", "hidden_bias",
        "lin_tempo", "tempo", "phase_vec", "red_king_bias", "black_king_bias",
        "red_king_vec", "black_king_vec", "king_pair_bias", "out_w", "out_bias",
        "phase_out", "act_clip", "max_correction", "red_bucket", "black_bucket",
    }
    missing = expected_keys - set(model.keys())
    if missing:
        print(f"ERROR: Model is missing keys: {missing}", file=sys.stderr)
        sys.exit(1)

    emb = model["emb"]
    print(f"  emb shape: {emb.shape}  (HIDDEN={emb.shape[2]})")
    print(f"  red_fac shape: {model['red_fac'].shape}  (FACTOR={model['red_fac'].shape[2]})")
    print(f"  act_clip: {float(model['act_clip'])}")
    print(f"  max_correction: {float(model['max_correction'])}")

    # Read base engine
    print(f"Reading base engine from {base_file} ...")
    js = base_file.read_text(encoding="utf-8")

    # 1. Update engine name in UCI id line
    # Support both v5 and v6 engine name patterns
    for old_name in ["XiangqiEngine-JS-v9b", "XiangqiEngine-JS-v9-SMP", "XiangqiEngine-JS-v6-SMP", "XiangqiEngine-JS-v5"]:
        if old_name in js:
            js = js.replace(old_name, engine_name)
            break

    # 2. Insert NNUE weight constants and state after board state declarations
    #    Anchor: "let redCrP=0,blackCrP=0;"
    anchor_state = "let redCrP=0,blackCrP=0;"
    if anchor_state not in js:
        print(f"ERROR: Cannot find anchor '{anchor_state}' in base engine", file=sys.stderr)
        sys.exit(1)

    weight_block = _generate_weight_block(model)
    js = js.replace(
        anchor_state,
        anchor_state + "\n\n" + weight_block + "\n",
    )

    # 2b. Insert policy weights if available
    policy_anchor = "// POLICY_WEIGHTS_ANCHOR"
    if policy_anchor in js and policy_file.exists():
        print(f"Loading policy from {policy_file} ...")
        policy = dict(np.load(str(policy_file), allow_pickle=False))
        js = js.replace(policy_anchor, _generate_policy_block(policy))
    elif policy_anchor in js:
        print("WARNING: No policy file, skipping policy injection", file=sys.stderr)
        js = js.replace(policy_anchor, "// No policy tables")



    # 3. Insert NNUE init in loadFen after "if(!redTurn)hash_^=SIDE_KEY;"
    anchor_fen = "if(!redTurn)hash_^=SIDE_KEY;"
    if anchor_fen not in js:
        print(f"ERROR: Cannot find anchor '{anchor_fen}' in base engine", file=sys.stderr)
        sys.exit(1)

    nnue_init = _generate_nnue_init()
    js = js.replace(
        anchor_fen,
        anchor_fen + "\n" + nnue_init,
    )

    # 4. Insert NNUE update in makeMove before "redTurn=!redTurn;"
    #    There are multiple occurrences of redTurn=!redTurn, we need the one in makeMove.
    #    The makeMove one is preceded by the king position updates:
    #    "if(piece===K)redKing_=to;else if(piece===-K)blackKing_=to;\n  if(cap===K)redKing_=-1;else if(cap===-K)blackKing_=-1;\n  redTurn=!redTurn;"
    anchor_make = (
        "if(piece===K)redKing_=to;else if(piece===-K)blackKing_=to;\n"
        "  if(cap===K)redKing_=-1;else if(cap===-K)blackKing_=-1;\n"
        "  redTurn=!redTurn;"
    )
    if anchor_make not in js:
        print(f"ERROR: Cannot find makeMove anchor in base engine", file=sys.stderr)
        sys.exit(1)

    nnue_make = _generate_nnue_make()
    js = js.replace(
        anchor_make,
        "if(piece===K)redKing_=to;else if(piece===-K)blackKing_=to;\n"
        "  if(cap===K)redKing_=-1;else if(cap===-K)blackKing_=-1;\n"
        + nnue_make + "\n"
        "  redTurn=!redTurn;",
    )

    # 5. Insert NNUE undo in undoMove after king position restore
    #    Anchor: "if(cap===K)redKing_=to;else if(cap===-K)blackKing_=to;"
    #    But this also appears in makeMove (though as redKing_=-1). Let's use the
    #    undoMove-specific context:
    #    "sq_[fr]=piece;sq_[to]=cap;\n  if(piece===K)redKing_=fr;else if(piece===-K)blackKing_=fr;\n  if(cap===K)redKing_=to;else if(cap===-K)blackKing_=to;"
    anchor_undo = (
        "sq_[fr]=piece;sq_[to]=cap;\n"
        "  if(piece===K)redKing_=fr;else if(piece===-K)blackKing_=fr;\n"
        "  if(cap===K)redKing_=to;else if(cap===-K)blackKing_=to;\n}"
    )
    if anchor_undo not in js:
        print(f"ERROR: Cannot find undoMove anchor in base engine", file=sys.stderr)
        sys.exit(1)

    nnue_undo = _generate_nnue_undo()
    js = js.replace(
        anchor_undo,
        "sq_[fr]=piece;sq_[to]=cap;\n"
        "  if(piece===K)redKing_=fr;else if(piece===-K)blackKing_=fr;\n"
        "  if(cap===K)redKing_=to;else if(cap===-K)blackKing_=to;\n"
        + nnue_undo + "\n}",
    )

    # 6. Replace boardEval function entirely
    #    Find the function from "function boardEval(){" to the closing "}"
    #    The original boardEval ends with "return redTurn?s:-s;\n}"
    board_eval_start = "function boardEval(){"
    # Find the end of boardEval: it's followed by a blank line and makeMove
    idx_start = js.index(board_eval_start)
    # Find the matching closing brace. We need to count braces.
    depth = 0
    idx = idx_start
    found_end = -1
    for i in range(idx_start, len(js)):
        if js[i] == "{":
            depth += 1
        elif js[i] == "}":
            depth -= 1
            if depth == 0:
                found_end = i
                break

    if found_end < 0:
        print("ERROR: Cannot find end of boardEval function", file=sys.stderr)
        sys.exit(1)

    old_eval = js[idx_start : found_end + 1]
    new_eval = _generate_board_eval()
    js = js.replace(old_eval, new_eval)

    # 7. Optimize time management for 1+1s (increment-heavy time controls)
    #    Original formula only uses 300-400ms/move with 1+1s, wasting half the increment.
    #    New formula: when increment is large relative to remaining time, use ~85% of increment.
    # Replace entire time management block including the soft cap
    old_time_block = (
        "if(myInc>0&&myTime>myInc*2)"
        "{soft=myInc*0.85+myTime*0.02;hard=Math.min(myTime*0.35,myInc*2.5);}"
        "else{soft=myTime/25+myInc*0.75;hard=Math.min(myTime*0.4,soft*5);}"
        "soft=Math.min(soft,myTime*0.3);soft=Math.max(soft,30);"
        "hard=Math.max(hard,50);"
    )
    new_time_block = (
        "if(myInc>0&&myInc>=myTime*0.3)"  # Increment-heavy (1+1s, 2+1s etc)
        "{soft=myInc*0.85+myTime*0.05;hard=Math.min(myTime*0.85,myInc*1.5);"
        "soft=Math.min(soft,myTime*0.9);}"  # Allow up to 90% of remaining time
        "else if(myInc>0&&myTime>myInc*2)"
        "{soft=myInc*0.85+myTime*0.02;hard=Math.min(myTime*0.35,myInc*2.5);"
        "soft=Math.min(soft,myTime*0.3);}"
        "else{soft=myTime/25+myInc*0.75;hard=Math.min(myTime*0.4,soft*5);"
        "soft=Math.min(soft,myTime*0.3);}"
        "soft=Math.max(soft,30);"
        "hard=Math.max(hard,50);"
    )
    if old_time_block in js:
        js = js.replace(old_time_block, new_time_block)
    else:
        print("WARNING: Could not find time management block to patch", file=sys.stderr)

    # 8. Fix perpetual check at UCI level
    pass  # UCI-level fix is done in the bestmove validation below

    # 8. Add bestmove legality validation in UCI go handler
    #    Replace the simple fallback with a full legality check
    # Patch bestmove with legality validation + perpetual check avoidance
    bestmove_patched = False
    bestmove_marker = "out(`bestmove ${m2uci(best)}`);"
    if bestmove_marker in js:
        # Insert consecutive check counter as a global variable near board state
        if "let nnConsecChecks_=0;" not in js:
            js = js.replace(
                "let redCrP=0,blackCrP=0;",
                "let redCrP=0,blackCrP=0;\nlet nnConsecChecks_=0;",
            )

        validation_code = (
            "    {// validate bestmove legality + avoid perpetual check\n"
            "      const _red=redTurn,_buf=mBuf[0],_n=genPseudo(_buf);\n"
            "      // Build list of legal moves, marking which give check\n"
            "      const _legals=[],_checks=[];\n"
            "      for(let _i=0;_i<_n;_i++){\n"
            "        const _c=makeMove(_buf[_i]);\n"
            "        if(!inCheck(_red)){_legals.push(_buf[_i]);_checks.push(inCheck(!_red));}\n"
            "        undoMove(_buf[_i],_c);\n"
            "      }\n"
            "      // Validate best is legal\n"
            "      let _bestLegal=_legals.indexOf(best)>=0;\n"
            "      if(!_bestLegal&&_legals.length>0){best=_legals[0];_bestLegal=true;}\n"
            "      // Perpetual check avoidance: if we gave check 2+ times in a row\n"
            "      // and best would give check again, try to find non-checking alternative\n"
            "      if(_bestLegal&&nnConsecChecks_>=2){\n"
            "        const _bi=_legals.indexOf(best);\n"
            "        if(_bi>=0&&_checks[_bi]){\n"
            "          // Best gives check but we already checked 2+ times. Find non-check.\n"
            "          for(let _j=0;_j<_legals.length;_j++){\n"
            "            if(!_checks[_j]){best=_legals[_j];break;}\n"
            "          }\n"
            "        }\n"
            "      }\n"
            "      // Update consecutive check counter\n"
            "      const _fbi=_legals.indexOf(best);\n"
            "      if(_fbi>=0&&_checks[_fbi]){nnConsecChecks_++;}else{nnConsecChecks_=0;}\n"
            "    }\n"
            "      "
        )
        js = js.replace(
            bestmove_marker,
            validation_code + bestmove_marker,
            1,
        )
        bestmove_patched = True
    if not bestmove_patched:
        print("WARNING: Could not patch bestmove validation", file=sys.stderr)

    # Write output
    out_file.parent.mkdir(parents=True, exist_ok=True)
    out_file.write_text(js, encoding="utf-8")
    out_file.chmod(0o755)

    size_kb = out_file.stat().st_size / 1024
    print(f"Written {out_file} ({size_kb:.1f} KB)")
    print("Done.")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Compile NNUE weights into a JS UCI engine based on v5.js"
    )
    parser.add_argument(
        "--model",
        default="autoresearch/models/latest.npz",
        help="Path to trained NPZ model (relative to repo root)",
    )
    parser.add_argument(
        "--base-engine",
        default="engines/xiangqi-engine-v9b.js",
        help="Path to base JS engine (relative to repo root)",
    )
    parser.add_argument(
        "--output",
        default="engines/xiangqi-nnue-v6.js",
        help="Output path for compiled engine (relative to repo root)",
    )
    parser.add_argument(
        "--name",
        default="XiangqiNNUE-v6",
        help="Engine name for UCI id",
    )
    parser.add_argument(
        "--policy",
        default="autoresearch/models/policy_v11.npz",
        help="Path to policy NPZ (relative to repo root)",
    )
    args = parser.parse_args()
    build(
        model_path=args.model,
        base_engine=args.base_engine,
        output_path=args.output,
        engine_name=args.name,
        policy_path=args.policy,
    )


if __name__ == "__main__":
    main()
