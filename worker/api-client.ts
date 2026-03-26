import type {
  WorkerTask,
  ResearchTask,
  MoveReport,
  ThinkingReport,
  ResultReport,
  ResearchHeartbeatRequest,
  ResearchResultReport,
} from "../src/server/distributed/types";

export class ApiClient {
  private baseUrl: string;
  private secret: string;
  private workerId: string;

  constructor(baseUrl: string, secret: string, workerId: string) {
    this.baseUrl = baseUrl;
    this.secret = secret;
    this.workerId = workerId;
  }

  private async request(
    path: string,
    method: "GET" | "POST",
    body?: unknown,
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      "x-worker-secret": this.secret,
    };
    if (body !== undefined) {
      headers["content-type"] = "application/json";
    }
    return fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  async pollTask(): Promise<WorkerTask | null> {
    try {
      const res = await this.request("/api/internal/tasks/poll", "POST", {
        workerId: this.workerId,
      });
      if (res.status === 204) return null;
      if (!res.ok) {
        console.error(`[api] poll failed: ${res.status} ${await res.text()}`);
        return null;
      }
      const data = await res.json();
      return data.task ?? null;
    } catch (err) {
      console.error("[api] poll error:", err);
      return null;
    }
  }

  async pollResearchTask(): Promise<ResearchTask | null> {
    try {
      const res = await this.request("/api/internal/research/poll", "POST", {
        workerId: this.workerId,
      });
      if (res.status === 204) return null;
      if (!res.ok) {
        console.error(`[api] research poll failed: ${res.status} ${await res.text()}`);
        return null;
      }
      const data = await res.json();
      return data.task ?? null;
    } catch (err) {
      console.error("[api] research poll error:", err);
      return null;
    }
  }

  async heartbeat(
    gameId: string,
    leaseId: string,
    ply: number,
  ): Promise<boolean> {
    try {
      const res = await this.request(
        `/api/internal/tasks/${gameId}/heartbeat`,
        "POST",
        { leaseId, workerId: this.workerId, ply },
      );
      if (res.status === 409) return false; // lease expired
      return res.ok;
    } catch {
      return false;
    }
  }

  async reportMove(gameId: string, report: MoveReport): Promise<boolean> {
    try {
      const res = await this.request(
        `/api/internal/tasks/${gameId}/move`,
        "POST",
        report,
      );
      if (res.status === 409) return false;
      return res.ok;
    } catch {
      return false;
    }
  }

  async reportThinking(
    gameId: string,
    report: ThinkingReport,
  ): Promise<boolean> {
    try {
      const res = await this.request(
        `/api/internal/tasks/${gameId}/thinking`,
        "POST",
        report,
      );
      return res.ok;
    } catch {
      return false;
    }
  }

  async reportResult(gameId: string, report: ResultReport): Promise<boolean> {
    try {
      const res = await this.request(
        `/api/internal/tasks/${gameId}/result`,
        "POST",
        report,
      );
      return res.ok;
    } catch (err) {
      console.error(`[api] reportResult error for ${gameId}:`, err);
      return false;
    }
  }

  async heartbeatResearch(
    shardId: string,
    report: ResearchHeartbeatRequest,
  ): Promise<boolean> {
    try {
      const res = await this.request(
        `/api/internal/research/${shardId}/heartbeat`,
        "POST",
        report,
      );
      if (res.status === 409) return false;
      return res.ok;
    } catch {
      return false;
    }
  }

  async uploadResearchArtifact(
    shardId: string,
    leaseId: string,
    filename: string,
    data: Buffer,
  ): Promise<boolean> {
    try {
      const url = `${this.baseUrl}/api/internal/research/${shardId}/upload`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "x-worker-secret": this.secret,
          "x-lease-id": leaseId,
          "x-artifact-filename": filename,
          "content-type": "application/octet-stream",
        },
        body: new Uint8Array(data),
      });
      return res.ok;
    } catch (err) {
      console.error(`[api] uploadResearchArtifact ${shardId} error:`, err);
      return false;
    }
  }

  async reportResearchResult(
    shardId: string,
    report: ResearchResultReport,
  ): Promise<boolean> {
    try {
      const res = await this.request(
        `/api/internal/research/${shardId}/result`,
        "POST",
        report,
      );
      return res.ok;
    } catch (err) {
      console.error(`[api] reportResearchResult ${shardId} error:`, err);
      return false;
    }
  }

  async downloadEngine(
    engineId: string,
    currentHash?: string,
  ): Promise<{
    data: Buffer | null;
    hash: string;
    filename: string;
    isDirectory: boolean;
    notModified: boolean;
  }> {
    const hashParam = currentHash ? `?hash=${encodeURIComponent(currentHash)}` : "";
    try {
      const res = await this.request(
        `/api/internal/engines/${engineId}/download${hashParam}`,
        "GET",
      );
      if (res.status === 304) {
        return {
          data: null,
          hash: currentHash || "",
          filename: "",
          isDirectory: false,
          notModified: true,
        };
      }
      if (!res.ok) {
        throw new Error(`Download failed: ${res.status}`);
      }
      const arrayBuffer = await res.arrayBuffer();
      return {
        data: Buffer.from(arrayBuffer),
        hash: res.headers.get("x-content-hash") || "",
        filename: res.headers.get("x-engine-filename") || "engine",
        isDirectory: res.headers.get("x-engine-is-directory") === "true",
        notModified: false,
      };
    } catch (err) {
      console.error(`[api] downloadEngine ${engineId} error:`, err);
      throw err;
    }
  }
}
