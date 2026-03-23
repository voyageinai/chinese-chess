import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import type { WsMessage } from "@/lib/types";

export class WsHub {
  private wss: WebSocketServer | null = null;
  private gameSubscribers = new Map<string, Set<WebSocket>>();

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
      });
    });
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

    // Send to game-specific subscribers
    if ("gameId" in message) {
      const subscribers = this.gameSubscribers.get(message.gameId);
      if (subscribers) {
        for (const ws of subscribers) {
          if (ws.readyState === WebSocket.OPEN) ws.send(data);
        }
      }
    }

    // Also broadcast to ALL connected clients (for live game list on home page)
    if (this.wss) {
      for (const ws of this.wss.clients) {
        if (ws.readyState === WebSocket.OPEN) ws.send(data);
      }
    }
  }
}

export const wsHub = new WsHub();
