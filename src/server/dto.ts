import path from "path";
import type { Engine } from "@/lib/types";

/** Engine data safe for API responses (strips binary_path) */
export type PublicEngine = Omit<Engine, "binary_path">;

/** Admin engine data: includes filename but not full path */
export type AdminEngine = PublicEngine & { filename: string };

/** Strip sensitive fields from engine before sending to client */
export function sanitizeEngine(engine: Engine): PublicEngine {
  const { binary_path, ...safe } = engine;
  void binary_path;
  return safe;
}

/** Strip sensitive fields from an array of engines */
export function sanitizeEngines(engines: Engine[]): PublicEngine[] {
  return engines.map(sanitizeEngine);
}

/** For admin: strip full path but keep basename as filename */
export function sanitizeEngineForAdmin(engine: Engine): AdminEngine {
  const { binary_path, ...safe } = engine;
  return { ...safe, filename: path.basename(binary_path) };
}

/** For admin: sanitize an array of engines */
export function sanitizeEnginesForAdmin(engines: Engine[]): AdminEngine[] {
  return engines.map(sanitizeEngineForAdmin);
}
