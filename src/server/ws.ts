import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import type { WsMessage } from "@/lib/types";

const PING_INTERVAL = 25_000; // 25s — well under typical proxy 60s timeout

export class WsHub {
  private wss: WebSocketServer | null = null;
  private gameSubscribers = new Map<string, Set<WebSocket>>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  init(server: Server): void {
    this.wss = new WebSocketServer({ noServer: true });

    server.on("upgrade", (request, socket, head) => {
      const url = new URL(request.url || "", `http://${request.headers.host}`);
      if (url.pathname === "/ws") {
        this.wss!.handleUpgrade(request, socket, head, (ws) => {
          this.wss!.emit("connection", ws, request);
        });
      }
      // Don't destroy non-/ws upgrades — let Next.js HMR WebSocket pass through
    });

    this.wss.on("connection", (ws) => {
      (ws as any).isAlive = true;
      console.log(`[ws] client connected (total: ${this.wss!.clients.size})`);

      ws.on("pong", () => {
        (ws as any).isAlive = true;
      });

      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === "subscribe" && msg.gameId) {
            this.subscribe(ws, msg.gameId);
          }
          if (msg.type === "unsubscribe" && msg.gameId) {
            this.unsubscribe(ws, msg.gameId);
          }
        } catch { /* ignore */ }
      });

      ws.on("close", () => {
        for (const [, subscribers] of this.gameSubscribers) {
          subscribers.delete(ws);
        }
        console.log(`[ws] client disconnected (total: ${this.wss!.clients.size})`);
      });
    });

    // Heartbeat: ping all clients every 25s to keep connections alive through proxies
    this.pingTimer = setInterval(() => {
      if (!this.wss) return;
      for (const ws of this.wss.clients) {
        if (!(ws as any).isAlive) {
          console.log("[ws] terminating unresponsive client");
          ws.terminate();
          continue;
        }
        (ws as any).isAlive = false;
        ws.ping();
      }
    }, PING_INTERVAL);
  }

  private subscribe(ws: WebSocket, gameId: string): void {
    if (!this.gameSubscribers.has(gameId)) {
      this.gameSubscribers.set(gameId, new Set());
    }
    this.gameSubscribers.get(gameId)!.add(ws);
  }

  private unsubscribe(ws: WebSocket, gameId: string): void {
    this.gameSubscribers.get(gameId)?.delete(ws);
  }

  broadcast(message: WsMessage): void {
    const data = JSON.stringify(message);
    const delivered = new Set<WebSocket>();

    // Send to game-specific subscribers
    if ("gameId" in message) {
      const subscribers = this.gameSubscribers.get(message.gameId);
      if (subscribers) {
        for (const ws of subscribers) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(data);
            delivered.add(ws);
          }
        }
      }
    }

    // Also broadcast to ALL connected clients (for live game list on home page)
    if (this.wss) {
      for (const ws of this.wss.clients) {
        if (delivered.has(ws)) continue;
        if (ws.readyState === WebSocket.OPEN) ws.send(data);
      }
    }
  }
}

export const wsHub = new WsHub();
