"use client";

import { useEffect, useMemo, useState } from "react";
import type { Accumulator, AnalysisStats, MatchAnalysis, Market } from "@/lib/types";

type ApiResponse = {
  ok: boolean;
  date?: string;
  matches: MatchAnalysis[];
  accumulator: Accumulator | null;
  stats?: AnalysisStats;
  cached?: boolean;
  stale?: boolean;
  waitingForNewBatch?: boolean;
  error?: string;
  config?: { model?: string; reasoningEffort?: string; highThreshold?: number };
};

function localDate(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function levelLabel(level: Market["level"]) {
  if (level === "ALTA") return "🟢 ALTA";
  if (level === "MEDIA_ALTA") return "🟠 MEDIA ALTA";
  if (level === "MEDIA") return "🟡 MEDIA";
  if (level === "BAJA") return "🔴 BAJA";
  return "— SIN DATOS";
}

function ratingLabel(level: Accumulator["level"]) {
  if (level === "MUY_ALTA") return "🔥🟢 MUY ALTA";
  if (level === "ALTA") return "🟢 ALTA";
  if (level === "MEDIA") return "🟡 MEDIA";
  return "🔴 NO RECOMENDADA";
}

function MarketLine({ icon, market }: { icon: string; market: Market }) {
  return (
    <div className="marketLine">
      <div className="marketName"><span>{icon}</span><span>{market.label}</span></div>
      <div className={`confidence ${market.level.toLowerCase()}`}>
        {levelLabel(market.level)}{market.level !== "SIN_DATOS" ? ` · ${market.score}` : ""}
      </div>
    </div>
  );
}

function MatchCard({ match }: { match: MatchAnalysis }) {
  const time = new Date(match.date).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  return (
    <article className="matchCard">
      <div className="matchTop">
        <div><div className="league">{match.league}</div><div className="country">{match.country}{match.isFriendly ? " · Amistoso" : ""}</div></div>
        <div className="kickoff">{time}</div>
      </div>
      <div className="teams">
        <div className="team">{match.home.logo ? <img src={match.home.logo} alt="" /> : <div className="logoFallback">H</div>}<strong>{match.home.name}</strong></div>
        <span className="vs">VS</span>
        <div className="team away">{match.away.logo ? <img src={match.away.logo} alt="" /> : <div className="logoFallback">A</div>}<strong>{match.away.name}</strong></div>
      </div>
      <div className="markets">
        <MarketLine icon="🏆" market={match.winner} />
        <MarketLine icon="🛡️" market={match.doubleChance} />
        <MarketLine icon="⚽" market={match.over15} />
        <MarketLine icon="🔥" market={match.over25} />
        <MarketLine icon="🔒" market={match.under35} />
      </div>
      <div className="bestBox">
        <div className="bestEyebrow">💎 LO MEJOR QUE VEO</div>
        <div className="bestSelection">{match.best.label}</div>
        <div className="bestMeta">🟢 ALTA · {match.best.score}/100</div>
        {match.best.reason ? <p>{match.best.reason}</p> : null}
      </div>
    </article>
  );
}

export default function Home() {
  const [date, setDate] = useState(localDate());
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const today = useMemo(() => localDate(), []);
  const tomorrow = useMemo(() => localDate(1), []);

  async function load(extra = "") {
    setLoading(true);
    setMessage("");
    try {
      const res = await fetch(`/api/matches?date=${encodeURIComponent(date)}${extra}`, { cache: "no-store" });
      const json = await res.json() as ApiResponse;
      setData(json);
      if (!res.ok) setMessage(json.error || "Error cargando análisis");
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "Error de red");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [date]);

  return (
    <main className="shell">
      <header className="hero">
        <div>
          <div className="brand">IA PARTIDOS ANALIZADOS</div>
          <h1>OpenAI <span>×</span> API-Football</h1>
          <p>Busca 5 selecciones de confianza alta. Champions tiene prioridad, pero se analizan ligas, copas y amistosos senior masculinos.</p>
        </div>
        <div className="modelBadge">{data?.config?.model || "OpenAI"}</div>
      </header>

      <section className="toolbar">
        <div className="quickDates">
          <button className={date === today ? "active" : ""} onClick={() => setDate(today)}>HOY</button>
          <button className={date === tomorrow ? "active" : ""} onClick={() => setDate(tomorrow)}>MAÑANA</button>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="actions">
          <button onClick={() => void load("&force=1")} disabled={loading}>Actualizar</button>
          <button className="secondary" onClick={() => void load("&new=1")} disabled={loading}>Otra tanda</button>
        </div>
      </section>

      {data?.stats ? (
        <section className="stats">
          <div><span>API-Football</span><strong>{data.stats.apiFixtures}</strong></div>
          <div><span>Prepartido</span><strong>{data.stats.preMatchCandidates}</strong></div>
          <div><span>Primera IA</span><strong>{data.stats.preliminaryAnalyzed}</strong></div>
          <div><span>Finalistas</span><strong>{data.stats.finalists}</strong></div>
          <div><span>IA final</span><strong>{data.stats.finalAnalyzed}</strong></div>
          <div><span>ALTA encontrados</span><strong>{data.stats.highFound}</strong></div>
          <div><span>Seleccionados</span><strong>{data.stats.highSelected}/{data.stats.target}</strong></div>
          <div><span>Estado</span><strong>{data.stale ? "Anterior" : data.cached ? "Caché" : "Nuevo"}</strong></div>
        </section>
      ) : null}

      {loading ? <div className="loading"><div className="spinner" />OpenAI está analizando los partidos disponibles…</div> : null}
      {message ? <div className="errorBox">{message}</div> : null}

      {!loading && data?.ok && data.matches.length === 0 ? (
        <div className="empty">No se encontró ningún partido cuyo <b>LO MEJOR QUE VEO</b> llegue a 🟢 ALTA (75+).</div>
      ) : null}

      {!loading && data?.ok && data.matches.length > 0 && data.matches.length < 5 ? (
        <div className="warningBox">⚠️ Se encontraron {data.matches.length} selecciones ALTA reales. No se rellenan con MEDIA.</div>
      ) : null}

      <section className="grid">{data?.matches?.map((match) => <MatchCard key={match.fixtureId} match={match} />)}</section>

      {data?.accumulator ? (
        <section className="accumulator">
          <div className="accHeader"><div><span>💙🏆</span><h2>COMBINADA DE {data.accumulator.selections.length} PARTIDOS</h2></div></div>
          <div className="accRows">
            {data.accumulator.selections.map((s, i) => (
              <div className="accRow" key={s.fixtureId}>
                <span className="number">{i + 1}</span>
                <div><strong>{s.home} – {s.away}</strong><p>💎 {s.selection}</p></div>
                <span className="accHigh">🟢 ALTA · {s.score}</span>
              </div>
            ))}
          </div>
          <div className="finalRatingCard">
            <div className="finalRatingEyebrow">🔥 NOTA FINAL</div>
            <div className="finalRatingNumber">{data.accumulator.rating}<span>/10</span></div>
            <div className="finalRatingLevel">{ratingLabel(data.accumulator.level)}</div>
            <div className="finalRatingText">{data.accumulator.explanation}</div>
          </div>
        </section>
      ) : null}

      <footer>La puntuación es una valoración interna del modelo; no representa una probabilidad matemática ni garantiza resultados.</footer>
    </main>
  );
}
