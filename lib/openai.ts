import type { EnrichedMatch } from "./apiFootball";

const OPENAI_URL = "https://api.openai.com/v1/responses";
const OPENAI_MODEL = process.env.OPENAI_MODEL?.trim() || "gpt-5.2";

export type AILevel = "ALTA" | "MEDIA_ALTA" | "MEDIA" | "BAJA" | "SIN_DATOS";
export type AIMarket = { selection: string; score: number; level: AILevel; reason: string };
export type AICombination = AIMarket & { kind: string };
export type AIFootballMatch = {
  fixtureId: number;
  home: string;
  away: string;
  league: string;
  kickoff: string;
  homeWin: AIMarket;
  awayWin: AIMarket;
  oneX: AIMarket;
  xTwo: AIMarket;
  over15: AIMarket;
  over25: AIMarket;
  under35: AIMarket;
  combinations: AICombination[];
  best: AIMarket;
};
export type AIFootballAnalysis = { matches: AIFootballMatch[] };

function apiKey() {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("Falta OPENAI_API_KEY en Render");
  return key;
}

const MARKET_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    selection: { type: "string" },
    score: { type: "integer", minimum: 0, maximum: 100 },
    level: { type: "string", enum: ["ALTA", "MEDIA_ALTA", "MEDIA", "BAJA", "SIN_DATOS"] },
    reason: { type: "string" }
  },
  required: ["selection", "score", "level", "reason"]
};

const COMBINATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    kind: { type: "string" },
    selection: { type: "string" },
    score: { type: "integer", minimum: 0, maximum: 100 },
    level: { type: "string", enum: ["ALTA", "MEDIA_ALTA", "MEDIA", "BAJA", "SIN_DATOS"] },
    reason: { type: "string" }
  },
  required: ["kind", "selection", "score", "level", "reason"]
};

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    matches: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          fixtureId: { type: "integer" },
          home: { type: "string" },
          away: { type: "string" },
          league: { type: "string" },
          kickoff: { type: "string" },
          homeWin: MARKET_SCHEMA,
          awayWin: MARKET_SCHEMA,
          oneX: MARKET_SCHEMA,
          xTwo: MARKET_SCHEMA,
          over15: MARKET_SCHEMA,
          over25: MARKET_SCHEMA,
          under35: MARKET_SCHEMA,
          combinations: { type: "array", items: COMBINATION_SCHEMA },
          best: MARKET_SCHEMA
        },
        required: ["fixtureId", "home", "away", "league", "kickoff", "homeWin", "awayWin", "oneX", "xTwo", "over15", "over25", "under35", "combinations", "best"]
      }
    }
  },
  required: ["matches"]
};

const INSTRUCTIONS = `
Eres un motor riguroso de análisis de fútbol prepartido.
Usa únicamente los datos recibidos. No inventes estadísticas, lesiones, cuotas ni tendencias.
La puntuación 0-100 es una valoración interna de confianza, no una probabilidad matemática.
Escala obligatoria: ALTA 75-100, MEDIA_ALTA 65-74, MEDIA 55-64, BAJA 0-54, SIN_DATOS cuando no sea razonable valorar.

Para cada partido analiza:
- gana local
- gana visitante
- 1X
- X2
- más de 1.5
- más de 2.5
- menos de 3.5

Analiza además estas combinaciones, cada una con puntuación propia:
- 1X + más de 1.5
- X2 + más de 1.5
- 1X + más de 2.5
- X2 + más de 2.5
- 1X + menos de 3.5
- X2 + menos de 3.5
- local gana + más de 1.5
- visitante gana + más de 1.5
- local gana + más de 2.5
- visitante gana + más de 2.5

Máximo dos condiciones por combinación.
Una combinación añade riesgo: no copies automáticamente la puntuación de sus componentes.

BEST = LO MEJOR QUE VEO.
Compara mercados simples y combinaciones y elige la opción más interesante que conserve mayor confianza real.
No conviertas MEDIA_ALTA en ALTA para completar cinco partidos.
Devuelve TODOS los fixtures recibidos, uno por uno, en JSON estricto.
`;

function outputText(response: any) {
  if (typeof response?.output_text === "string" && response.output_text.trim()) return response.output_text.trim();
  for (const item of Array.isArray(response?.output) ? response.output : []) {
    for (const part of Array.isArray(item?.content) ? item.content : []) {
      if (part?.type === "output_text" && typeof part?.text === "string") return part.text.trim();
    }
  }
  return "";
}

export async function analyzeFootballWithOpenAI(data: EnrichedMatch[]): Promise<AIFootballAnalysis> {
  if (!data.length) return { matches: [] };
  const response = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      store: false,
      reasoning: { effort: "high" },
      instructions: INSTRUCTIONS,
      input: `Analiza todos los partidos de este JSON:\n${JSON.stringify(data)}`,
      text: {
        format: {
          type: "json_schema",
          name: "football_analysis",
          strict: true,
          schema: RESPONSE_SCHEMA
        }
      }
    })
  });

  const raw = await response.json().catch(() => null) as any;
  if (!response.ok) throw new Error(raw?.error?.message || `OpenAI HTTP ${response.status}`);
  const text = outputText(raw);
  if (!text) throw new Error("OpenAI no devolvió contenido");
  const parsed = JSON.parse(text) as AIFootballAnalysis;
  return { matches: Array.isArray(parsed.matches) ? parsed.matches : [] };
}

export const openAIConfig = {
  model: OPENAI_MODEL,
  reasoningEffort: "high",
  highThreshold: 75
};
