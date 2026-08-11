import type { Accumulator, AnalysisResult, AnalysisStats, MatchAnalysis, Market } from "./types";
import { enrichFixtureForOpenAI, getFixturesByDate, isBlockedApiFootballFixture, isPreMatchFixture, type APIFootballFixture } from "./apiFootball";
import { analyzeFootballWithOpenAI, openAIConfig, type AIFootballMatch, type AIMarket } from "./openai";

const TARGET_MATCHES = 5;
const HIGH_THRESHOLD = 75;
const ANALYSIS_TTL_MS = 15 * 60 * 1000;
const INITIAL_BATCH = Math.max(5, Math.min(30, Number(process.env.AI_BATCH_SIZE || 20)));
const FINALISTS_TO_ENRICH = Math.max(10, Math.min(30, Number(process.env.FINALISTS_TO_ENRICH || 20)));
const MAX_FIXTURES = Math.max(20, Math.min(500, Number(process.env.MAX_FIXTURES_TO_SCAN || 500)));

type CacheItem = { result: Omit<AnalysisResult, "cached" | "stale">; timestamp: number };
const analysisCache = new Map<string, CacheItem>();
const usedByDate = new Map<string, Set<number>>();

function norm(v: unknown) {
  return String(v || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

function isFriendly(f: APIFootballFixture) {
  const name = norm(f.league.name);
  return name.includes("friendly") || name.includes("friendlies") || name.includes("amistoso");
}

function priority(f: APIFootballFixture) {
  const league = norm(f.league.name);
  if (league.includes("champions league")) return 3000;
  if (league.includes("europa league")) return 2200;
  if (league.includes("conference league")) return 2000;
  if (/(premier league|la liga|serie a|bundesliga|ligue 1|eredivisie|primeira liga|super lig)/.test(league)) return 1400;
  if (!isFriendly(f)) return 700;
  return 200;
}

function score(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;
}

function level(n: number): Market["level"] {
  if (n >= 75) return "ALTA";
  if (n >= 65) return "MEDIA_ALTA";
  if (n >= 55) return "MEDIA";
  return "BAJA";
}

function market(m: AIMarket | undefined, fallback: string, kind: string): Market {
  if (!m) return { label: fallback, score: 0, level: "SIN_DATOS", kind, source: "OPENAI" };
  const s = score(m.score);
  return { label: m.selection || fallback, score: s, level: m.level === "SIN_DATOS" ? "SIN_DATOS" : level(s), kind, source: "OPENAI", reason: m.reason };
}

function bestWinner(ai: AIFootballMatch) {
  return score(ai.homeWin?.score) >= score(ai.awayWin?.score) ? ai.homeWin : ai.awayWin;
}

function bestDc(ai: AIFootballMatch) {
  return score(ai.oneX?.score) >= score(ai.xTwo?.score) ? ai.oneX : ai.xTwo;
}

function findFixture(id: number, fixtures: APIFootballFixture[]) {
  return fixtures.find((f) => f.fixture.id === id);
}

function convert(ai: AIFootballMatch, fixtures: APIFootballFixture[]): MatchAnalysis | null {
  const f = findFixture(Number(ai.fixtureId), fixtures);
  if (!f || !ai.best?.selection) return null;
  const bestScore = score(ai.best.score);
  if (bestScore < HIGH_THRESHOLD) return null;
  return {
    fixtureId: f.fixture.id,
    date: f.fixture.date,
    status: f.fixture.status?.short || "NS",
    league: f.league.name,
    country: f.league.country || "",
    isFriendly: isFriendly(f),
    priority: priority(f),
    home: { id: f.teams.home.id, name: f.teams.home.name, logo: f.teams.home.logo },
    away: { id: f.teams.away.id, name: f.teams.away.name, logo: f.teams.away.logo },
    winner: market(bestWinner(ai), "Ganador", "winner"),
    doubleChance: market(bestDc(ai), "Doble oportunidad", "doubleChance"),
    over15: market(ai.over15, "+1.5 goles", "over15"),
    over25: market(ai.over25, "+2.5 goles", "over25"),
    under35: market(ai.under35, "-3.5 goles", "under35"),
    best: { label: ai.best.selection, score: bestScore, level: "ALTA", kind: "best", source: "OPENAI", reason: ai.best.reason }
  };
}

function chunks<T>(items: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function preliminaryScore(ai: AIFootballMatch, fixture: APIFootballFixture) {
  const candidates = [
    ai.best?.score, ai.homeWin?.score, ai.awayWin?.score, ai.oneX?.score, ai.xTwo?.score,
    ai.over15?.score, ai.over25?.score, ai.under35?.score,
    ...(Array.isArray(ai.combinations) ? ai.combinations.map((c) => c.score) : [])
  ].map(score).sort((a, b) => b - a);
  return (candidates[0] || 0) * 100 + (candidates[1] || 0) * 5 + priority(fixture);
}

function rating(matches: MatchAnalysis[]) {
  if (!matches.length) return 0;
  const avg = matches.reduce((sum, m) => sum + m.best.score, 0) / matches.length;
  const penalty = matches.length >= 5 ? 0.45 : matches.length >= 3 ? 0.2 : 0.1;
  return Math.max(0, Math.min(10, Math.round((avg / 10 - penalty) * 10) / 10));
}

function accumulator(matches: MatchAnalysis[]): Accumulator | null {
  if (!matches.length) return null;
  const r = rating(matches);
  return {
    selections: matches.map((m) => ({ fixtureId: m.fixtureId, home: m.home.name, away: m.away.name, selection: m.best.label, score: m.best.score, level: "ALTA" as const })),
    rating: r,
    level: r >= 9 ? "MUY_ALTA" : r >= 8 ? "ALTA" : r >= 7 ? "MEDIA" : "NO_RECOMENDADA",
    explanation: `Nota final sobre ${matches.length} selecciones ALTA. Cada pick es LO MEJOR QUE VEO y puede ser mercado simple o combinación de máximo dos condiciones.`
  };
}

async function build(date: string): Promise<Omit<AnalysisResult, "cached" | "stale">> {
  const fixtures = await getFixturesByDate(date);
  const used = usedByDate.get(date) || new Set<number>();
  usedByDate.set(date, used);

  const validIds = fixtures.filter((f) => Number(f.fixture.id) > 0);
  const allowed = validIds.filter((f) => !isBlockedApiFootballFixture(f));
  const pre = allowed.filter(isPreMatchFixture);
  const unused = pre.filter((f) => !used.has(f.fixture.id));
  const candidates = unused.slice().sort((a, b) => priority(b) - priority(a) || new Date(a.fixture.date).getTime() - new Date(b.fixture.date).getTime()).slice(0, MAX_FIXTURES);

  let preliminaryAnalyzed = 0;
  let preliminaryReturned = 0;
  const prelim: Array<{ fixture: APIFootballFixture; ai: AIFootballMatch; rank: number }> = [];

  for (const batch of chunks(candidates, INITIAL_BATCH)) {
    const basic = await Promise.all(batch.map((f) => enrichFixtureForOpenAI(f, false)));
    preliminaryAnalyzed += basic.length;
    try {
      const res = await analyzeFootballWithOpenAI(basic);
      preliminaryReturned += res.matches.length;
      for (const ai of res.matches) {
        const f = findFixture(ai.fixtureId, batch);
        if (f) prelim.push({ fixture: f, ai, rank: preliminaryScore(ai, f) });
      }
    } catch (error) {
      console.error("Preliminary batch failed", error);
    }
  }

  const finalists = prelim.sort((a, b) => b.rank - a.rank).slice(0, FINALISTS_TO_ENRICH);
  const finalistFixtures = finalists.map((x) => x.fixture);
  const enriched = await Promise.all(finalistFixtures.map((f) => enrichFixtureForOpenAI(f, true)));

  let finalAnalyzed = 0;
  let finalReturned = 0;
  const high: MatchAnalysis[] = [];
  const seen = new Set<number>();

  for (const batch of chunks(enriched, 10)) {
    finalAnalyzed += batch.length;
    try {
      const res = await analyzeFootballWithOpenAI(batch);
      finalReturned += res.matches.length;
      for (const ai of res.matches) {
        const converted = convert(ai, finalistFixtures);
        if (converted && !seen.has(converted.fixtureId)) {
          seen.add(converted.fixtureId);
          high.push(converted);
        }
      }
    } catch (error) {
      console.error("Final batch failed", error);
    }
  }

  const matches = high.sort((a, b) => {
    const d = b.best.score - a.best.score;
    if (Math.abs(d) >= 4) return d;
    return b.priority - a.priority || d;
  }).slice(0, TARGET_MATCHES);

  const stats: AnalysisStats = {
    apiFixtures: fixtures.length,
    validIds: validIds.length,
    blocked: validIds.length - allowed.length,
    nonPreMatch: allowed.length - pre.length,
    alreadyUsed: pre.length - unused.length,
    preMatchCandidates: candidates.length,
    preliminaryAnalyzed,
    preliminaryReturned,
    finalists: finalists.length,
    finalistsEnriched: enriched.length,
    finalAnalyzed,
    finalReturned,
    highFound: high.length,
    highSelected: matches.length,
    target: TARGET_MATCHES
  };

  return { matches, accumulator: accumulator(matches), stats, waitingForNewBatch: matches.length < TARGET_MATCHES };
}

export function skipCurrentBatch(date: string) {
  const cached = analysisCache.get(date);
  const used = usedByDate.get(date) || new Set<number>();
  if (cached) cached.result.matches.forEach((m) => used.add(m.fixtureId));
  usedByDate.set(date, used);
  analysisCache.delete(date);
}

export async function getAnalysis(date: string, force = false): Promise<AnalysisResult> {
  const existing = analysisCache.get(date);
  if (!force && existing && Date.now() - existing.timestamp < ANALYSIS_TTL_MS) {
    return { ...existing.result, cached: true, stale: false };
  }
  try {
    const result = await build(date);
    analysisCache.set(date, { result, timestamp: Date.now() });
    return { ...result, cached: false, stale: false };
  } catch (error) {
    if (existing) return { ...existing.result, cached: true, stale: true };
    throw error;
  }
}

export const analyzerConfig = {
  model: openAIConfig.model,
  reasoningEffort: openAIConfig.reasoningEffort,
  highThreshold: HIGH_THRESHOLD,
  targetMatches: TARGET_MATCHES,
  maxFixturesToScan: MAX_FIXTURES,
  finalistsToEnrich: FINALISTS_TO_ENRICH,
  twoPhaseAnalysis: true,
  combinationsEnabled: true,
  championsHighestPriority: true
};
