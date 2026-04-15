import { useState, useEffect } from "react";
import { RefreshCw, Trash2, AlertTriangle, CheckCircle, SquareCheck, Square, MemoryStick, Globe, Recycle, HardDrive } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import type { CleanCategory, CleanResult } from "../types";

type QuickAction = "ram" | "recycle" | "dns" | "cleandisk";
type QuickState  = { loading: boolean; result: string | null };
type RamCleanResult = { before_mb: number; after_mb: number; freed_mb: number };

export default function CleanupTab() {
  const [categories,   setCategories]   = useState<CleanCategory[]>([]);
  const [selected,     setSelected]     = useState<Set<string>>(new Set());
  const [scanning,     setScanning]     = useState(false);
  const [cleaning,     setCleaning]     = useState(false);
  const [cleanResult,  setCleanResult]  = useState<CleanResult | null>(null);
  const [ramResult,    setRamResult]    = useState<RamCleanResult | null>(null);
  const [quick, setQuick] = useState<Record<QuickAction, QuickState>>({
    ram:      { loading: false, result: null },
    recycle:  { loading: false, result: null },
    dns:      { loading: false, result: null },
    cleandisk:{ loading: false, result: null },
  });

  useEffect(() => { scan(); }, []);

  const fmt = (mb: number) =>
    mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;

  const runQuick = async (action: QuickAction) => {
    setQuick(q => ({ ...q, [action]: { loading: true, result: null } }));
    if (action === "ram") setRamResult(null);
    try {
      if (action === "ram") {
        const res = await invoke<RamCleanResult>("clean_ram");
        setRamResult(res);
        const msg = res.freed_mb > 0 ? `−${fmt(res.freed_mb)}` : "Nettoyée";
        setQuick(q => ({ ...q, ram: { loading: false, result: msg } }));
        setTimeout(() => {
          setRamResult(null);
          setQuick(q => ({ ...q, ram: { ...q.ram, result: null } }));
        }, 3000);
        return;
      } else if (action === "recycle") {
        const res = await invoke<CleanResult>("empty_recycle_bin");
        const msg = res.freed_mb > 0 ? `${fmt(res.freed_mb)} libérés` : "Corbeille vidée";
        setQuick(q => ({ ...q, recycle: { loading: false, result: msg } }));
      } else if (action === "cleandisk") {
        await invoke<boolean>("run_cleandisk");
        setQuick(q => ({ ...q, cleandisk: { loading: false, result: "Lancé ✓" } }));
      } else {
        await invoke<string>("flush_dns");
        setQuick(q => ({ ...q, dns: { loading: false, result: "DNS vidé" } }));
      }
    } catch {
      setQuick(q => ({ ...q, [action]: { loading: false, result: "Erreur" } }));
    }
    setTimeout(() => setQuick(q => ({ ...q, [action]: { ...q[action], result: null } })), 4000);
  };

  const scan = async () => {
    setScanning(true); setCleanResult(null);
    try {
      const cats = await invoke<CleanCategory[]>("get_clean_categories");
      setCategories(cats);
      setSelected(new Set(cats.filter(c => c.file_count > 0).map(c => c.id)));
    } catch { setCategories([]); }
    finally { setScanning(false); }
  };

  const handleClean = async () => {
    if (selected.size === 0) return;
    setCleaning(true);
    try {
      const result = await invoke<CleanResult>("clean_categories", {
        categories: Array.from(selected),
      });
      setCleanResult(result);
      await scan();
    } catch {
      setCleanResult({ freed_mb: 0, files_deleted: 0, files_skipped: 0 });
    } finally { setCleaning(false); }
  };

  const totalMb    = categories.filter(c => selected.has(c.id)).reduce((s, c) => s + c.size_mb, 0);
  const totalFiles = categories.filter(c => selected.has(c.id)).reduce((s, c) => s + c.file_count, 0);
  const allMb      = categories.reduce((s, c) => s + c.size_mb, 0);
  const selectAll  = () => setSelected(new Set(categories.filter(c => c.file_count > 0).map(c => c.id)));
  const clearAll   = () => setSelected(new Set());

  return (
    <div style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 14, height: "100%", overflowY: "auto" }} className="animate-fadeIn">

      {/* ── En-tête de page ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexShrink: 0 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "#f1f5f9", lineHeight: 1.2, margin: 0 }}>
            Nettoyage
          </h1>
          <p style={{ fontSize: 11, color: "#4b5563", marginTop: 5, marginBottom: 0 }}>
            Libérez de l'espace disque en supprimant les fichiers temporaires
          </p>
          {cleanResult && (
            <div style={{
              display: "flex", alignItems: "center", gap: 6, marginTop: 10,
              fontSize: 10, fontWeight: 600, color: "#4ade80",
            }}>
              <CheckCircle size={11} />
              {fmt(cleanResult.freed_mb)} libérés · {cleanResult.files_deleted} fichiers supprimés
            </div>
          )}
        </div>

        {/* Carte espace détecté */}
        <div style={{
          background: "#0c0c1a", border: "1px solid rgba(249,115,22,0.2)",
          borderRadius: 10, padding: "12px 18px",
          display: "flex", flexDirection: "column", alignItems: "center",
          gap: 5, flexShrink: 0, minWidth: 120,
        }}>
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#4b5563" }}>
            DÉTECTÉ
          </span>
          <span style={{ fontSize: 22, fontWeight: 800, fontFamily: "monospace", color: "#f97316", lineHeight: 1 }}>
            {allMb > 0 ? fmt(allMb) : "—"}
          </span>
          <span style={{ fontSize: 9, color: "#4b5563" }}>
            {categories.length} catégorie{categories.length > 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* ── Actions rapides ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, flexShrink: 0 }}>
        {([
          { key: "ram"       as QuickAction, icon: <MemoryStick size={14} />, label: "Nettoyer RAM",     color: "#818cf8" },
          { key: "recycle"   as QuickAction, icon: <Recycle     size={14} />, label: "Vider Corbeille",  color: "#4ade80" },
          { key: "dns"       as QuickAction, icon: <Globe       size={14} />, label: "Flush DNS",        color: "#38bdf8" },
          { key: "cleandisk" as QuickAction, icon: <HardDrive   size={14} />, label: "CleanDisk Windows",color: "#fbbf24" },
        ]).map(({ key, icon, label, color }) => {
          const state = quick[key];
          return (
            <button
              key={key}
              onClick={() => runQuick(key)}
              disabled={state.loading}
              style={{
                padding: "12px 10px", borderRadius: 9, fontSize: 12, fontWeight: 600,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                background: state.result ? `${color}14` : "rgba(255,255,255,0.04)",
                border: `1px solid ${state.result ? `${color}40` : "rgba(255,255,255,0.08)"}`,
                color: state.result ? color : "#94a3b8",
                cursor: state.loading ? "not-allowed" : "pointer",
                opacity: state.loading ? 0.7 : 1,
                transition: "all 0.2s",
              }}
              onMouseEnter={e => { if (!state.loading) { e.currentTarget.style.background = `${color}10`; e.currentTarget.style.borderColor = `${color}30`; e.currentTarget.style.color = color; }}}
              onMouseLeave={e => { if (!state.result) { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "#94a3b8"; }}}
            >
              {state.loading
                ? <div className="animate-spin" style={{ width: 12, height: 12, borderRadius: "50%", border: `2px solid ${color}30`, borderTopColor: color }} />
                : icon}
              <span>{state.result ?? label}</span>
            </button>
          );
        })}
      </div>

      {/* ── Résultat nettoyage RAM ── */}
      {ramResult && (
        <div style={{
          background: "#0c0c1a", border: "1px solid rgba(129,140,248,0.2)",
          borderRadius: 10, padding: "14px 18px", flexShrink: 0,
        }} className="animate-fadeIn">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <MemoryStick size={13} style={{ color: "#818cf8" }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: "#818cf8", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                RAM nettoyée
              </span>
            </div>
            {ramResult.freed_mb > 0 ? (
              <span style={{
                fontSize: 12, fontWeight: 800, fontFamily: "monospace", color: "#4ade80",
                background: "rgba(74,222,128,0.08)", border: "1px solid rgba(74,222,128,0.2)",
                padding: "2px 10px", borderRadius: 6,
              }}>
                −{fmt(ramResult.freed_mb)} libérés
              </span>
            ) : (
              <span style={{ fontSize: 11, color: "#4b5563" }}>Aucun changement détecté</span>
            )}
          </div>

          {/* Barre avant/après */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {/* Avant */}
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 10, color: "#4b5563", width: 36, flexShrink: 0 }}>Avant</span>
              <div style={{ flex: 1, height: 8, borderRadius: 4, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                <div style={{
                  height: "100%", borderRadius: 4,
                  width: `${Math.min(100, (ramResult.before_mb / (ramResult.before_mb * 1.1)) * 100)}%`,
                  background: "rgba(239,68,68,0.6)",
                  transition: "width 0.6s ease",
                }} />
              </div>
              <span style={{ fontSize: 11, fontFamily: "monospace", color: "#ef4444", width: 68, textAlign: "right", flexShrink: 0 }}>
                {fmt(ramResult.before_mb)}
              </span>
            </div>
            {/* Après */}
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 10, color: "#4b5563", width: 36, flexShrink: 0 }}>Après</span>
              <div style={{ flex: 1, height: 8, borderRadius: 4, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                <div style={{
                  height: "100%", borderRadius: 4,
                  width: `${Math.min(100, (ramResult.after_mb / (ramResult.before_mb * 1.1)) * 100)}%`,
                  background: "#818cf8",
                  transition: "width 0.6s ease",
                }} />
              </div>
              <span style={{ fontSize: 11, fontFamily: "monospace", color: "#818cf8", width: 68, textAlign: "right", flexShrink: 0 }}>
                {fmt(ramResult.after_mb)}
              </span>
            </div>
          </div>

        </div>
      )}

      {/* ── 3 mini stats ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, flexShrink: 0 }}>
        {[
          { label: "Total détecté",   value: allMb > 0 ? fmt(allMb) : "0 MB",               color: "#f97316" },
          { label: "Sélection",       value: totalMb > 0 ? fmt(totalMb) : "0 MB",            color: "#38bdf8" },
          { label: "Fichiers",        value: totalFiles > 0 ? totalFiles.toLocaleString() : "0", color: "#94a3b8" },
        ].map(s => (
          <div key={s.label} style={{
            background: "#0c0c1a", border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 10, padding: "12px 16px", textAlign: "center",
          }}>
            <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "monospace", color: s.color, lineHeight: 1 }}>
              {s.value}
            </div>
            <div style={{ fontSize: 9, color: "#4b5563", marginTop: 5 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── Bouton principal + scan ── */}
      <div style={{ display: "flex", gap: 10, flexShrink: 0 }}>
        <button
          onClick={handleClean}
          disabled={cleaning || scanning || selected.size === 0 || totalFiles === 0}
          style={{
            flex: 1, padding: "12px 20px", borderRadius: 8, fontSize: 13, fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            cursor: cleaning || scanning || selected.size === 0 || totalFiles === 0 ? "not-allowed" : "pointer",
            opacity: cleaning || scanning || selected.size === 0 || totalFiles === 0 ? 0.4 : 1,
            background: "rgba(249,115,22,0.12)", border: "1px solid rgba(249,115,22,0.3)", color: "#f97316",
            transition: "all 0.15s",
          }}
          onMouseEnter={e => { if (!cleaning && !scanning && selected.size > 0 && totalFiles > 0) e.currentTarget.style.background = "rgba(249,115,22,0.2)"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "rgba(249,115,22,0.12)"; }}
        >
          {cleaning ? (
            <>
              <div className="animate-spin" style={{ width: 14, height: 14, borderRadius: "50%", border: "2px solid rgba(249,115,22,0.2)", borderTopColor: "#f97316" }} />
              Nettoyage...
            </>
          ) : selected.size === 0 ? (
            <><Trash2 size={14} /> Sélectionnez des catégories</>
          ) : (
            <><Trash2 size={14} /> Nettoyer — {fmt(totalMb)}</>
          )}
        </button>

        <button
          onClick={scan}
          disabled={scanning || cleaning}
          style={{
            padding: "12px 16px", borderRadius: 8, fontSize: 12, fontWeight: 600,
            display: "flex", alignItems: "center", gap: 6,
            background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#94a3b8",
            cursor: scanning || cleaning ? "not-allowed" : "pointer",
            opacity: scanning || cleaning ? 0.4 : 1, transition: "all 0.15s", flexShrink: 0,
          }}
          onMouseEnter={e => { if (!scanning && !cleaning) { e.currentTarget.style.background = "rgba(56,189,248,0.06)"; e.currentTarget.style.borderColor = "rgba(56,189,248,0.25)"; e.currentTarget.style.color = "#38bdf8"; }}}
          onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "#94a3b8"; }}
        >
          <RefreshCw size={13} className={scanning ? "animate-spin" : ""} />
          Re-scanner
        </button>
      </div>

      {/* ── Résultat nettoyage ── */}
      {cleanResult && (
        <div style={{
          display: "flex", alignItems: "flex-start", gap: 10,
          padding: "12px 16px", borderRadius: 8,
          background: "rgba(74,222,128,0.08)", border: "1px solid rgba(74,222,128,0.2)",
        }} className="animate-fadeIn">
          <CheckCircle size={14} style={{ color: "#4ade80", marginTop: 1, flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#4ade80" }}>Nettoyage terminé</div>
            <div style={{ fontSize: 11, color: "#4ade80", marginTop: 2 }}>
              {fmt(cleanResult.freed_mb)} libérés · {cleanResult.files_deleted} fichiers supprimés
              {cleanResult.files_skipped > 0 && ` · ${cleanResult.files_skipped} ignorés`}
            </div>
          </div>
        </div>
      )}

      {/* ── Liste des catégories ── */}
      <div style={{
        background: "#0c0c1a", border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 10, overflow: "hidden",
      }}>
        {/* Header catégories */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "10px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#4b5563" }}>
              CATÉGORIES
            </span>
            <span style={{ fontSize: 9, fontWeight: 600, padding: "1px 6px", borderRadius: 4, background: "rgba(255,255,255,0.05)", color: "#4b5563" }}>
              {categories.length}
            </span>
          </div>
          <div style={{ display: "flex", gap: 14 }}>
            <button
              onClick={selectAll}
              style={{ fontSize: 11, fontWeight: 600, color: "#38bdf8", background: "none", border: "none", cursor: "pointer" }}
            >
              Tout sélectionner
            </button>
            <button
              onClick={clearAll}
              style={{ fontSize: 11, color: "#4b5563", background: "none", border: "none", cursor: "pointer" }}
            >
              Tout désélectionner
            </button>
          </div>
        </div>

        {scanning ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "32px 20px" }}>
            <div className="animate-spin" style={{ width: 16, height: 16, borderRadius: "50%", border: "2px solid rgba(56,189,248,0.15)", borderTopColor: "#38bdf8" }} />
            <span style={{ fontSize: 13, color: "#4b5563" }}>Analyse en cours...</span>
          </div>
        ) : (
          <div>
            {/* Barre de progression globale */}
            {allMb > 0 && (
              <div style={{ padding: "8px 16px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                <div style={{ height: 3, borderRadius: 2, overflow: "hidden", background: "rgba(255,255,255,0.06)" }}>
                  <div style={{ height: "100%", borderRadius: 2, transition: "width 0.5s", width: `${(totalMb / allMb) * 100}%`, background: "#f97316" }} />
                </div>
              </div>
            )}

            {categories.map((cat, i) => {
              const sel   = selected.has(cat.id);
              const empty = cat.file_count === 0;
              const pct   = allMb > 0 ? (cat.size_mb / allMb) * 100 : 0;

              return (
                <div
                  key={cat.id}
                  onClick={() => !empty && setSelected(prev => {
                    const n = new Set(prev);
                    if (n.has(cat.id)) n.delete(cat.id); else n.add(cat.id);
                    return n;
                  })}
                  style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "12px 16px", transition: "background 0.12s",
                    borderBottom: i < categories.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                    opacity: empty ? 0.4 : 1,
                    cursor: empty ? "default" : "pointer",
                    background: sel ? "rgba(56,189,248,0.06)" : "transparent",
                  }}
                  onMouseEnter={e => { if (!empty) e.currentTarget.style.background = sel ? "rgba(56,189,248,0.1)" : "rgba(255,255,255,0.03)"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = sel ? "rgba(56,189,248,0.06)" : "transparent"; }}
                >
                  <div style={{ color: sel ? "#38bdf8" : "rgba(255,255,255,0.15)", flexShrink: 0 }}>
                    {sel ? <SquareCheck size={15} /> : <Square size={15} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 500, color: sel ? "#f1f5f9" : "#94a3b8" }}>
                          {cat.label}
                        </span>
                        {cat.requires_admin && (
                          <span style={{
                            fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 4,
                            background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.25)",
                            color: "#fbbf24",
                          }}>Admin</span>
                        )}
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 700, fontFamily: "monospace", color: sel ? "#f97316" : "#4b5563" }}>
                        {cat.size_mb > 0 ? fmt(cat.size_mb) : "0 MB"}
                      </span>
                    </div>
                    <div style={{ height: 3, borderRadius: 2, overflow: "hidden", background: "rgba(255,255,255,0.06)" }}>
                      <div style={{ height: "100%", borderRadius: 2, width: `${pct}%`, background: sel ? "#f97316" : "rgba(255,255,255,0.08)" }} />
                    </div>
                    <div style={{ fontSize: 10, color: "#4b5563", marginTop: 3 }}>
                      {cat.file_count > 0 ? `${cat.file_count} fichiers` : "Vide"}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Avertissement ── */}
      <div style={{
        display: "flex", alignItems: "flex-start", gap: 10,
        padding: "12px 16px", borderRadius: 8,
        background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.2)",
        flexShrink: 0,
      }}>
        <AlertTriangle size={12} style={{ color: "#fbbf24", marginTop: 1, flexShrink: 0 }} />
        <p style={{ fontSize: 11, color: "#fbbf24", lineHeight: 1.6, margin: 0 }}>
          Les fichiers verrouillés par des applications actives sont ignorés automatiquement.
          Fermez vos navigateurs avant de nettoyer leurs caches pour de meilleurs résultats.
        </p>
      </div>
    </div>
  );
}
