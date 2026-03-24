import { NextRequest, NextResponse } from "next/server";
import { getEloHistory, getEngineById } from "@/db/queries";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const engine = getEngineById(id);
  if (!engine) {
    return NextResponse.json({ error: "Engine not found" }, { status: 404 });
  }

  const history = getEloHistory(id, 100);
  return NextResponse.json({ engine: { id: engine.id, name: engine.name }, history });
}
