import { NextRequest, NextResponse } from "next/server";
import { analyzerConfig, getAnalysis, skipCurrentBatch } from "@/lib/analyzer";

function validDate(value: string | null): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function GET(request: NextRequest) {
  try {
    const date = request.nextUrl.searchParams.get("date");
    if (!validDate(date)) {
      return NextResponse.json({ ok: false, error: "Fecha inválida", matches: [], accumulator: null }, { status: 400 });
    }

    const force = request.nextUrl.searchParams.get("force") === "1";
    const newBatch = request.nextUrl.searchParams.get("new") === "1";
    if (newBatch) skipCurrentBatch(date);

    const analysis = await getAnalysis(date, force || newBatch);
    return NextResponse.json({
      ok: true,
      date,
      matches: analysis.matches,
      accumulator: analysis.accumulator,
      stats: analysis.stats,
      cached: analysis.cached,
      stale: analysis.stale,
      waitingForNewBatch: analysis.waitingForNewBatch,
      config: analyzerConfig
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Error obteniendo análisis";
    console.error("GET /api/matches", error);
    return NextResponse.json({ ok: false, error: message, matches: [], accumulator: null }, { status: 500 });
  }
}
