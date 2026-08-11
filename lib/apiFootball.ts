const API_URL = "https://v3.football.api-sports.io";
const REQUEST_TIMEOUT_MS = 15000;
const FIXTURE_TTL_MS = 10 * 60 * 1000;
const HISTORY_TTL_MS = 6 * 60 * 60 * 1000;
const RECENT_LIMIT = 8;

export type APIFootballFixture = {
  fixture: {
    id: number;
    date: string;
    timezone?: string;
    status?: { short?: string; long?: string; elapsed?: number | null };
  };
  league: {
    id: number;
    name: string;
    country?: string;
    season?: number;
    round?: string;
  };
  teams: {
    home: { id: number; name: string; logo?: string };
    away: { id: number; name: string; logo?: string };
  };
  goals?: { home?: number | null; away?: number | null };
  [key: string]: unknown;
};

export type RecentSummary = {
  matches: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  averageGoalsFor: number;
  averageGoalsAgainst: number;
  averageTotalGoals: number;
  over15Rate: number;
  over25Rate: number;
  under35Rate: number;
  cleanSheets: number;
  cleanSheetRate: number;
};

export type EnrichedMatch = {
  fixtureId: number;
  date: string;
  status: string;
  league: { id: number; name: string; country: string; season?: number; round?: string };
  home: { id: number; name: string; logo?: string };
  away: { id: number; name: string; logo?: string };
  recentHome: RecentSummary;
  recentAway: RecentSummary;
  dataAvailability: { recentHome: boolean; recentAway: boolean };
  enrichmentLevel: "BASIC" | "RICH";
};

type CacheEntry = { data: unknown; timestamp: number };
const requestCache = new Map<string, CacheEntry>();
const promiseCache = new Map<string, Promise<unknown>>();

function apiKey() {
  const key = process.env.API_FOOTBALL_KEY?.trim();
  if (!key) throw new Error("Falta API_FOOTBALL_KEY en Render");
  return key;
}

async function request(endpoint: string, params: Record<string, string | number | undefined>, ttl: number) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  const url = `${API_URL}${endpoint}?${query.toString()}`;
  const existing = requestCache.get(url);
  if (existing && Date.now() - existing.timestamp < ttl) return existing.data;
  const running = promiseCache.get(url);
  if (running) return running;

  const promise = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        cache: "no-store",
        signal: controller.signal,
        headers: { Accept: "application/json", "x-apisports-key": apiKey() }
      });
      const body = await response.json().catch(() => null) as any;
      if (response.status === 429) throw new Error("API_FOOTBALL_RATE_LIMIT");
      if (!response.ok) throw new Error(`API-Football HTTP ${response.status}`);
      if (body?.errors && Object.keys(body.errors).length > 0) {
        throw new Error(`API-Football: ${JSON.stringify(body.errors)}`);
      }
      const data = body?.response ?? null;
      requestCache.set(url, { data, timestamp: Date.now() });
      return data;
    } finally {
      clearTimeout(timer);
      promiseCache.delete(url);
    }
  })();

  promiseCache.set(url, promise);
  return promise;
}

export async function getFixturesByDate(date: string): Promise<APIFootballFixture[]> {
  const data = await request("/fixtures", { date, timezone: "Europe/Madrid" }, FIXTURE_TTL_MS);
  return Array.isArray(data) ? data as APIFootballFixture[] : [];
}

async function getRecentFixtures(teamId: number): Promise<APIFootballFixture[]> {
  if (!teamId) return [];
  const data = await request("/fixtures", { team: teamId, last: RECENT_LIMIT }, HISTORY_TTL_MS);
  return Array.isArray(data) ? data as APIFootballFixture[] : [];
}

function emptySummary(): RecentSummary {
  return {
    matches: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0,
    averageGoalsFor: 0, averageGoalsAgainst: 0, averageTotalGoals: 0,
    over15Rate: 0, over25Rate: 0, under35Rate: 0, cleanSheets: 0, cleanSheetRate: 0
  };
}

function pct(value: number, total: number) {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

function summarize(fixtures: APIFootballFixture[], teamId: number): RecentSummary {
  let wins = 0, draws = 0, losses = 0, gf = 0, ga = 0, totals = 0, o15 = 0, o25 = 0, u35 = 0, cs = 0, count = 0;
  for (const match of fixtures) {
    const hg = match.goals?.home;
    const ag = match.goals?.away;
    if (hg == null || ag == null) continue;
    const isHome = match.teams.home.id === teamId;
    const isAway = match.teams.away.id === teamId;
    if (!isHome && !isAway) continue;
    const teamGoals = isHome ? hg : ag;
    const oppGoals = isHome ? ag : hg;
    const total = hg + ag;
    count++; gf += teamGoals; ga += oppGoals; totals += total;
    if (teamGoals > oppGoals) wins++; else if (teamGoals < oppGoals) losses++; else draws++;
    if (total >= 2) o15++;
    if (total >= 3) o25++;
    if (total <= 3) u35++;
    if (oppGoals === 0) cs++;
  }
  if (!count) return emptySummary();
  return {
    matches: count, wins, draws, losses, goalsFor: gf, goalsAgainst: ga,
    averageGoalsFor: Math.round((gf / count) * 100) / 100,
    averageGoalsAgainst: Math.round((ga / count) * 100) / 100,
    averageTotalGoals: Math.round((totals / count) * 100) / 100,
    over15Rate: pct(o15, count), over25Rate: pct(o25, count), under35Rate: pct(u35, count),
    cleanSheets: cs, cleanSheetRate: pct(cs, count)
  };
}

function basic(match: APIFootballFixture): EnrichedMatch {
  return {
    fixtureId: match.fixture.id,
    date: match.fixture.date,
    status: match.fixture.status?.short || "",
    league: {
      id: match.league.id,
      name: match.league.name,
      country: match.league.country || "",
      season: match.league.season,
      round: match.league.round
    },
    home: { id: match.teams.home.id, name: match.teams.home.name, logo: match.teams.home.logo },
    away: { id: match.teams.away.id, name: match.teams.away.name, logo: match.teams.away.logo },
    recentHome: emptySummary(),
    recentAway: emptySummary(),
    dataAvailability: { recentHome: false, recentAway: false },
    enrichmentLevel: "BASIC"
  };
}

export async function enrichFixtureForOpenAI(match: APIFootballFixture, rich: boolean): Promise<EnrichedMatch> {
  const base = basic(match);
  if (!rich) return base;
  try {
    const [homeRaw, awayRaw] = await Promise.all([
      getRecentFixtures(match.teams.home.id),
      getRecentFixtures(match.teams.away.id)
    ]);
    const recentHome = summarize(homeRaw, match.teams.home.id);
    const recentAway = summarize(awayRaw, match.teams.away.id);
    return {
      ...base,
      recentHome,
      recentAway,
      dataAvailability: { recentHome: recentHome.matches > 0, recentAway: recentAway.matches > 0 },
      enrichmentLevel: recentHome.matches > 0 || recentAway.matches > 0 ? "RICH" : "BASIC"
    };
  } catch {
    return base;
  }
}

const PREMATCH = new Set(["NS", "TBD"]);
export function isPreMatchFixture(fixture: APIFootballFixture) {
  return PREMATCH.has(String(fixture.fixture.status?.short || "").toUpperCase());
}

export function isBlockedApiFootballFixture(fixture: APIFootballFixture) {
  const text = `${fixture.league.name} ${fixture.teams.home.name} ${fixture.teams.away.name}`.toLowerCase();
  const blocked = [
    "women", "woman", "womens", "women's", "female", "ladies", "femenino", "femenina", "feminine", "féminine", "frauen", "dames", "femminile", "feminina", "feminino",
    "u15", "u16", "u17", "u18", "u19", "u20", "u21", "u22", "u23", "u-15", "u-16", "u-17", "u-18", "u-19", "u-20", "u-21", "u-22", "u-23",
    "under 15", "under 16", "under 17", "under 18", "under 19", "under 20", "under 21", "under 22", "under 23",
    "youth", "juvenil", "juvenile", "academy", "academia", "reserve", "reserves", "reserva", "reservas", "second team", "2nd team", "development league", "development squad"
  ];
  if (blocked.some((word) => text.includes(word))) return true;
  return [fixture.teams.home.name, fixture.teams.away.name].some((name) => /\s(?:b|c|ii|iii|iv)$/i.test(name.trim()));
}
