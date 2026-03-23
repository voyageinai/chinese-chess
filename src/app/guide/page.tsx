"use client";

import { useState } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  MessageSquare,
  Terminal,
  Upload,
  Trophy,
  ArrowRight,
  ArrowDown,
  CheckCircle2,
  Copy,
  Check,
  BookOpen,
  Cpu,
  Zap,
  Globe,
} from "lucide-react";
import Link from "next/link";

/* ── tiny copy button ───────────────────────────── */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="absolute top-3 right-3 p-1.5 rounded bg-paper-300/60 hover:bg-paper-300 text-ink-muted hover:text-ink transition-colors"
      title="复制代码"
    >
      {copied ? (
        <Check className="w-3.5 h-3.5" />
      ) : (
        <Copy className="w-3.5 h-3.5" />
      )}
    </button>
  );
}

/* ── code block ─────────────────────────────────── */
function Code({
  children,
  language,
}: {
  children: string;
  language?: string;
}) {
  return (
    <div className="relative group">
      {language && (
        <span className="absolute top-2 left-3 text-[10px] uppercase tracking-wider text-ink-muted/60">
          {language}
        </span>
      )}
      <CopyButton text={children} />
      <pre className="bg-paper-300/40 border border-paper-300 rounded-lg p-4 pt-7 overflow-x-auto text-sm font-mono leading-relaxed text-ink-light">
        {children}
      </pre>
    </div>
  );
}

/* ── protocol message bubble ────────────────────── */
function ProtocolMessage({
  from,
  children,
}: {
  from: "platform" | "engine";
  children: string;
}) {
  const isPlatform = from === "platform";
  return (
    <div
      className={`flex ${isPlatform ? "justify-start" : "justify-end"} my-1.5`}
    >
      <div
        className={`relative max-w-[85%] px-4 py-2.5 rounded-2xl font-mono text-sm ${
          isPlatform
            ? "bg-paper-300/60 text-ink-light rounded-bl-sm"
            : "bg-vermilion/10 text-vermilion rounded-br-sm"
        }`}
      >
        <span className="block text-[10px] uppercase tracking-wider mb-1 opacity-50">
          {isPlatform ? "平台 →" : "← 引擎"}
        </span>
        <span className="whitespace-pre-wrap break-all">{children}</span>
      </div>
    </div>
  );
}

/* ── step component ─────────────────────────────── */
function Step({
  number,
  title,
  description,
  children,
  icon: Icon,
}: {
  number: number;
  title: string;
  description: string;
  children: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="relative">
      {/* connector line */}
      <div className="absolute left-6 top-14 bottom-0 w-px bg-paper-300" />
      <div className="flex items-start gap-4">
        {/* step marker */}
        <div className="relative z-10 w-12 h-12 rounded-full bg-paper-200 border-2 border-paper-400 flex items-center justify-center shrink-0">
          <Icon className="w-5 h-5 text-ink-light" />
        </div>
        <div className="flex-1 pb-12">
          <div className="flex items-center gap-3 mb-1">
            <Badge variant="outline" className="font-mono text-xs">
              Step {number}
            </Badge>
            <h3 className="text-lg font-semibold text-ink">{title}</h3>
          </div>
          <p className="text-ink-muted mb-4">{description}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

/* ── board diagram ──────────────────────────────── */
function BoardDiagram() {
  const lines = [
    "  a b c d e f g h i",
    "9 r n b a k a b n r   ← 黑方",
    "8 · · · · · · · · ·",
    "7 · c · · · · · c ·",
    "6 p · p · p · p · p",
    "5 · · · · · · · · ·   ← 楚河 ——— 汉界",
    "4 · · · · · · · · ·",
    "3 P · P · P · P · P",
    "2 · C · · · · · C ·",
    "1 · · · · · · · · ·",
    "0 R N B A K A B N R   ← 红方",
  ];
  return (
    <div className="bg-paper-300/30 border border-paper-300 rounded-lg p-4 overflow-x-auto">
      <pre className="font-mono text-sm leading-relaxed">
        {lines.map((line, i) => (
          <div key={i}>
            {line.split("").map((ch, j) => {
              if ("rnbackp".includes(ch))
                return (
                  <span key={j} className="text-ink font-bold">
                    {ch}
                  </span>
                );
              if ("RNBACKP".includes(ch))
                return (
                  <span key={j} className="text-vermilion font-bold">
                    {ch}
                  </span>
                );
              if (ch === "·")
                return (
                  <span key={j} className="text-paper-400">
                    {ch}
                  </span>
                );
              if (ch === "←")
                return (
                  <span key={j} className="text-ink-muted">
                    {ch}
                  </span>
                );
              return <span key={j}>{ch}</span>;
            })}
          </div>
        ))}
      </pre>
    </div>
  );
}

/* ── piece legend ───────────────────────────────── */
const PIECES = [
  { letter: "K/k", red: "帅", black: "将", name: "King" },
  { letter: "A/a", red: "仕", black: "士", name: "Advisor" },
  { letter: "B/b", red: "相", black: "象", name: "Bishop" },
  { letter: "R/r", red: "车", black: "车", name: "Rook" },
  { letter: "N/n", red: "马", black: "马", name: "Knight" },
  { letter: "C/c", red: "炮", black: "炮", name: "Cannon" },
  { letter: "P/p", red: "兵", black: "卒", name: "Pawn" },
];

/* ── main page ──────────────────────────────────── */
export default function GuidePage() {
  const pythonExample = `#!/usr/bin/env python3
"""最简象棋引擎 — 随机走子"""
import sys, random

INIT_FEN = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1"

def main():
    for line in sys.stdin:
        cmd = line.strip()

        if cmd == "uci":
            print("id name MyEngine")
            print("id author Me")
            print("uciok")
            sys.stdout.flush()

        elif cmd == "isready":
            print("readyok")
            sys.stdout.flush()

        elif cmd.startswith("position"):
            pass  # 解析局面（你的棋盘逻辑）

        elif cmd.startswith("go"):
            # 在这里实现你的搜索算法
            # 这里用固定走法演示
            print("info depth 1 score cp 0")
            print("bestmove h2e2")
            sys.stdout.flush()

        elif cmd == "quit":
            break

if __name__ == "__main__":
    main()`;

  const cppExample = `#include <iostream>
#include <string>
using namespace std;

int main() {
    string line;
    while (getline(cin, line)) {

        if (line == "uci") {
            cout << "id name MyCppEngine" << endl;
            cout << "id author Me" << endl;
            cout << "uciok" << endl;

        } else if (line == "isready") {
            cout << "readyok" << endl;

        } else if (line.substr(0, 8) == "position") {
            // 解析局面...

        } else if (line.substr(0, 2) == "go") {
            // 你的搜索算法
            cout << "info depth 1 score cp 0" << endl;
            cout << "bestmove h2e2" << endl;

        } else if (line == "quit") {
            break;
        }
    }
    return 0;
}`;

  const jsExample = `#!/usr/bin/env node
const readline = require("readline");
const rl = readline.createInterface({ input: process.stdin });

rl.on("line", (line) => {
  const cmd = line.trim();

  if (cmd === "uci") {
    console.log("id name MyJSEngine");
    console.log("id author Me");
    console.log("uciok");

  } else if (cmd === "isready") {
    console.log("readyok");

  } else if (cmd.startsWith("position")) {
    // 解析局面...

  } else if (cmd.startsWith("go")) {
    // 你的搜索算法
    console.log("info depth 1 score cp 0");
    console.log("bestmove h2e2");

  } else if (cmd === "quit") {
    process.exit(0);
  }
});`;

  const goExample = `package main

import (
    "bufio"
    "fmt"
    "os"
    "strings"
)

func main() {
    scanner := bufio.NewScanner(os.Stdin)
    for scanner.Scan() {
        cmd := strings.TrimSpace(scanner.Text())

        switch {
        case cmd == "uci":
            fmt.Println("id name MyGoEngine")
            fmt.Println("id author Me")
            fmt.Println("uciok")

        case cmd == "isready":
            fmt.Println("readyok")

        case strings.HasPrefix(cmd, "position"):
            // 解析局面...

        case strings.HasPrefix(cmd, "go"):
            // 你的搜索算法
            fmt.Println("info depth 1 score cp 0")
            fmt.Println("bestmove h2e2")

        case cmd == "quit":
            return
        }
    }
}`;

  return (
    <div className="max-w-4xl mx-auto">
      {/* Hero */}
      <header className="text-center py-10">
        <h1 className="font-brush text-4xl text-ink">引擎接入指南</h1>
        <p className="mt-3 text-ink-muted text-lg max-w-2xl mx-auto">
          将你的象棋 AI 接入擂台，与其他引擎一决高下。
          <br />
          只需实现 5 个命令，任何语言都可以。
        </p>
      </header>

      {/* Quick overview cards */}
      <div className="grid sm:grid-cols-3 gap-4 mb-12">
        <Card className="text-center">
          <CardContent className="pt-6">
            <Terminal className="w-8 h-8 mx-auto mb-2 text-ink-muted" />
            <p className="font-semibold text-ink">UCI 协议</p>
            <p className="text-sm text-ink-muted mt-1">
              通过 stdin/stdout 通信
            </p>
          </CardContent>
        </Card>
        <Card className="text-center">
          <CardContent className="pt-6">
            <Globe className="w-8 h-8 mx-auto mb-2 text-ink-muted" />
            <p className="font-semibold text-ink">任何语言</p>
            <p className="text-sm text-ink-muted mt-1">
              Python / C++ / Go / Rust / JS ...
            </p>
          </CardContent>
        </Card>
        <Card className="text-center">
          <CardContent className="pt-6">
            <Zap className="w-8 h-8 mx-auto mb-2 text-ink-muted" />
            <p className="font-semibold text-ink">5 个命令</p>
            <p className="text-sm text-ink-muted mt-1">
              uci / isready / position / go / quit
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Step-by-step journey */}
      <section className="mb-16">
        <h2 className="font-brush text-2xl text-ink mb-8">
          接入流程
        </h2>

        <Step
          number={1}
          title="理解 UCI 协议"
          description="你的引擎是一个可执行文件，平台通过标准输入输出和它对话。就像聊天一样——平台发消息，引擎回复。"
          icon={MessageSquare}
        >
          <Card>
            <CardHeader>
              <CardTitle className="text-base">完整对话示例</CardTitle>
              <CardDescription>一局棋的完整通信流程</CardDescription>
            </CardHeader>
            <CardContent className="space-y-0.5">
              {/* Handshake */}
              <p className="text-xs text-ink-muted uppercase tracking-wider mb-2 mt-2 font-mono">
                1. 握手
              </p>
              <ProtocolMessage from="platform">uci</ProtocolMessage>
              <ProtocolMessage from="engine">
                {"id name MyEngine\nid author zhangsan\nuciok"}
              </ProtocolMessage>

              <ProtocolMessage from="platform">isready</ProtocolMessage>
              <ProtocolMessage from="engine">readyok</ProtocolMessage>

              {/* Gameplay */}
              <p className="text-xs text-ink-muted uppercase tracking-wider mb-2 mt-6 font-mono">
                2. 对弈
              </p>
              <ProtocolMessage from="platform">
                {`position fen rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1`}
              </ProtocolMessage>
              <ProtocolMessage from="platform">
                go wtime 300000 btime 300000 winc 3000 binc 3000
              </ProtocolMessage>
              <ProtocolMessage from="engine">
                {"info depth 12 score cp 35 pv h2e2 h9g7\nbestmove h2e2"}
              </ProtocolMessage>

              <ProtocolMessage from="platform">
                {`position fen rnbakabnr/9/1c5c1/p1p1p1p1p/9/4C4/9/P1P1P1P1P/1C5c1/9/RNBAKABNR b - - 1 1`}
              </ProtocolMessage>
              <ProtocolMessage from="platform">
                go wtime 298500 btime 297000 winc 3000 binc 3000
              </ProtocolMessage>
              <ProtocolMessage from="engine">
                {"info depth 15 score cp 28 pv b0c2\nbestmove b0c2"}
              </ProtocolMessage>

              {/* End */}
              <p className="text-xs text-ink-muted uppercase tracking-wider mb-2 mt-6 font-mono">
                3. 结束
              </p>
              <ProtocolMessage from="platform">quit</ProtocolMessage>
            </CardContent>
          </Card>
        </Step>

        <Step
          number={2}
          title="了解棋盘坐标"
          description="UCI 用字母+数字表示位置，走法就是「起点+终点」四个字符。"
          icon={BookOpen}
        >
          <div className="space-y-4">
            <BoardDiagram />

            <div className="grid sm:grid-cols-2 gap-4">
              <Card>
                <CardContent className="pt-4">
                  <p className="font-semibold text-ink mb-2">坐标系</p>
                  <ul className="text-sm text-ink-light space-y-1.5">
                    <li>
                      <span className="font-mono text-vermilion">列</span>{" "}
                      a-i（从左到右，共 9 列）
                    </li>
                    <li>
                      <span className="font-mono text-vermilion">行</span>{" "}
                      0-9（0=红方底线，9=黑方底线）
                    </li>
                    <li>
                      <span className="font-mono text-vermilion">走法</span>{" "}
                      起始列行 + 目标列行
                    </li>
                  </ul>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <p className="font-semibold text-ink mb-2">示例走法</p>
                  <ul className="text-sm text-ink-light space-y-1.5">
                    <li>
                      <span className="font-mono bg-paper-300/50 px-1.5 py-0.5 rounded">
                        h2e2
                      </span>{" "}
                      炮二平五
                    </li>
                    <li>
                      <span className="font-mono bg-paper-300/50 px-1.5 py-0.5 rounded">
                        h9g7
                      </span>{" "}
                      马8进7
                    </li>
                    <li>
                      <span className="font-mono bg-paper-300/50 px-1.5 py-0.5 rounded">
                        b0c2
                      </span>{" "}
                      马二进三
                    </li>
                  </ul>
                </CardContent>
              </Card>
            </div>

            {/* Piece reference */}
            <Card>
              <CardContent className="pt-4">
                <p className="font-semibold text-ink mb-3">棋子字母对照</p>
                <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
                  {PIECES.map((p) => (
                    <div
                      key={p.letter}
                      className="text-center p-2 bg-paper-200/50 rounded-lg"
                    >
                      <div className="font-mono text-lg font-bold">
                        <span className="text-vermilion">
                          {p.letter.split("/")[0]}
                        </span>
                        /
                        <span className="text-ink">
                          {p.letter.split("/")[1]}
                        </span>
                      </div>
                      <div className="text-xs text-ink-muted mt-0.5">
                        <span className="text-vermilion">{p.red}</span> /{" "}
                        <span className="text-ink">{p.black}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </Step>

        <Step
          number={3}
          title="编写你的引擎"
          description="选一个你熟悉的语言，从模板开始。核心就是读取 stdin、回复 stdout。"
          icon={Cpu}
        >
          <Tabs defaultValue="python" className="w-full">
            <TabsList className="mb-4">
              <TabsTrigger value="python">Python</TabsTrigger>
              <TabsTrigger value="cpp">C++</TabsTrigger>
              <TabsTrigger value="js">JavaScript</TabsTrigger>
              <TabsTrigger value="go">Go</TabsTrigger>
            </TabsList>

            <TabsContent value="python">
              <Code language="python">{pythonExample}</Code>
              <div className="mt-3 p-3 bg-vermilion/5 border border-vermilion/10 rounded-lg text-sm text-ink-light">
                <p className="font-semibold text-vermilion mb-1">
                  保存 & 运行
                </p>
                <code className="font-mono text-xs">
                  chmod +x my_engine.py && ./my_engine.py
                </code>
                <p className="mt-1 text-ink-muted">
                  首行 shebang 让它可以直接作为可执行文件运行，无需额外包装。
                </p>
              </div>
            </TabsContent>

            <TabsContent value="cpp">
              <Code language="c++">{cppExample}</Code>
              <div className="mt-3 p-3 bg-vermilion/5 border border-vermilion/10 rounded-lg text-sm text-ink-light">
                <p className="font-semibold text-vermilion mb-1">
                  编译 & 运行
                </p>
                <code className="font-mono text-xs">
                  g++ -O2 -o my_engine my_engine.cpp
                </code>
              </div>
            </TabsContent>

            <TabsContent value="js">
              <Code language="javascript">{jsExample}</Code>
              <div className="mt-3 p-3 bg-vermilion/5 border border-vermilion/10 rounded-lg text-sm text-ink-light">
                <p className="font-semibold text-vermilion mb-1">
                  保存 & 运行
                </p>
                <code className="font-mono text-xs">
                  chmod +x my_engine.js && ./my_engine.js
                </code>
              </div>
            </TabsContent>

            <TabsContent value="go">
              <Code language="go">{goExample}</Code>
              <div className="mt-3 p-3 bg-vermilion/5 border border-vermilion/10 rounded-lg text-sm text-ink-light">
                <p className="font-semibold text-vermilion mb-1">
                  编译 & 运行
                </p>
                <code className="font-mono text-xs">
                  go build -o my_engine my_engine.go
                </code>
              </div>
            </TabsContent>
          </Tabs>

          <Card className="mt-6">
            <CardContent className="pt-4">
              <p className="font-semibold text-ink mb-2">
                关键要点
              </p>
              <ul className="text-sm text-ink-light space-y-2">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 mt-0.5 text-vermilion shrink-0" />
                  <span>
                    <strong>每次输出后必须 flush</strong> —
                    Python 用 <code className="font-mono text-xs bg-paper-300/50 px-1 rounded">sys.stdout.flush()</code>，
                    C++ 用 <code className="font-mono text-xs bg-paper-300/50 px-1 rounded">endl</code>
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 mt-0.5 text-vermilion shrink-0" />
                  <span>
                    <strong>FEN 棋子字母用 UCI 标准</strong> —
                    马=<code className="font-mono text-xs bg-paper-300/50 px-1 rounded">N/n</code>，
                    象=<code className="font-mono text-xs bg-paper-300/50 px-1 rounded">B/b</code>（不是 H/E）
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 mt-0.5 text-vermilion shrink-0" />
                  <span>
                    <strong>bestmove 必须是合法走子</strong> —
                    非法走法会直接判负
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 mt-0.5 text-vermilion shrink-0" />
                  <span>
                    <strong>注意时间控制</strong> —
                    go 命令里的 wtime/btime 是毫秒，超时判负
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 mt-0.5 text-vermilion shrink-0" />
                  <span>
                    <strong>info score 是可选的</strong> —
                    但提供评估值可以在对局页面显示曲线图
                  </span>
                </li>
              </ul>
            </CardContent>
          </Card>
        </Step>

        <Step
          number={4}
          title="本地测试"
          description="上传前先在终端里手动测试，确保引擎能正常对话。"
          icon={Terminal}
        >
          <Code language="bash">
            {`# 启动引擎，手动输入命令测试
./my_engine

# 输入:
uci
# 期望看到: id name ... 和 uciok

isready
# 期望看到: readyok

position fen rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1
go wtime 300000 btime 300000 winc 3000 binc 3000
# 期望看到: bestmove xxxxx

quit`}
          </Code>
          <p className="mt-3 text-sm text-ink-muted">
            如果每个命令都能正确响应，你的引擎就可以上传了。
          </p>
        </Step>

        <Step
          number={5}
          title="上传参赛"
          description="登录后在引擎页面上传，然后加入锦标赛。"
          icon={Upload}
        >
          <div className="flex flex-col sm:flex-row gap-3">
            <Link
              href="/engines"
              className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-ink text-paper-100 rounded-lg font-semibold hover:bg-ink-light transition-colors"
            >
              <Upload className="w-4 h-4" />
              上传引擎
            </Link>
            <Link
              href="/tournaments"
              className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-paper-300 text-ink rounded-lg font-semibold hover:bg-paper-400 transition-colors"
            >
              <Trophy className="w-4 h-4" />
              查看锦标赛
            </Link>
          </div>
        </Step>
      </section>

      {/* UCI Command Reference */}
      <section className="mb-16">
        <h2 className="font-brush text-2xl text-ink mb-6">
          UCI 命令速查
        </h2>

        <div className="space-y-3">
          {[
            {
              cmd: "uci",
              dir: "平台 → 引擎",
              desc: "引擎初始化，回复 id name/author 和 uciok",
            },
            {
              cmd: "isready",
              dir: "平台 → 引擎",
              desc: "检查就绪，回复 readyok",
            },
            {
              cmd: "position fen <FEN>",
              dir: "平台 → 引擎",
              desc: "用 FEN 设置当前局面（本平台每步都发完整 FEN，不用 startpos/moves）",
            },
            {
              cmd: "go wtime X btime Y winc Z binc W",
              dir: "平台 → 引擎",
              desc: "开始思考，参数为双方剩余时间和每步加秒（毫秒）",
            },
            {
              cmd: "info depth D score cp S pv ...",
              dir: "引擎 → 平台",
              desc: "（可选）搜索信息：深度、评估值（厘兵）、主要变化线",
            },
            {
              cmd: "bestmove <move>",
              dir: "引擎 → 平台",
              desc: "返回最佳走法（如 h2e2），必须是合法走子",
            },
            {
              cmd: "quit",
              dir: "平台 → 引擎",
              desc: "退出引擎",
            },
          ].map((item) => (
            <div
              key={item.cmd}
              className="flex items-start gap-3 p-3 bg-paper-200/40 rounded-lg"
            >
              <code className="font-mono text-sm font-semibold text-ink shrink-0 min-w-[280px]">
                {item.cmd}
              </code>
              <Badge variant="outline" className="shrink-0 text-[10px]">
                {item.dir}
              </Badge>
              <span className="text-sm text-ink-muted">{item.desc}</span>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="mb-16">
        <h2 className="font-brush text-2xl text-ink mb-6">常见问题</h2>
        <div className="space-y-4">
          {[
            {
              q: "引擎可以用 Python 写吗？会不会太慢？",
              a: "完全可以。Python 引擎在短时控下可能吃亏，但用于学习和实验足够了。搜索深度设浅一点，或者用 NumPy 加速关键计算。当然，追求极限性能建议用 C++ 或 Rust。",
            },
            {
              q: "如何从 position 命令里解析棋盘状态？",
              a: "本平台每步发送 position fen <当前局面FEN>，你只需解析 FEN 字符串即可还原棋盘。FEN 格式：棋子布局/走子方/…，棋子字母用 UCI 标准：R(车) N(马) B(象) A(仕) K(帅) C(炮) P(兵)，大写红方，小写黑方。",
            },
            {
              q: "score cp 是什么意思？",
              a: "cp = centipawn（厘兵），100 cp 约等于一个兵的价值。正数表示当前走子方优势。比如 score cp 150 表示优势约 1.5 个兵。score mate 3 表示 3 步内可将死。",
            },
            {
              q: "wtime/btime 是什么？",
              a: "红方(w)和黑方(b)的剩余时间，单位毫秒。winc/binc 是每步加秒。比如 wtime 300000 winc 3000 表示红方还剩 5 分钟，每走一步加 3 秒。引擎需要自行分配思考时间。",
            },
            {
              q: "我的引擎崩溃了怎么办？",
              a: "引擎进程异常退出会被判负。确保你的引擎处理好所有边界情况（非法输入、空走法列表等），不要 panic。",
            },
            {
              q: "有现成的引擎可以参考吗？",
              a: "推荐看 Pikafish（C++，当前最强）的源码，或者 Wukong Xiangqi（JavaScript，适合学习）。平台也预装了 Pikafish，你可以先用它测试锦标赛流程。",
            },
          ].map((item, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{item.q}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-ink-light leading-relaxed">
                  {item.a}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
