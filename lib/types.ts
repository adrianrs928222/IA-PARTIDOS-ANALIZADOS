export type ConfidenceLevel =
  | "BAJA"
  | "MEDIA"
  | "MEDIA_ALTA"
  | "ALTA"
  | "SIN_DATOS";

export type Market = {
  label: string;
  score: number;
  level: ConfidenceLevel;
  kind: string;
  source: "OPENAI";
  reason?: string;
};

export type TeamInfo = {
  id: number;
  name: string;
  logo?: string;
};

export type MatchAnalysis = {
  fixtureId: number;
  date: string;
  status: string;
  league: string;
  country: string;
  isFriendly: boolean;
  priority: number;
  home: TeamInfo;
  away: TeamInfo;
  winner: Market;
  doubleChance: Market;
  over15: Market;
  over25: Market;
  under35: Market;
  best: Market;
};

export type AccumulatorSelection = {
  fixtureId: number;
  home: string;
  away: string;
  selection: string;
  score: number;
  level: "ALTA";
};

export type Accumulator = {
  selections: AccumulatorSelection[];
  rating: number;
  level: "MUY_ALTA" | "ALTA" | "MEDIA" | "NO_RECOMENDADA";
  explanation: string;
};

export type AnalysisStats = {
  apiFixtures: number;
  validIds: number;
  blocked: number;
  nonPreMatch: number;
  alreadyUsed: number;
  preMatchCandidates: number;
  preliminaryAnalyzed: number;
  preliminaryReturned: number;
  finalists: number;
  finalistsEnriched: number;
  finalAnalyzed: number;
  finalReturned: number;
  highFound: number;
  highSelected: number;
  target: number;
};

export type AnalysisResult = {
  matches: MatchAnalysis[];
  accumulator: Accumulator | null;
  stats: AnalysisStats;
  cached: boolean;
  stale: boolean;
  waitingForNewBatch: boolean;
};
