#!/usr/bin/env node
"use strict";
// XiangqiEngine.js v9b — Single-threaded + History Malus (plain, no gravity)
// V8 JIT-optimized: TypedArrays, integer arithmetic, zero-GC hot paths

const ROWS=10,COLS=9,BS=90,MS=90;
const K=1,A=2,B=3,N=4,R=5,C=6,P=7,PO=7,EMPTY=0,NO_MOVE=-1;
const INF=32000,MATE_V=30000,MAX_PLY=96,MAX_QS=8;
const TT_EXACT=0,TT_LOWER=1,TT_UPPER=2;
const MAT=[0,10000,120,120,480,1000,510,80];
const PHASE_W=[0,0,1,1,2,4,2,0];
const START_FEN="rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1";

const ROW_OF=new Uint8Array(BS),COL_OF=new Uint8Array(BS);
for(let i=0;i<BS;i++){ROW_OF[i]=(i/COLS)|0;COL_OF[i]=i%COLS;}

const PFC={'K':K,'A':A,'B':B,'N':N,'R':R,'C':C,'P':P,'k':-K,'a':-A,'b':-B,'n':-N,'r':-R,'c':-C,'p':-P};

// PST: indexed [normalizedRow][col]
const PST_N=[[0,-5,0,0,0,0,0,-5,0],[0,0,0,0,0,0,0,0,0],[0,5,10,10,15,10,10,5,0],[0,10,20,10,20,10,20,10,0],[0,5,15,20,20,20,15,5,0],[0,5,15,25,25,25,15,5,0],[0,0,10,20,30,20,10,0,0],[0,0,5,10,20,10,5,0,0],[0,0,0,5,10,5,0,0,0],[0,0,0,0,0,0,0,0,0]];
const PST_R=[[0,0,0,10,10,10,0,0,0],[0,0,0,5,5,5,0,0,0],[0,0,5,5,10,5,5,0,0],[5,5,5,10,10,10,5,5,5],[5,10,10,10,15,10,10,10,5],[10,15,15,15,20,15,15,15,10],[10,15,15,15,20,15,15,15,10],[15,15,15,15,20,15,15,15,15],[10,10,10,15,15,15,10,10,10],[5,5,5,10,10,10,5,5,5]];
const PST_C=[[0,0,0,5,5,5,0,0,0],[0,0,0,0,0,0,0,0,0],[0,5,5,5,10,5,5,5,0],[0,5,5,5,10,5,5,5,0],[0,10,10,15,15,15,10,10,0],[5,10,15,20,25,20,15,10,5],[5,10,10,15,20,15,10,10,5],[0,5,5,10,15,10,5,5,0],[0,0,0,5,5,5,0,0,0],[0,0,0,0,0,0,0,0,0]];
const PST_P=[[0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0],[0,0,0,0,5,0,0,0,0],[0,0,5,0,10,0,5,0,0],[5,0,10,0,15,0,10,0,5],[10,20,30,40,50,40,30,20,10],[20,30,50,60,70,60,50,30,20],[20,40,60,70,80,70,60,40,20],[10,30,50,60,70,60,50,30,10],[0,10,20,30,40,30,20,10,0]];
const KS_TABLE=[[- 30,-10,0],[-10,5,25],[5,30,55]];

function bonus(pt,nr,c){
  if(pt===N)return PST_N[nr][c];if(pt===R)return PST_R[nr][c];
  if(pt===C)return PST_C[nr][c];if(pt===P)return PST_P[nr][c];
  if(pt===A)return(c===4&&nr===1)?8:0;if(pt===B)return 5;return 0;
}

// Pre-computed PSQ table: PSQ[(piece+PO)*BS + sq]
const PSQ=new Int16Array(15*BS);
for(let sq=0;sq<BS;sq++){
  const r=ROW_OF[sq],c=COL_OF[sq];
  for(let pt=1;pt<=7;pt++){
    PSQ[(pt+PO)*BS+sq]=MAT[pt]+bonus(pt,9-r,c);
    PSQ[(-pt+PO)*BS+sq]=-(MAT[pt]+bonus(pt,r,c));
  }
}

// Pre-computed move tables
const HORSE_STEPS=[[-1,0,-2,-1],[-1,0,-2,1],[1,0,2,-1],[1,0,2,1],[0,-1,-1,-2],[0,-1,1,-2],[0,1,-1,2],[0,1,1,2]];
const ELEPH_STEPS=[[-1,-1,-2,-2],[-1,1,-2,2],[1,-1,2,-2],[1,1,2,2]];

function inBounds(r,c){return r>=0&&r<ROWS&&c>=0&&c<COLS;}
function inPalace(r,c,red){return c>=3&&c<=5&&(red?(r>=7&&r<=9):(r>=0&&r<=2));}
function ownSide(r,red){return red?r>=5:r<=4;}

// Rays[sq*4+dir] -> Int32Array of squares along that ray
const RAYS_DATA=[];const RAYS_LEN=new Uint8Array(BS*4);
const RAYS_OFF=new Uint16Array(BS*4);
{
  const allRays=[];
  for(let sq=0;sq<BS;sq++){
    const r=ROW_OF[sq],c=COL_OF[sq];
    const dirs=[
      Array.from({length:COLS-1-c},(_,i)=>r*COLS+c+1+i),
      Array.from({length:c},(_,i)=>r*COLS+c-1-i),
      Array.from({length:ROWS-1-r},(_,i)=>(r+1+i)*COLS+c),
      Array.from({length:r},(_,i)=>(r-1-i)*COLS+c),
    ];
    for(let d=0;d<4;d++){
      RAYS_OFF[sq*4+d]=allRays.length;
      RAYS_LEN[sq*4+d]=dirs[d].length;
      for(const s of dirs[d])allRays.push(s);
    }
  }
  var RAYS_FLAT=new Uint8Array(allRays);
}

// KNIGHT_ATTACKS[sq] -> [[block,attacker],...]
const KN_ATK=[];const KN_MOV=[];
{
  // First build KNIGHT_MOVES (outgoing)
  for(let sq=0;sq<BS;sq++){
    const r=ROW_OF[sq],c=COL_OF[sq],moves=[];
    for(const[br,bc,tr,tc]of HORSE_STEPS){
      const blkr=r+br,blkc=c+bc,dr=r+tr,dc=c+tc;
      if(inBounds(blkr,blkc)&&inBounds(dr,dc))moves.push([blkr*COLS+blkc,dr*COLS+dc]);
    }
    KN_MOV.push(moves);
  }
  // Build KNIGHT_ATTACKS (incoming, correct blocks)
  for(let ksq=0;ksq<BS;ksq++){
    const kr=ROW_OF[ksq],kc=COL_OF[ksq],atks=[];
    for(const[bdr,bdc,tdr,tdc]of HORSE_STEPS){
      const hr=kr-tdr,hc=kc-tdc;
      if(!inBounds(hr,hc))continue;
      const blkr=hr+bdr,blkc=hc+bdc;
      if(!inBounds(blkr,blkc))continue;
      atks.push([blkr*COLS+blkc,hr*COLS+hc]);
    }
    KN_ATK.push(atks);
  }
}

const BISH_R=[],BISH_B=[];
const ADV_R=[],ADV_B=[];
const KING_R=[],KING_B=[];
const PAWN_R=[],PAWN_B=[];
for(let sq=0;sq<BS;sq++){
  const r=ROW_OF[sq],c=COL_OF[sq];
  const br=[],bb=[];
  for(const[mr,mc,tr,tc]of ELEPH_STEPS){
    const midr=r+mr,midc=c+mc,dr=r+tr,dc=c+tc;
    if(!inBounds(midr,midc)||!inBounds(dr,dc))continue;
    const s=[midr*COLS+midc,dr*COLS+dc];
    if(ownSide(dr,true))br.push(s);if(ownSide(dr,false))bb.push(s);
  }
  BISH_R.push(br);BISH_B.push(bb);
  const ar=[],ab=[],kr=[],kb=[];
  for(const[dr,dc]of[[-1,-1],[-1,1],[1,-1],[1,1]]){
    const nr=r+dr,nc=c+dc;
    if(inBounds(nr,nc)){if(inPalace(nr,nc,true))ar.push(nr*COLS+nc);if(inPalace(nr,nc,false))ab.push(nr*COLS+nc);}
  }
  for(const[dr,dc]of[[0,1],[0,-1],[1,0],[-1,0]]){
    const nr=r+dr,nc=c+dc;
    if(inBounds(nr,nc)){if(inPalace(nr,nc,true))kr.push(nr*COLS+nc);if(inPalace(nr,nc,false))kb.push(nr*COLS+nc);}
  }
  ADV_R.push(ar);ADV_B.push(ab);KING_R.push(kr);KING_B.push(kb);
  const pr=[],pb=[];
  if(r>0)pr.push((r-1)*COLS+c);if(r<ROWS-1)pb.push((r+1)*COLS+c);
  if(r<=4){if(c>0)pr.push(r*COLS+c-1);if(c<COLS-1)pr.push(r*COLS+c+1);}
  if(r>=5){if(c>0)pb.push(r*COLS+c-1);if(c<COLS-1)pb.push(r*COLS+c+1);}
  PAWN_R.push(pr);PAWN_B.push(pb);
}

// Zobrist (32-bit for speed)
const ZOB=new Int32Array(15*BS);
let SIDE_KEY;
{let s=12345;for(let i=0;i<15*BS;i++){s^=s<<13;s^=s>>17;s^=s<<5;ZOB[i]=s;}s^=s<<13;s^=s>>17;s^=s<<5;SIDE_KEY=s;}

// LMR table
const LMR=new Uint8Array(64*64);
for(let d=1;d<64;d++)for(let m=1;m<64;m++)LMR[d*64+m]=Math.max(0,Math.round(1.0+Math.log(d)*Math.log(m)/1.75));
const LMP_THR=[0,4,7,12,18,26,36,48];
const FUT_MAR=[0,100,200,310,430,560,700,850,1010];
const RFP_MAR=[0,80,160,250,350,460,580,710,850];

// ============================================================
// Board state
// ============================================================
const sq_=new Int8Array(BS);
let redTurn=true,redKing_=-1,blackKing_=-1;
let score_=0,hash_=0;
let redPh=0,blackPh=0,redAdv=0,blackAdv=0,redBish=0,blackBish=0;
let redCrP=0,blackCrP=0;

// POLICY_WEIGHTS_ANCHOR

function loadFen(fen){
  sq_.fill(0);redKing_=-1;blackKing_=-1;score_=0;hash_=0;
  redPh=0;blackPh=0;redAdv=0;blackAdv=0;redBish=0;blackBish=0;
  redCrP=0;blackCrP=0;
  const parts=fen.split(' '),rows=parts[0].split('/');
  for(let r=0;r<rows.length;r++){
    let c=0;
    for(const ch of rows[r]){
      if(ch>='1'&&ch<='9'){c+=parseInt(ch);continue;}
      const piece=PFC[ch],s=r*COLS+c;
      sq_[s]=piece;score_+=PSQ[(piece+PO)*BS+s];hash_^=ZOB[(piece+PO)*BS+s];
      const pt=piece>0?piece:-piece;
      if(piece>0){redPh+=PHASE_W[pt];if(pt===A)redAdv++;else if(pt===B)redBish++;else if(pt===P&&r<=4)redCrP++;}
      else{blackPh+=PHASE_W[pt];if(pt===A)blackAdv++;else if(pt===B)blackBish++;else if(pt===P&&r>=5)blackCrP++;}
      if(piece===K)redKing_=s;else if(piece===-K)blackKing_=s;
      c++;
    }
  }
  redTurn=parts.length<=1||parts[1]==='w';
  if(!redTurn)hash_^=SIDE_KEY;
}

function boardEval(){
  let s=score_;
  // King safety
  const ra=Math.min(redAdv,2),rb=Math.min(redBish,2);
  const ba=Math.min(blackAdv,2),bb=Math.min(blackBish,2);
  s+=KS_TABLE[ra][rb]-KS_TABLE[ba][bb];
  // Crossed pawns
  s+=redCrP*25-blackCrP*25;
  // King file danger
  if(redKing_>=0){const kc=COL_OF[redKing_];for(let r=0;r<ROWS;r++){const p=sq_[r*COLS+kc];if(p<0){const pt=-p;if(pt===R)s-=35;else if(pt===C)s-=25;}}}
  if(blackKing_>=0){const kc=COL_OF[blackKing_];for(let r=0;r<ROWS;r++){const p=sq_[r*COLS+kc];if(p>0){if(p===R)s+=35;else if(p===C)s+=25;}}}
  return redTurn?s:-s;
}

function makeMove(move){
  const fr=(move/MS)|0,to=move-fr*MS;
  const piece=sq_[fr],cap=sq_[to];
  hash_^=ZOB[(piece+PO)*BS+fr]^ZOB[(piece+PO)*BS+to]^SIDE_KEY;
  if(cap)hash_^=ZOB[(cap+PO)*BS+to];
  score_-=PSQ[(piece+PO)*BS+fr];score_+=PSQ[(piece+PO)*BS+to];
  if(cap){
    score_-=PSQ[(cap+PO)*BS+to];
    const pt=cap>0?cap:-cap;
    if(cap>0){redPh-=PHASE_W[pt];if(pt===A)redAdv--;else if(pt===B)redBish--;else if(pt===P&&ROW_OF[to]<=4)redCrP--;}
    else{blackPh-=PHASE_W[pt];if(pt===A)blackAdv--;else if(pt===B)blackBish--;else if(pt===P&&ROW_OF[to]>=5)blackCrP--;}
  }
  if(piece===P&&ROW_OF[fr]>4&&ROW_OF[to]<=4)redCrP++;
  else if(piece===-P&&ROW_OF[fr]<5&&ROW_OF[to]>=5)blackCrP++;
  sq_[to]=piece;sq_[fr]=EMPTY;
  if(piece===K)redKing_=to;else if(piece===-K)blackKing_=to;
  if(cap===K)redKing_=-1;else if(cap===-K)blackKing_=-1;
  redTurn=!redTurn;
  return cap;
}

function undoMove(move,cap){
  const fr=(move/MS)|0,to=move-fr*MS;
  const piece=sq_[to];
  redTurn=!redTurn;hash_^=SIDE_KEY^ZOB[(piece+PO)*BS+to]^ZOB[(piece+PO)*BS+fr];
  if(cap)hash_^=ZOB[(cap+PO)*BS+to];
  score_-=PSQ[(piece+PO)*BS+to];score_+=PSQ[(piece+PO)*BS+fr];
  if(cap){
    score_+=PSQ[(cap+PO)*BS+to];
    const pt=cap>0?cap:-cap;
    if(cap>0){redPh+=PHASE_W[pt];if(pt===A)redAdv++;else if(pt===B)redBish++;else if(pt===P&&ROW_OF[to]<=4)redCrP++;}
    else{blackPh+=PHASE_W[pt];if(pt===A)blackAdv++;else if(pt===B)blackBish++;else if(pt===P&&ROW_OF[to]>=5)blackCrP++;}
  }
  if(piece===P&&ROW_OF[fr]>4&&ROW_OF[to]<=4)redCrP--;
  else if(piece===-P&&ROW_OF[fr]<5&&ROW_OF[to]>=5)blackCrP--;
  sq_[fr]=piece;sq_[to]=cap;
  if(piece===K)redKing_=fr;else if(piece===-K)blackKing_=fr;
  if(cap===K)redKing_=to;else if(cap===-K)blackKing_=to;
}

function inCheck(red){
  const kingSq=red?redKing_:blackKing_;
  if(kingSq<0)return true;
  const side=red?1:-1;
  // Ray attacks (R, C, flying general)
  for(let d=0;d<4;d++){
    const off=RAYS_OFF[kingSq*4+d],len=RAYS_LEN[kingSq*4+d];
    let found=0;
    for(let i=0;i<len;i++){
      const pos=RAYS_FLAT[off+i],piece=sq_[pos];
      if(!piece)continue;
      if(found===0){
        if(piece*side<0){const pt=piece>0?piece:-piece;if(pt===R||pt===K)return true;}
        found=1;
      }else{
        if(piece*side<0&&(piece===C||piece===-C))return true;
        break;
      }
    }
  }
  // Knight attacks (correct blocks)
  for(const[block,pos]of KN_ATK[kingSq]){
    if(sq_[block])continue;
    const piece=sq_[pos];
    if(piece*side<0&&(piece===N||piece===-N))return true;
  }
  // Pawn attacks
  const c=COL_OF[kingSq];
  if(red){
    if(kingSq>=COLS&&sq_[kingSq-COLS]===-P)return true;
    if(c>0&&sq_[kingSq-1]===-P)return true;
    if(c<COLS-1&&sq_[kingSq+1]===-P)return true;
  }else{
    if(kingSq+COLS<BS&&sq_[kingSq+COLS]===P)return true;
    if(c>0&&sq_[kingSq-1]===P)return true;
    if(c<COLS-1&&sq_[kingSq+1]===P)return true;
  }
  return false;
}

function genPseudo(buf){
  const side=redTurn?1:-1;
  const bsteps=side>0?BISH_R:BISH_B,asteps=side>0?ADV_R:ADV_B;
  const ksteps=side>0?KING_R:KING_B,psteps=side>0?PAWN_R:PAWN_B;
  let cnt=0;
  for(let fr=0;fr<BS;fr++){
    const piece=sq_[fr];if(piece*side<=0)continue;
    const pt=piece>0?piece:-piece,base=fr*MS;
    if(pt===R){
      for(let d=0;d<4;d++){const off=RAYS_OFF[fr*4+d],len=RAYS_LEN[fr*4+d];
        for(let i=0;i<len;i++){const to=RAYS_FLAT[off+i],t=sq_[to];
          if(!t){buf[cnt++]=base+to;continue;}if(t*side<0)buf[cnt++]=base+to;break;}}
    }else if(pt===C){
      for(let d=0;d<4;d++){const off=RAYS_OFF[fr*4+d],len=RAYS_LEN[fr*4+d];let jumped=false;
        for(let i=0;i<len;i++){const to=RAYS_FLAT[off+i],t=sq_[to];
          if(!jumped){if(!t){buf[cnt++]=base+to;continue;}jumped=true;}
          else if(t){if(t*side<0)buf[cnt++]=base+to;break;}}}
    }else if(pt===N){
      for(const[block,to]of KN_MOV[fr]){if(sq_[block])continue;if(sq_[to]*side<=0)buf[cnt++]=base+to;}
    }else if(pt===B){
      for(const[block,to]of bsteps[fr]){if(!sq_[block]&&sq_[to]*side<=0)buf[cnt++]=base+to;}
    }else if(pt===A){
      for(const to of asteps[fr]){if(sq_[to]*side<=0)buf[cnt++]=base+to;}
    }else if(pt===K){
      for(const to of ksteps[fr]){if(sq_[to]*side<=0)buf[cnt++]=base+to;}
    }else{
      for(const to of psteps[fr]){if(sq_[to]*side<=0)buf[cnt++]=base+to;}
    }
  }
  return cnt;
}

function genCaptures(buf){
  const side=redTurn?1:-1;
  const bsteps=side>0?BISH_R:BISH_B,asteps=side>0?ADV_R:ADV_B;
  const ksteps=side>0?KING_R:KING_B,psteps=side>0?PAWN_R:PAWN_B;
  let cnt=0;
  for(let fr=0;fr<BS;fr++){
    const piece=sq_[fr];if(piece*side<=0)continue;
    const pt=piece>0?piece:-piece,base=fr*MS;
    if(pt===R){
      for(let d=0;d<4;d++){const off=RAYS_OFF[fr*4+d],len=RAYS_LEN[fr*4+d];
        for(let i=0;i<len;i++){const to=RAYS_FLAT[off+i],t=sq_[to];if(!t)continue;if(t*side<0)buf[cnt++]=base+to;break;}}
    }else if(pt===C){
      for(let d=0;d<4;d++){const off=RAYS_OFF[fr*4+d],len=RAYS_LEN[fr*4+d];let jumped=false;
        for(let i=0;i<len;i++){const to=RAYS_FLAT[off+i],t=sq_[to];
          if(!jumped){if(t)jumped=true;continue;}if(t){if(t*side<0)buf[cnt++]=base+to;break;}}}
    }else if(pt===N){for(const[block,to]of KN_MOV[fr]){if(!sq_[block]&&sq_[to]*side<0)buf[cnt++]=base+to;}
    }else if(pt===B){for(const[block,to]of bsteps[fr]){if(!sq_[block]&&sq_[to]*side<0)buf[cnt++]=base+to;}
    }else if(pt===A){for(const to of asteps[fr]){if(sq_[to]*side<0)buf[cnt++]=base+to;}
    }else if(pt===K){for(const to of ksteps[fr]){if(sq_[to]*side<0)buf[cnt++]=base+to;}
    }else{for(const to of psteps[fr]){if(sq_[to]*side<0)buf[cnt++]=base+to;}}
  }
  return cnt;
}

// ============================================================
// Transposition table
// ============================================================
const TT_SZ=1<<21,TT_MASK=TT_SZ-1;
const ttD=new Int8Array(TT_SZ),ttF=new Int8Array(TT_SZ);
const ttS=new Int16Array(TT_SZ),ttM=new Int32Array(TT_SZ),ttK=new Int32Array(TT_SZ);
function ttStore(key,depth,flag,sc,move,ply){
  const idx=key&TT_MASK;
  if(ttK[idx]===key&&ttD[idx]>depth)return;
  ttK[idx]=key;ttD[idx]=depth;ttF[idx]=flag;
  ttS[idx]=sc>MATE_V-MAX_PLY?sc+ply:sc<-MATE_V+MAX_PLY?sc-ply:sc;
  ttM[idx]=move;
}
function ttRead(key){const idx=key&TT_MASK;return ttK[idx]===key?idx:-1;}
function ttSc(idx,ply){const s=ttS[idx];return s>MATE_V-MAX_PLY?s-ply:s<-MATE_V+MAX_PLY?s+ply:s;}

// ============================================================
// Search state
// ============================================================
let nodes_=0,hardStop_=0,startTime_=0,stopped_=false,bestRoot_=NO_MOVE;
const hist_=new Int32Array(BS*BS);
const killers_=new Int32Array(MAX_PLY*2);
const cm_=new Int32Array(BS*BS);
const eStack_=new Int32Array(MAX_PLY);
const posHist_=new Set();
let singularSkip_=NO_MOVE;

// History malus: track quiet moves searched before cutoff
const quietTried_=[];
for(let i=0;i<MAX_PLY;i++)quietTried_.push(new Int32Array(120));
const quietCount_=new Int32Array(MAX_PLY);

// Per-ply move/score buffers
const mBuf=[],sBuf=[];
for(let i=0;i<MAX_PLY;i++){mBuf.push(new Int32Array(120));sBuf.push(new Int32Array(120));}

function newGame(){
  ttK.fill(0);ttD.fill(0);hist_.fill(0);killers_.fill(NO_MOVE);cm_.fill(NO_MOVE);posHist_.clear();
}

function now(){return performance.now();}

function think(wtime,btime,winc,binc,movetime,maxDepth){
  const myTime=redTurn?wtime:btime,myInc=redTurn?winc:binc;
  let soft,hard;
  if(movetime!=null){soft=Math.max(10,movetime);hard=soft;}
  else{if(myInc>0&&myTime>myInc*2){soft=myInc*0.85+myTime*0.02;hard=Math.min(myTime*0.35,myInc*2.5);}else{soft=myTime/25+myInc*0.75;hard=Math.min(myTime*0.4,soft*5);}soft=Math.min(soft,myTime*0.3);soft=Math.max(soft,30);hard=Math.max(hard,50);}
  const t0=now();startTime_=t0;
  const softStop=t0+soft;hardStop_=t0+hard;
  stopped_=false;nodes_=0;bestRoot_=NO_MOVE;singularSkip_=NO_MOVE;
  for(let i=0;i<hist_.length;i++)hist_[i]>>=3;
  let best=NO_MOVE,sc=0,prevSc=0;
  for(let depth=1;depth<=maxDepth;depth++){
    let window=depth>=4?25:INF;
    let alpha=depth<5?-INF:Math.max(-INF,sc-window);
    let beta=depth<5?INF:Math.min(INF,sc+window);
    while(true){
      bestRoot_=best;
      const sn=search(depth,alpha,beta,0,true,NO_MOVE);
      if(stopped_&&depth>1)return best!==NO_MOVE?best:bestRoot_;
      if(depth<4||alpha===-INF||beta===INF){sc=sn;break;}
      if(sn<=alpha){alpha=Math.max(-INF,alpha-window);window*=2;continue;}
      if(sn>=beta){beta=Math.min(INF,beta+window);window*=2;continue;}
      sc=sn;break;
    }
    if(bestRoot_!==NO_MOVE)best=bestRoot_;
    const elapsed=((now()-startTime_)|0);
    out(`info depth ${depth} score cp ${sc} nodes ${nodes_} time ${elapsed} pv ${m2uci(best)}`);
    if(Math.abs(sc)>MATE_V-MAX_PLY)break;
    if(depth>=5&&prevSc-sc>25){const ns=Math.min(hardStop_,startTime_+(now()-startTime_)*1.5);if(ns>softStop)/* extend */;}
    if(now()>softStop)break;
    prevSc=sc;
  }
  return best;
}

function search(depth,alpha,beta,ply,allowNull,prevMove){
  nodes_++;
  if((nodes_&4095)===0&&now()>hardStop_){stopped_=true;return 0;}
  if(ply>=MAX_PLY-1)return boardEval();
  const red=redTurn,ic=inCheck(red);
  if(ic)depth++;
  if(depth<=0)return qs(alpha,beta,ply,0);
  const key=hash_;
  if(ply>0&&posHist_.has(key))return 0;
  const origAlpha=alpha;
  let ttMove=NO_MOVE;
  const ttIdx=ttRead(key);
  let ttHit=false,ttEntryDepth=0,ttEntryScore=0,ttEntryFlag=0;
  if(ttIdx>=0){
    ttMove=ttM[ttIdx];
    ttHit=true;
    ttEntryDepth=ttD[ttIdx];
    ttEntryFlag=ttF[ttIdx];
    ttEntryScore=ttSc(ttIdx,ply);
    if(ttEntryDepth>=depth){
      const ts=ttEntryScore,tf=ttEntryFlag;
      if(tf===TT_EXACT)return ts;
      if(tf===TT_LOWER){if(ts>=beta)return ts;if(ts>alpha)alpha=ts;}
      else{if(ts<=alpha)return ts;if(ts<beta)beta=ts;}
      if(alpha>=beta)return ts;
    }
  }
  const staticEval=boardEval();
  eStack_[ply]=staticEval;
  const improving=ply>=2&&staticEval>eStack_[ply-2];
  if(!ic){
    if(depth<=8){const mg=RFP_MAR[depth]+(improving?0:50);if(staticEval-mg>=beta)return staticEval;}
    if(depth<=3&&staticEval+250+200*depth<=alpha){const s=qs(alpha,beta,ply,0);if(s<=alpha)return s;}
    if(allowNull&&depth>=3&&(red?redPh>0:blackPh>0)){
      let rn=3+((depth*2/7)|0);if(staticEval>=beta)rn+=Math.min(3,((staticEval-beta)/200)|0);
      redTurn=!redTurn;hash_^=SIDE_KEY;
      const s=-search(depth-1-rn,-beta,-beta+1,ply+1,false,NO_MOVE);
      redTurn=!redTurn;hash_^=SIDE_KEY;
      if(stopped_)return 0;if(s>=beta)return beta;
    }
  }
  let singularExt=0;
  if(depth>=8&&ttHit&&ttMove!==NO_MOVE&&ttEntryDepth>=depth-3
     &&(ttEntryFlag===TT_EXACT||ttEntryFlag===TT_LOWER)
     &&Math.abs(ttEntryScore)<MATE_V-MAX_PLY){
    const seBeta=ttEntryScore-3*depth;
    const seDepth=(depth>>1);
    singularSkip_=ttMove;
    const seScore=search(seDepth,seBeta-1,seBeta,ply,false,prevMove);
    singularSkip_=NO_MOVE;
    if(!stopped_&&seScore<seBeta){
      singularExt=1;
    }
  }
  let sd=depth;if(depth>=3&&ttMove===NO_MOVE)sd--;
  const moves=mBuf[ply],scores=sBuf[ply];
  const nMoves=genPseudo(moves);
  const k0=killers_[ply*2],k1=killers_[ply*2+1];
  const cmv=prevMove>=0?cm_[prevMove]:NO_MOVE;
  // Score moves inline
  const hasPol=typeof polPrior==='function';
  for(let i=0;i<nMoves;i++){
    const m=moves[i];
    if(m===ttMove){scores[i]=2000000;continue;}
    const to=m%MS,capP=sq_[to];
    if(capP){const fr=(m/MS)|0,att=sq_[fr];scores[i]=1000000+(MAT[capP>0?capP:-capP]<<4)-MAT[att>0?att:-att]+(hasPol?(polPrior(m)>>4):0);}
    else if(m===k0)scores[i]=900000;
    else if(m===k1)scores[i]=800000;
    else if(m===cmv)scores[i]=700000;
    else scores[i]=hist_[m]+(hasPol?(polPrior(m)>>2):0);
  }
  let bestMove=ttMove,bestScore=-INF,legal=0,searched=0;
  quietCount_[ply]=0;
  for(let i=0;i<nMoves;i++){
    // Selection sort
    let bi=i,bs=scores[i];
    for(let j=i+1;j<nMoves;j++){if(scores[j]>bs){bs=scores[j];bi=j;}}
    if(bi!==i){const tm=moves[i],ts=scores[i];moves[i]=moves[bi];scores[i]=scores[bi];moves[bi]=tm;scores[bi]=ts;}
    const move=moves[i];
    if(move===singularSkip_)continue;
    const cap=makeMove(move);
    if(inCheck(red)){undoMove(move,cap);continue;}
    legal++;const isQ=!cap;
    if(isQ&&!ic&&bestScore>-MATE_V+MAX_PLY){
      if(sd<=7){const thr=LMP_THR[sd]+(improving?4:0);if(searched>=thr&&(!hasPol||polPrior(move)<0)){undoMove(move,cap);continue;}}
      if(sd<=8){const mg=FUT_MAR[sd]+(improving?80:0);if(staticEval+mg<=alpha){undoMove(move,cap);continue;}}
      if(sd<=5&&searched>=3&&hist_[move]<-(sd*sd*64)){undoMove(move,cap);continue;}
    }
    searched++;
    if(isQ)quietTried_[ply][quietCount_[ply]++]=move;
    const ext=(move===ttMove&&singularExt)?1:0;
    const searchDepth=sd-1+ext;
    let sc;
    if(searched===1){sc=-search(searchDepth,-beta,-alpha,ply+1,true,move);}
    else{
      let red_=0;
      if(isQ&&sd>=3&&searched>=3&&!ic){
        red_=LMR[Math.min(sd,63)*64+Math.min(searched,63)];
        if(!improving)red_++;if(move===k0||move===k1)red_--;if(move===cmv)red_--;
        if(hist_[move]>500)red_--;if(hist_[move]<-500)red_++;red_=Math.max(0,Math.min(red_,sd-2));
      }
      sc=-search(searchDepth-red_,-alpha-1,-alpha,ply+1,true,move);
      if(red_>0&&sc>alpha)sc=-search(searchDepth,-alpha-1,-alpha,ply+1,true,move);
      if(sc>alpha&&sc<beta)sc=-search(searchDepth,-beta,-alpha,ply+1,true,move);
    }
    undoMove(move,cap);if(stopped_)return 0;
    if(sc>bestScore)bestScore=sc;
    if(sc>alpha){
      alpha=sc;bestMove=move;if(ply===0)bestRoot_=move;
      if(alpha>=beta){
        {if(isQ){if(move!==k0){killers_[ply*2+1]=k0;killers_[ply*2]=move;}}const hb=depth*depth;hist_[move]+=hb;for(let qi=0;qi<quietCount_[ply];qi++){const qm=quietTried_[ply][qi];if(qm!==move)hist_[qm]-=hb;}if(prevMove>=0)cm_[prevMove]=move;}
        ttStore(key,depth,TT_LOWER,alpha,move,ply);return alpha;
      }
    }
  }
  if(!legal)return-MATE_V+ply;
  ttStore(key,depth,bestScore<=origAlpha?TT_UPPER:TT_EXACT,bestScore,bestMove,ply);
  return bestScore;
}

function qs(alpha,beta,ply,qsPly){
  nodes_++;if((nodes_&4095)===0&&now()>hardStop_){stopped_=true;return 0;}
  const red=redTurn;
  if(inCheck(red))return qsEvasion(alpha,beta,ply,qsPly);
  const sp=boardEval();
  if(sp>=beta)return beta;if(sp>alpha)alpha=sp;
  if(ply>=MAX_PLY-1||qsPly>=MAX_QS)return alpha;
  if(sp+800<alpha)return alpha;
  const buf=mBuf[ply],scBuf=sBuf[ply];
  const nCap=genCaptures(buf);
  for(let i=0;i<nCap;i++){const m=buf[i],to=m%MS,fr=(m/MS)|0,v=sq_[to],a=sq_[fr];scBuf[i]=(MAT[v>0?v:-v]<<4)-MAT[a>0?a:-a];}
  for(let i=0;i<nCap;i++){
    let bi=i,bs=scBuf[i];for(let j=i+1;j<nCap;j++){if(scBuf[j]>bs){bs=scBuf[j];bi=j;}}
    if(bi!==i){const tm=buf[i],ts=scBuf[i];buf[i]=buf[bi];scBuf[i]=scBuf[bi];buf[bi]=tm;scBuf[bi]=ts;}
    const move=buf[i],to=move%MS,victim=sq_[to];
    if(sp+MAT[victim>0?victim:-victim]+100<alpha)continue;
    if(scBuf[i]<-200&&sp<alpha+50)continue;
    const cap=makeMove(move);
    if(inCheck(red)){undoMove(move,cap);continue;}
    const sc=-qs(-beta,-alpha,ply+1,qsPly+1);
    undoMove(move,cap);if(stopped_)return 0;
    if(sc>=beta)return beta;if(sc>alpha)alpha=sc;
  }
  return alpha;
}

function qsEvasion(alpha,beta,ply,qsPly){
  if(ply>=MAX_PLY-1)return boardEval();
  const red=redTurn,buf=mBuf[ply];
  const n=genPseudo(buf);let bestSc=-INF,legal=0;
  for(let i=0;i<n;i++){
    const move=buf[i],cap=makeMove(move);
    if(inCheck(red)){undoMove(move,cap);continue;}
    legal++;const sc=-qs(-beta,-alpha,ply+1,qsPly+1);
    undoMove(move,cap);if(stopped_)return 0;
    if(sc>bestSc)bestSc=sc;if(sc>=beta)return beta;if(sc>alpha)alpha=sc;
  }
  return legal?bestSc:-MATE_V+ply;
}

// ============================================================
// UCI
// ============================================================
function m2uci(move){
  if(move===NO_MOVE)return"0000";
  const fr=(move/MS)|0,to=move-fr*MS;
  return String.fromCharCode(97+COL_OF[fr])+(9-ROW_OF[fr])+String.fromCharCode(97+COL_OF[to])+(9-ROW_OF[to]);
}
function uci2m(s){
  const fc=s.charCodeAt(0)-97,fr=9-parseInt(s[1]),tc=s.charCodeAt(2)-97,tr=9-parseInt(s[3]);
  return(fr*COLS+fc)*MS+(tr*COLS+tc);
}
function out(s){process.stdout.write(s+'\n');}

loadFen(START_FEN);

const readline=require('readline');
const rl=readline.createInterface({input:process.stdin,terminal:false});
rl.on('line',(line)=>{
  const l=line.trim();if(!l)return;
  if(l==='uci'){out('id name XiangqiEngine-JS-v9b');out('id author Codex');out('uciok');}
  else if(l==='isready'){out('readyok');}
  else if(l==='ucinewgame'){newGame();loadFen(START_FEN);}
  else if(l.startsWith('position')){
    const t=l.split(' ');
    if(t.includes('fen')){const fi=t.indexOf('fen'),ei=t.includes('moves')?t.indexOf('moves'):t.length;loadFen(t.slice(fi+1,ei).join(' '));}
    else if(t.includes('startpos'))loadFen(START_FEN);
    posHist_.clear();
    if(t.includes('moves')){const mi=t.indexOf('moves');for(let i=mi+1;i<t.length;i++){posHist_.add(hash_);makeMove(uci2m(t[i]));}}
  }
  else if(l.startsWith('go')){
    const t=l.split(' ');let wt=60000,bt=60000,wi=0,bi=0,mt=null,md=64;
    for(let i=0;i<t.length;i++){
      if(t[i]==='wtime')wt=parseInt(t[i+1]);else if(t[i]==='btime')bt=parseInt(t[i+1]);
      else if(t[i]==='winc')wi=parseInt(t[i+1]);else if(t[i]==='binc')bi=parseInt(t[i+1]);
      else if(t[i]==='movetime')mt=parseInt(t[i+1]);else if(t[i]==='depth')md=parseInt(t[i+1]);
    }
    let best=think(wt,bt,wi,bi,mt,md);
    if(best===NO_MOVE){// fallback: gen legal
      const red=redTurn,buf=mBuf[0],n=genPseudo(buf);
      for(let i=0;i<n;i++){const cap=makeMove(buf[i]);const ok=!inCheck(red);undoMove(buf[i],cap);if(ok){best=buf[i];break;}}
    }
    out(`bestmove ${m2uci(best)}`);
  }
  else if(l==='quit'){process.exit(0);}
});
