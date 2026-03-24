import type { Engine } from "@/lib/types";

/** Engine data safe for API responses (strips binary_path) */
export type PublicEngine = Omit<Engine, "binary_path">;

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
