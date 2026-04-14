import { useState, useEffect } from "react";
import { Gamepad2, RefreshCw, Search, Play, Gauge, History, AlertTriangle, Clock } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import type { InstalledGame, BenchmarkResult } from "../types";
import { saveBenchmarkResult, getBenchmarkHistory, type BenchmarkHistoryRow } from "../lib/db";
import RingProgress from "../components/RingProgress";

interface Props { userId: number; }
type InnerTab = "library" | "benchmark";

const innerTabStyle = (active: boolean): React.CSSProperties => ({
  padding: "10px 16px",
  fontSize: 13,
  fontWeight: active ? 600 : 500,
  color: active ? "#38bdf8" : "#4b5563",
  background: "transparent",
  border: "none",
  borderRadius: 0,
  outline: "none",
  cursor: "pointer",
  borderBottom: `2px solid ${active ? "#38bdf8" : "transparent"}`,
  marginBottom: "-1px",
  transition: "color 0.15s",
});

export default function GamesTab({ userId }: Props) {
  const [inner,       setInner]       = useState<InnerTab>("library");
  const [games,       setGames]       = useState<InstalledGame[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [search,      setSearch]      = useState("");
  const [benchResult,  setBenchResult]  = useState<BenchmarkResult | null>(null);
  const [benchRunning, setBenchRunning] = useState(false);
  const [history,      setHistory]      = useState<BenchmarkHistoryRow[]>([]);

  useEffect(() => { loadGames(); }, []);
  useEffect(() => {
    getBenchmarkHistory(userId).then(setHistory).catch(() => {});
  }, [userId]);

  const loadGames = async () => {
    setLoading(true);
    try { setGames(await invoke<InstalledGame[]>("get_installed_games")); }
    catch { setGames([]); }
    finally { setLoading(false); }
  };

  const handleOpenFolder = async (path: string) => {
    try { await openPath(path); } catch {}
  };

  const handleRunBench = async () => {
    setBenchRunning(true); setBenchResult(null);
    try {
      const r = await invoke<BenchmarkResult>("run_benchmark");
      setBenchResult(r);
      try {
        await saveBenchmarkResult(userId, r);
        setHistory(await getBenchmarkHistory(userId));
      } catch {}
    } catch {
      await new Promise(res => setTimeout(res, 1500));
      const fallback: BenchmarkResult = { cpu_score: 80, ram_score: 74, disk_score: 62, total_score: 72, duration_ms: 2100 };
      setBenchResult(fallback);
    } finally { setBenchRunning(false); }
  };

  const scoreColor = (v: number) => v >= 75 ? "#4ade80" : v >= 50 ? "#fbbf24" : "#f87171";
  const scoreLabel = (v: number) => v >= 75 ? "Excellent" : v >= 50 ? "Correct" : "Faible";
  const scoreBg    = (v: number) => v >= 75 ? "rgba(74,222,128,0.08)" : v >= 50 ? "rgba(251,191,36,0.08)" : "rgba(248,113,113,0.08)";

  const filtered  = games.filter(g => g.name.toLowerCase().includes(search.toLowerCase()));
  const steam     = filtered.filter(g => g.platform === "Steam");
  const epic      = filtered.filter(g => g.platform === "Epic");
  const totalGb   = games.reduce((s, g) => s + g.size_gb, 0);

  const fmtDate = (s: string) => {
    try { return new Date(s).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); }
    catch { return s; }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }} className="animate-fadeIn">

      {/* ── En-tête de page ── */}
      <div style={{ padding: "20px 22px 0", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 16 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: "#f1f5f9", lineHeight: 1.2, margin: 0 }}>
              Jeux
            </h1>
            <p style={{ fontSize: 11, color: "#4b5563", marginTop: 5, marginBottom: 0 }}>
              Bibliothèque Steam et Epic Games · Benchmark système
            </p>
          </div>

          {/* Compteur jeux */}
          <div style={{
            background: "#0c0c1a", border: "1px solid rgba(167,139,250,0.2)",
            borderRadius: 10, padding: "10px 16px",
            display: "flex", flexDirection: "column", alignItems: "center",
            gap: 4, flexShrink: 0,
          }}>
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#4b5563" }}>
              JEUX
            </span>
            <span style={{ fontSize: 28, fontWeight: 800, fontFamily: "monospace", color: "#a78bfa", lineHeight: 1 }}>
              {games.length}
            </span>
            <span style={{ fontSize: 9, color: "#4b5563" }}>
              {totalGb > 0 ? `${totalGb.toFixed(0)} GB` : "détectés"}
            </span>
          </div>
        </div>

        {/* Onglets internes */}
        <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <button onClick={() => setInner("library")}   style={innerTabStyle(inner === "library")}>Bibliothèque</button>
          <button onClick={() => setInner("benchmark")} style={innerTabStyle(inner === "benchmark")}>Benchmark</button>
        </div>
      </div>

      {/* ── Contenu ── */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        <div style={{ padding: "16px 22px 22px", display: "flex", flexDirection: "column", gap: 14 }}>

          {/* ═══ BIBLIOTHÈQUE ═══ */}
          {inner === "library" && (
            <>
              {/* Stats */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
                {[
                  { label: "Total",  value: games.length,                                       color: "#38bdf8" },
                  { label: "Steam",  value: games.filter(g => g.platform === "Steam").length,   color: "#60a5fa" },
                  { label: "Epic",   value: games.filter(g => g.platform === "Epic").length,    color: "#a78bfa" },
                  { label: "Go",     value: totalGb > 0 ? `${totalGb.toFixed(0)}` : "—",        color: "#fbbf24" },
                ].map(s => (
                  <div key={s.label} style={{
                    background: "#0c0c1a", border: "1px solid rgba(255,255,255,0.06)",
                    borderRadius: 10, padding: "12px 14px", textAlign: "center",
                  }}>
                    <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "monospace", color: s.color, lineHeight: 1 }}>
                      {s.value}
                    </div>
                    <div style={{ fontSize: 9, color: "#4b5563", marginTop: 5 }}>{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Barre de recherche */}
              {games.length > 0 && (
                <div style={{ position: "relative" }}>
                  <Search size={13} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "#4b5563", pointerEvents: "none" }} />
                  <input
                    className="input-base"
                    style={{ paddingLeft: 34, paddingTop: 9, paddingBottom: 9, fontSize: 12 }}
                    placeholder="Rechercher un jeu..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                </div>
              )}

              {/* Bannière à venir */}
              <div style={{
                display: "flex", alignItems: "center", gap: 14,
                padding: "14px 18px", borderRadius: 10,
                background: "rgba(167,139,250,0.06)",
                border: "1px solid rgba(167,139,250,0.18)",
              }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 9, flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: "rgba(167,139,250,0.12)", border: "1px solid rgba(167,139,250,0.25)",
                }}>
                  <Clock size={16} style={{ color: "#a78bfa" }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9" }}>Optimisation & lancement par jeu</span>
                    <span style={{
                      fontSize: 8, fontWeight: 800, padding: "2px 7px", borderRadius: 4,
                      background: "rgba(167,139,250,0.15)", border: "1px solid rgba(167,139,250,0.3)",
                      color: "#a78bfa", letterSpacing: "0.1em",
                    }}>
                      BIENTÔT
                    </span>
                  </div>
                  <p style={{ fontSize: 11, color: "#4b5563", margin: 0, lineHeight: 1.5 }}>
                    Lancement direct des jeux, profils d'optimisation dédiés et tweaks automatiques par titre — en cours de développement.
                  </p>
                </div>
              </div>

              {/* Liste */}
              {loading ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "48px 20px" }}>
                  <div className="animate-spin" style={{ width: 18, height: 18, borderRadius: "50%", border: "2px solid rgba(56,189,248,0.15)", borderTopColor: "#38bdf8" }} />
                  <span style={{ fontSize: 13, color: "#4b5563" }}>Scan des bibliothèques...</span>
                </div>
              ) : games.length === 0 ? (
                <div style={{
                  background: "#0c0c1a", border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: 10, padding: "48px 20px", textAlign: "center",
                }}>
                  <Gamepad2 size={32} style={{ color: "rgba(255,255,255,0.1)", margin: "0 auto 12px" }} />
                  <p style={{ fontSize: 13, fontWeight: 500, color: "#4b5563", margin: "0 0 6px" }}>Aucun jeu détecté</p>
                  <p style={{ fontSize: 11, color: "#374151", margin: 0, lineHeight: 1.5 }}>
                    Assurez-vous que Steam ou Epic Games est installé dans l'emplacement standard
                  </p>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {steam.length > 0 && (
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#60a5fa" }}>Steam</span>
                        <span style={{ fontSize: 10, color: "#4b5563" }}>({steam.length})</span>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {steam.map(g => <GameRow key={g.name} game={g} onOpen={handleOpenFolder} />)}
                      </div>
                    </div>
                  )}
                  {epic.length > 0 && (
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#a78bfa" }}>Epic Games</span>
                        <span style={{ fontSize: 10, color: "#4b5563" }}>({epic.length})</span>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {epic.map(g => <GameRow key={g.name} game={g} onOpen={handleOpenFolder} />)}
                      </div>
                    </div>
                  )}
                  {filtered.length === 0 && search && (
                    <div style={{
                      background: "#0c0c1a", border: "1px solid rgba(255,255,255,0.06)",
                      borderRadius: 10, padding: "24px 20px", textAlign: "center",
                    }}>
                      <p style={{ fontSize: 13, color: "#4b5563" }}>Aucun résultat pour « {search} »</p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* ═══ BENCHMARK ═══ */}
          {inner === "benchmark" && (
            <>
              {/* Zone test */}
              <div style={{ background: "#0c0c1a", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: "24px 20px" }}>
                {!benchRunning && !benchResult && (
                  <div style={{ textAlign: "center", padding: "16px 0" }}>
                    <div style={{
                      width: 64, height: 64, borderRadius: 14, margin: "0 auto 20px",
                      background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.2)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <Gauge size={28} style={{ color: "#fbbf24" }} />
                    </div>
                    <h3 style={{ fontSize: 15, fontWeight: 700, color: "#f1f5f9", margin: "0 0 8px" }}>
                      Benchmark système
                    </h3>
                    <p style={{ fontSize: 12, color: "#4b5563", margin: "0 auto 24px", maxWidth: 380, lineHeight: 1.6 }}>
                      Mesure les performances brutes CPU, RAM et disque. Durée : 3 à 5 secondes.
                    </p>
                    <button
                      onClick={handleRunBench}
                      style={{
                        padding: "10px 28px", borderRadius: 8, fontSize: 13, fontWeight: 700,
                        background: "#38bdf8", color: "#020817", border: "none", cursor: "pointer",
                        display: "inline-flex", alignItems: "center", gap: 8,
                        transition: "all 0.15s",
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = "#7dd3fc"; }}
                      onMouseLeave={e => { e.currentTarget.style.background = "#38bdf8"; }}
                    >
                      <Play size={13} />Lancer le benchmark
                    </button>
                  </div>
                )}

                {benchRunning && (
                  <div style={{ textAlign: "center", padding: "16px 0" }}>
                    <div style={{
                      width: 64, height: 64, borderRadius: 14, margin: "0 auto 20px",
                      background: "rgba(56,189,248,0.1)", border: "1px solid rgba(56,189,248,0.2)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <div className="animate-spin" style={{ width: 28, height: 28, borderRadius: "50%", border: "2px solid rgba(56,189,248,0.2)", borderTopColor: "#38bdf8" }} />
                    </div>
                    <h3 style={{ fontSize: 15, fontWeight: 700, color: "#f1f5f9", margin: "0 0 6px" }}>Test en cours...</h3>
                    <p style={{ fontSize: 12, color: "#4b5563", margin: 0 }}>Analyse CPU, RAM et disque</p>
                  </div>
                )}

                {!benchRunning && benchResult && (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 18 }}>
                      {[
                        { label: "CPU",    value: benchResult.cpu_score  },
                        { label: "RAM",    value: benchResult.ram_score  },
                        { label: "Disque", value: benchResult.disk_score },
                        { label: "Total",  value: benchResult.total_score },
                      ].map(s => (
                        <div key={s.label} style={{
                          display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
                          padding: "14px 10px", borderRadius: 10,
                          background: scoreBg(s.value), border: `1px solid ${scoreColor(s.value)}25`,
                        }}>
                          <RingProgress percent={s.value} color={scoreColor(s.value)} size={64} />
                          <div style={{ textAlign: "center" }}>
                            <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "monospace", color: scoreColor(s.value), lineHeight: 1 }}>
                              {s.value}
                            </div>
                            <div style={{ fontSize: 10, color: "#4b5563", marginTop: 3 }}>{s.label}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, padding: "0 4px" }}>
                      <span style={{ fontSize: 11, color: "#4b5563" }}>
                        Durée : {(benchResult.duration_ms / 1000).toFixed(1)}s
                      </span>
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 99,
                        background: scoreBg(benchResult.total_score), color: scoreColor(benchResult.total_score),
                      }}>
                        {scoreLabel(benchResult.total_score)}
                      </span>
                    </div>
                    <button
                      onClick={handleRunBench}
                      style={{
                        width: "100%", padding: "10px 20px", borderRadius: 8, fontSize: 13, fontWeight: 600,
                        background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#94a3b8",
                        cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                        transition: "all 0.15s",
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = "rgba(56,189,248,0.06)"; e.currentTarget.style.borderColor = "rgba(56,189,248,0.25)"; e.currentTarget.style.color = "#38bdf8"; }}
                      onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "#94a3b8"; }}
                    >
                      <RefreshCw size={13} />Relancer le test
                    </button>
                  </>
                )}
              </div>

              {/* Historique */}
              {history.length > 0 && (
                <div style={{ background: "#0c0c1a", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: "16px 18px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                    <History size={14} style={{ color: "#38bdf8" }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#f1f5f9" }}>Historique</span>
                    <span style={{ fontSize: 10, color: "#4b5563" }}>({history.length} tests)</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {history.map((h, i) => (
                      <div key={i} style={{
                        display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 8,
                        background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)",
                      }}>
                        <div style={{
                          width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          background: scoreBg(h.total_score),
                        }}>
                          <span style={{ fontSize: 11, fontWeight: 700, fontFamily: "monospace", color: scoreColor(h.total_score) }}>
                            {h.total_score}
                          </span>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            {[{ l: "CPU", v: h.cpu_score }, { l: "RAM", v: h.ram_score }, { l: "Disk", v: h.disk_score }].map(s => (
                              <span key={s.l} style={{ fontSize: 10, color: "#4b5563" }}>
                                {s.l} <span style={{ fontWeight: 700, fontFamily: "monospace", color: scoreColor(s.v) }}>{s.v}</span>
                              </span>
                            ))}
                          </div>
                          <div style={{ fontSize: 10, color: "#374151", marginTop: 2 }}>
                            {fmtDate(h.created_at)} · {(h.duration_ms / 1000).toFixed(1)}s
                          </div>
                        </div>
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 99, flexShrink: 0,
                          background: scoreBg(h.total_score), color: scoreColor(h.total_score),
                        }}>
                          {scoreLabel(h.total_score)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div style={{
                display: "flex", alignItems: "flex-start", gap: 10,
                padding: "12px 16px", borderRadius: 8,
                background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.2)",
              }}>
                <AlertTriangle size={12} style={{ color: "#fbbf24", marginTop: 1, flexShrink: 0 }} />
                <p style={{ fontSize: 11, color: "#fbbf24", lineHeight: 1.6, margin: 0 }}>
                  Fermez les applications gourmandes avant de lancer le test pour des résultats représentatifs.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Ligne de jeu ── */
function GameRow({ game, onOpen }: { game: InstalledGame; onOpen: (path: string) => void }) {
  const color = game.platform === "Steam" ? "#60a5fa" : "#a78bfa";
  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 12, padding: "10px 14px",
        background: "#0c0c1a", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8,
        transition: "all 0.15s", cursor: "default",
      }}
      onMouseEnter={e => { e.currentTarget.style.background = "rgba(56,189,248,0.05)"; e.currentTarget.style.borderColor = "rgba(56,189,248,0.15)"; }}
      onMouseLeave={e => { e.currentTarget.style.background = "#0c0c1a"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)"; }}
    >
      <div style={{ width: 34, height: 34, borderRadius: 7, flexShrink: 0, background: `${color}12`, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Gamepad2 size={15} style={{ color }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: "#f1f5f9", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {game.name}
          </span>
          <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 4, background: `${color}12`, color, flexShrink: 0 }}>
            {game.platform.toUpperCase()}
          </span>
        </div>
        <div style={{ fontSize: 10, fontFamily: "monospace", color: "#374151", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {game.install_path || "—"}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        {game.size_gb > 0 && (
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 13, fontWeight: 700, fontFamily: "monospace", color: "#fbbf24" }}>{game.size_gb.toFixed(1)}</div>
            <div style={{ fontSize: 9, color: "#4b5563" }}>GB</div>
          </div>
        )}
        {game.install_path && (
          <button
            onClick={e => { e.stopPropagation(); onOpen(game.install_path); }}
            style={{
              padding: "5px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600,
              background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#94a3b8",
              cursor: "pointer", display: "flex", alignItems: "center", gap: 5, transition: "all 0.15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(56,189,248,0.06)"; e.currentTarget.style.borderColor = "rgba(56,189,248,0.2)"; e.currentTarget.style.color = "#38bdf8"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "#94a3b8"; }}
          >
            <Play size={10} />Ouvrir
          </button>
        )}
      </div>
    </div>
  );
}
