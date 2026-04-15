import { useState, useCallback, useEffect } from "react";
import { Crown, CheckCircle, Bell, Monitor as MonitorIcon, Power, RefreshCw, AlertTriangle, CheckCircle as Check, XCircle, Copy, LogOut, Zap, Calendar, RotateCcw, HardDrive } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { activatePremiumKey } from "../lib/db";
import type { SystemStats, SystemInfo, StartupProgram } from "../types";
import type { UserData, PlanActivationData } from "../App";
import { TWEAKS } from "../lib/constants";
import PlanGate from "../components/PlanGate";

type InnerTab = "startup" | "settings";

interface Props {
  user:             UserData;
  activeCount:      number;
  perfScore:        number;
  stats:            SystemStats;
  info:             SystemInfo | null;
  onLogout:         () => void;
  onPlanActivated:  (d: PlanActivationData) => void;
}

const PRO_FEATURES = [
  "Overlay gaming in-game",
  "Profils de jeux illimités",
  "Optimisations avancées",
  "Support prioritaire",
  "Historique illimité",
  "Détection auto des jeux",
];

const CHECKOUT_URL_MONTHLY = "https://nexboost.fr/pro/monthly";
const CHECKOUT_URL_ANNUAL  = "https://nexboost.fr/pro/annual";

function formatExpiry(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(new Date(iso));
}

function daysRemaining(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
}

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

export default function SystemTab({
  user, activeCount, perfScore, stats, info, onLogout, onPlanActivated,
}: Props) {
  const isPro = user.plan === "pro";
  const [inner,       setInner]      = useState<InnerTab>("startup");
  const [appVersion,  setAppVersion] = useState("...");

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => setAppVersion("0.1.3"));
  }, []);

  const [programs, setPrograms] = useState<StartupProgram[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);

  const [vmInfo,     setVmInfo]     = useState<{ ram_total_gb: number; is_auto: boolean; min_mb: number; max_mb: number } | null>(null);
  const [vmLoading,  setVmLoading]  = useState(false);
  const [vmResult,   setVmResult]   = useState<string | null>(null);
  const [keyInput,   setKeyInput]   = useState("");
  const [keyLoading, setKeyLoading] = useState(false);
  const [keyError,   setKeyError]   = useState("");
  const [keySuccess, setKeySuccess] = useState(false);
  const [copied,     setCopied]     = useState(false);
  const [thresholds, setThresholds] = useState<{ cpu: number; ram: number; temp: number }>(() => {
    try { return JSON.parse(localStorage.getItem("nexboost_thresholds") || "{}"); }
    catch { return {}; }
  });

  const cpuThr  = thresholds.cpu  ?? 90;
  const ramThr  = thresholds.ram  ?? 90;
  const tempThr = thresholds.temp ?? 85;

  const saveThreshold = useCallback((key: "cpu" | "ram" | "temp", val: number) => {
    const updated = { ...thresholds, [key]: val };
    setThresholds(updated);
    localStorage.setItem("nexboost_thresholds", JSON.stringify(updated));
  }, [thresholds]);

  const loadVmInfo = async () => {
    try {
      const info = await invoke<{ ram_total_gb: number; is_auto: boolean; min_mb: number; max_mb: number }>("get_virtual_memory_info");
      setVmInfo(info);
    } catch {}
  };

  const handleSetVm = async (optimize: boolean) => {
    setVmLoading(true); setVmResult(null);
    try {
      const ok = await invoke<boolean>("set_virtual_memory", { optimize });
      setVmResult(ok ? (optimize ? "Optimisé — redémarrage requis" : "Restauré — redémarrage requis") : "Erreur");
      await loadVmInfo();
    } catch { setVmResult("Erreur"); }
    finally { setVmLoading(false); setTimeout(() => setVmResult(null), 4000); }
  };

  const loadPrograms = async () => {
    setLoading(true);
    try { setPrograms(await invoke<StartupProgram[]>("get_startup_programs")); }
    catch { setPrograms([]); }
    finally { setLoading(false); }
  };

  const handleToggle = async (prog: StartupProgram) => {
    const key = `${prog.name}__${prog.location}`;
    setToggling(key);
    try {
      const ok = await invoke<boolean>("toggle_startup_program", {
        name: prog.name, location: prog.location, enable: !prog.enabled,
      });
      if (ok) setPrograms(p =>
        p.map(x => x.name === prog.name && x.location === prog.location
          ? { ...x, enabled: !x.enabled } : x)
      );
    } catch {}
    setToggling(null);
  };

  const handleActivateKey = async () => {
    const trimmed = keyInput.trim().toUpperCase();
    if (!trimmed) { setKeyError("Entrez une clé d'accès Pro."); return; }
    setKeyLoading(true); setKeyError("");
    try {
      const result = await activatePremiumKey(user.id, trimmed);
      if (!result) { setKeyError("Clé invalide ou déjà utilisée."); return; }
      setKeySuccess(true);
      onPlanActivated(result);
    } catch { setKeyError("Erreur lors de l'activation."); }
    finally { setKeyLoading(false); }
  };

  const copySystemInfo = () => {
    const txt = [
      `NexBoost — Rapport système`,
      `─────────────────────────────`,
      `OS       : ${info?.os_name ?? "—"}`,
      `Machine  : ${info?.hostname ?? "—"}`,
      `CPU      : ${info?.cpu_brand ?? "—"}`,
      `Cœurs    : ${info?.cpu_cores ?? "—"} threads`,
      `RAM      : ${stats.ram_total_gb > 0 ? `${stats.ram_used_gb} / ${stats.ram_total_gb} GB` : "—"}`,
      `Disque   : ${stats.disk_total_gb > 0 ? `${stats.disk_used_gb} / ${stats.disk_total_gb} GB` : "—"}`,
      `Uptime   : ${info ? `${Math.floor(info.uptime_secs / 3600)}h` : "—"}`,
      `Score    : ${perfScore}/100`,
      `Tweaks   : ${activeCount}/${TWEAKS.length} actifs`,
    ].join("\n");
    navigator.clipboard.writeText(txt).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }).catch(() => {});
  };

  useEffect(() => { loadVmInfo(); }, []);

  const enabled = programs.filter(p => p.enabled);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }} className="animate-fadeIn">

      {/* ── En-tête de page ── */}
      <div style={{ padding: "20px 22px 0", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 16 }}>
          {/* Profil utilisateur */}
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{
              width: 48, height: 48, borderRadius: 12, flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 18, fontWeight: 800, color: "#fff",
              background: isPro
                ? "linear-gradient(135deg, #7c3aed, #a855f7)"
                : "rgba(56,189,248,0.15)",
              border: `1px solid ${isPro ? "rgba(168,85,247,0.4)" : "rgba(56,189,248,0.3)"}`,
            }}>
              {user.username.charAt(0).toUpperCase()}
            </div>
            <div>
              <h1 style={{ fontSize: 20, fontWeight: 800, color: "#f1f5f9", lineHeight: 1.2, margin: 0 }}>
                {user.username}
              </h1>
              <p style={{ fontSize: 11, color: "#4b5563", marginTop: 3, marginBottom: 0 }}>
                {user.email}
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 5 }}>
                <Crown size={9} style={{ color: isPro ? "#a78bfa" : "#38bdf8" }} />
                <span style={{ fontSize: 10, fontWeight: 600, color: isPro ? "#a78bfa" : "#38bdf8" }}>
                  {isPro ? "Plan Pro" : "Plan Gratuit"}
                </span>
              </div>
            </div>
          </div>

          {/* Score carte */}
          <div style={{
            background: "#0c0c1a",
            border: `1px solid ${isPro ? "rgba(168,85,247,0.2)" : "rgba(56,189,248,0.2)"}`,
            borderRadius: 10, padding: "10px 16px",
            display: "flex", flexDirection: "column", alignItems: "center",
            gap: 4, flexShrink: 0,
          }}>
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#4b5563" }}>
              SCORE
            </span>
            <span style={{ fontSize: 28, fontWeight: 800, fontFamily: "monospace", color: perfScore >= 75 ? "#4ade80" : perfScore >= 50 ? "#fbbf24" : "#f87171", lineHeight: 1 }}>
              {perfScore}
            </span>
            <span style={{ fontSize: 9, color: "#4b5563" }}>/100</span>
          </div>
        </div>

        {/* Onglets internes */}
        <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <button
            onClick={() => { setInner("startup"); if (programs.length === 0) loadPrograms(); }}
            style={innerTabStyle(inner === "startup")}
          >
            Démarrage
          </button>
          <button onClick={() => setInner("settings")} style={innerTabStyle(inner === "settings")}>
            Paramètres
          </button>
        </div>
      </div>

      {/* ── Contenu ── */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
        <div style={{ padding: "16px 22px 22px", display: "flex", flexDirection: "column", gap: 14 }}>

          {/* ═══ DÉMARRAGE ═══ */}
          {inner === "startup" && (
            <>
              {/* Header stats */}
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                background: "#0c0c1a", border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 10, padding: "14px 18px",
              }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#f1f5f9" }}>Programmes au démarrage</div>
                  <div style={{ fontSize: 11, color: "#4b5563", marginTop: 3 }}>
                    Activez ou désactivez les programmes lancés au démarrage de Windows
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "monospace", color: "#38bdf8", lineHeight: 1 }}>
                      {enabled.length}
                    </div>
                    <div style={{ fontSize: 9, color: "#4b5563", marginTop: 2 }}>actifs</div>
                  </div>
                  <button
                    onClick={loadPrograms}
                    disabled={loading}
                    style={{
                      padding: "7px 12px", borderRadius: 7, fontSize: 11, fontWeight: 600,
                      background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#94a3b8",
                      cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.5 : 1,
                      display: "flex", alignItems: "center", gap: 6, transition: "all 0.15s",
                    }}
                    onMouseEnter={e => { if (!loading) { e.currentTarget.style.background = "rgba(56,189,248,0.06)"; e.currentTarget.style.borderColor = "rgba(56,189,248,0.25)"; e.currentTarget.style.color = "#38bdf8"; }}}
                    onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "#94a3b8"; }}
                  >
                    <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
                    Actualiser
                  </button>
                </div>
              </div>

              {loading ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "40px 20px" }}>
                  <div className="animate-spin" style={{ width: 18, height: 18, borderRadius: "50%", border: "2px solid rgba(56,189,248,0.15)", borderTopColor: "#38bdf8" }} />
                  <span style={{ fontSize: 13, color: "#4b5563" }}>Lecture du registre Windows...</span>
                </div>
              ) : programs.length === 0 ? (
                <div style={{
                  background: "#0c0c1a", border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: 10, padding: "40px 20px", textAlign: "center",
                }}>
                  <Power size={28} style={{ color: "rgba(255,255,255,0.1)", margin: "0 auto 12px" }} />
                  <p style={{ fontSize: 13, fontWeight: 500, color: "#4b5563", margin: "0 0 5px" }}>Aucun programme détecté</p>
                  <p style={{ fontSize: 11, color: "#374151", margin: 0 }}>
                    Cliquez sur Actualiser ou vérifiez les droits administrateur
                  </p>
                </div>
              ) : (
                <div style={{ background: "#0c0c1a", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, overflow: "hidden" }}>
                  {programs.map((prog, i) => {
                    const key    = `${prog.name}__${prog.location}`;
                    const isLoad = toggling === key;
                    const short  = prog.command.length > 64 ? prog.command.slice(0, 62) + "…" : prog.command;
                    return (
                      <div
                        key={key}
                        style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                          padding: "12px 16px", transition: "background 0.12s",
                          borderBottom: i < programs.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                          background: prog.enabled ? "rgba(56,189,248,0.06)" : "transparent",
                          opacity: isLoad ? 0.6 : 1,
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = prog.enabled ? "rgba(56,189,248,0.1)" : "rgba(255,255,255,0.03)"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = prog.enabled ? "rgba(56,189,248,0.06)" : "transparent"; }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                          <div style={{
                            width: 32, height: 32, borderRadius: 7, flexShrink: 0,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            background: prog.enabled ? "rgba(56,189,248,0.12)" : "rgba(255,255,255,0.05)",
                          }}>
                            {prog.enabled
                              ? <Check size={14} style={{ color: "#38bdf8" }} />
                              : <XCircle size={14} style={{ color: "#4b5563" }} />}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 500, color: prog.enabled ? "#f1f5f9" : "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {prog.name}
                            </div>
                            <div style={{ fontSize: 10, fontFamily: "monospace", color: "#374151", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {short || "—"}
                            </div>
                          </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, marginLeft: 12 }}>
                          <span style={{
                            fontSize: 9, fontWeight: 600, padding: "2px 6px", borderRadius: 4,
                            background: prog.location === "HKCU" ? "rgba(56,189,248,0.12)" : "rgba(124,58,237,0.12)",
                            color: prog.location === "HKCU" ? "#38bdf8" : "#a78bfa",
                          }}>
                            {prog.location}
                          </span>
                          {isLoad ? (
                            <div className="animate-spin" style={{ width: 16, height: 16, borderRadius: "50%", border: "2px solid rgba(56,189,248,0.15)", borderTopColor: "#38bdf8" }} />
                          ) : (
                            <button
                              onClick={() => handleToggle(prog)}
                              style={{
                                fontSize: 11, padding: "5px 10px", borderRadius: 7, fontWeight: 600,
                                cursor: "pointer", transition: "all 0.15s",
                                background: prog.enabled ? "rgba(248,113,113,0.1)" : "rgba(74,222,128,0.1)",
                                border: `1px solid ${prog.enabled ? "rgba(248,113,113,0.25)" : "rgba(74,222,128,0.25)"}`,
                                color: prog.enabled ? "#f87171" : "#4ade80",
                              }}
                              onMouseEnter={e => { e.currentTarget.style.opacity = "0.8"; }}
                              onMouseLeave={e => { e.currentTarget.style.opacity = "1"; }}
                            >
                              {prog.enabled ? "Désactiver" : "Activer"}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div style={{
                display: "flex", alignItems: "flex-start", gap: 10,
                padding: "12px 16px", borderRadius: 8,
                background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.2)",
              }}>
                <AlertTriangle size={12} style={{ color: "#fbbf24", marginTop: 1, flexShrink: 0 }} />
                <p style={{ fontSize: 11, color: "#fbbf24", lineHeight: 1.6, margin: 0 }}>
                  La désactivation n'empêche pas l'utilisation du programme — il ne se lance simplement plus au démarrage.
                  Certaines entrées HKLM nécessitent des droits administrateur.
                </p>
              </div>
            </>
          )}

          {/* ═══ PARAMÈTRES ═══ */}
          {inner === "settings" && (
            <>
              {/* ── Compte ── */}
              <div style={{
                background: "#0c0c1a", border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 12, padding: "16px 18px",
              }}>
                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#374151", display: "block", marginBottom: 12 }}>
                  COMPTE
                </span>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                    <div style={{
                      width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 15, fontWeight: 800,
                      background: isPro ? "linear-gradient(135deg,#7c3aed,#a855f7)" : "rgba(56,189,248,0.12)",
                      border: `1px solid ${isPro ? "rgba(168,85,247,0.4)" : "rgba(56,189,248,0.25)"}`,
                      color: isPro ? "#fff" : "#38bdf8",
                    }}>
                      {isPro ? <Crown size={16} /> : user.username.charAt(0).toUpperCase()}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#f1f5f9", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {user.username}
                      </div>
                      <div style={{ fontSize: 11, color: "#4b5563", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {user.email}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 7, flexShrink: 0 }}>
                    <button
                      onClick={copySystemInfo}
                      title="Copier les infos système"
                      style={{
                        padding: "7px 11px", borderRadius: 7, fontSize: 11, fontWeight: 600,
                        background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#4b5563",
                        cursor: "pointer", display: "flex", alignItems: "center", gap: 5, transition: "all 0.15s",
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = "rgba(56,189,248,0.06)"; e.currentTarget.style.borderColor = "rgba(56,189,248,0.2)"; e.currentTarget.style.color = "#38bdf8"; }}
                      onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "#4b5563"; }}
                    >
                      <Copy size={11} />{copied ? "Copié !" : "Rapport"}
                    </button>
                    <button
                      onClick={onLogout}
                      style={{
                        padding: "7px 11px", borderRadius: 7, fontSize: 11, fontWeight: 600,
                        background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.18)", color: "#f87171",
                        cursor: "pointer", display: "flex", alignItems: "center", gap: 5, transition: "all 0.15s",
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = "rgba(248,113,113,0.18)"; }}
                      onMouseLeave={e => { e.currentTarget.style.background = "rgba(248,113,113,0.08)"; }}
                    >
                      <LogOut size={11} />Déconnecter
                    </button>
                  </div>
                </div>
              </div>

              {/* ── Seuils d'alerte ── */}
              <div style={{ background: "#0c0c1a", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "16px 18px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 16 }}>
                  <Bell size={12} style={{ color: "#f97316" }} />
                  <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#374151" }}>
                    SEUILS D'ALERTE
                  </span>
                  <span style={{ fontSize: 10, color: "#374151", marginLeft: 2 }}>— notification quand dépassé</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                  {([
                    { key: "cpu",  label: "CPU",         unit: "%",  color: "#38bdf8", val: cpuThr,  min: 60, max: 99 },
                    { key: "ram",  label: "RAM",         unit: "%",  color: "#818cf8", val: ramThr,  min: 60, max: 99 },
                    { key: "temp", label: "Température", unit: "°C", color: "#f97316", val: tempThr, min: 50, max: 99 },
                  ] as const).map(s => (
                    <div key={s.key}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ width: 8, height: 8, borderRadius: "50%", background: s.color, flexShrink: 0 }} />
                          <span style={{ fontSize: 12, fontWeight: 500, color: "#94a3b8" }}>{s.label}</span>
                        </div>
                        <span style={{
                          fontSize: 13, fontWeight: 700, fontFamily: "monospace",
                          color: s.color, background: `${s.color}14`,
                          padding: "2px 8px", borderRadius: 5,
                        }}>
                          {s.val}{s.unit}
                        </span>
                      </div>
                      <input
                        type="range" min={s.min} max={s.max} value={s.val}
                        onChange={e => saveThreshold(s.key, Number(e.target.value))}
                        style={{ width: "100%", accentColor: s.color, cursor: "pointer" }}
                      />
                      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                        <span style={{ fontSize: 10, color: "#374151" }}>{s.min}{s.unit}</span>
                        <span style={{ fontSize: 10, color: "#374151" }}>{s.max}{s.unit}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── Mémoire Virtuelle ── */}
              <div style={{ background: "#0c0c1a", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "16px 18px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 14 }}>
                  <HardDrive size={12} style={{ color: "#fbbf24" }} />
                  <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#374151" }}>MÉMOIRE VIRTUELLE</span>
                </div>
                {vmInfo && (
                  <div style={{ marginBottom: 14, padding: "10px 14px", borderRadius: 9, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <div>
                        <span style={{ fontSize: 10, color: "#4b5563" }}>Mode : </span>
                        <span style={{ fontSize: 11, fontWeight: 600, color: vmInfo.is_auto ? "#38bdf8" : "#4ade80" }}>
                          {vmInfo.is_auto ? "Géré par Windows" : "Taille fixe"}
                        </span>
                      </div>
                      {!vmInfo.is_auto && vmInfo.max_mb > 0 && (
                        <div>
                          <span style={{ fontSize: 10, color: "#4b5563" }}>Taille : </span>
                          <span style={{ fontSize: 11, fontWeight: 600, color: "#f1f5f9", fontFamily: "monospace" }}>
                            {vmInfo.min_mb} – {vmInfo.max_mb} MB
                          </span>
                        </div>
                      )}
                      <div>
                        <span style={{ fontSize: 10, color: "#4b5563" }}>RAM : </span>
                        <span style={{ fontSize: 11, fontWeight: 600, color: "#f1f5f9", fontFamily: "monospace" }}>
                          {vmInfo.ram_total_gb.toFixed(1)} GB
                        </span>
                      </div>
                    </div>
                  </div>
                )}
                {vmResult && (
                  <div style={{ padding: "8px 12px", borderRadius: 7, marginBottom: 12, background: "rgba(74,222,128,0.08)", border: "1px solid rgba(74,222,128,0.2)", fontSize: 11, color: "#4ade80" }} className="animate-fadeIn">
                    {vmResult}
                  </div>
                )}
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => handleSetVm(true)}
                    disabled={vmLoading}
                    style={{
                      flex: 1, padding: "8px 12px", borderRadius: 8, fontSize: 11, fontWeight: 700,
                      background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.25)", color: "#fbbf24",
                      cursor: vmLoading ? "not-allowed" : "pointer", opacity: vmLoading ? 0.6 : 1,
                      transition: "all 0.15s", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                    }}
                    onMouseEnter={e => { if (!vmLoading) e.currentTarget.style.background = "rgba(251,191,36,0.2)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "rgba(251,191,36,0.1)"; }}
                  >
                    {vmLoading
                      ? <div className="animate-spin" style={{ width: 12, height: 12, borderRadius: "50%", border: "2px solid rgba(251,191,36,0.2)", borderTopColor: "#fbbf24" }} />
                      : <Zap size={11} />}
                    Optimiser (×1.5/×3 RAM)
                  </button>
                  <button
                    onClick={() => handleSetVm(false)}
                    disabled={vmLoading}
                    style={{
                      padding: "8px 12px", borderRadius: 8, fontSize: 11, fontWeight: 600,
                      background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#4b5563",
                      cursor: vmLoading ? "not-allowed" : "pointer", opacity: vmLoading ? 0.6 : 1, transition: "all 0.15s",
                    }}
                    onMouseEnter={e => { if (!vmLoading) { e.currentTarget.style.color = "#94a3b8"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)"; }}}
                    onMouseLeave={e => { e.currentTarget.style.color = "#4b5563"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; }}
                  >
                    Restaurer auto
                  </button>
                </div>
                <p style={{ fontSize: 10, color: "#374151", marginTop: 8, marginBottom: 0, lineHeight: 1.5 }}>
                  L'optimisation fixe la taille à 1.5× – 3× la RAM totale. Évite les allocations dynamiques en cours de jeu.
                  Un redémarrage est nécessaire.
                </p>
              </div>

              {/* ── Overlay gaming ── */}
              <PlanGate isPro={isPro} feature="Overlay Gaming">
              <div style={{ background: "#0c0c1a", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "16px 18px" }}>
                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#374151", display: "block", marginBottom: 12 }}>
                  OVERLAY GAMING
                </span>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: 9, flexShrink: 0,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      background: "rgba(56,189,248,0.1)", border: "1px solid rgba(56,189,248,0.18)",
                    }}>
                      <MonitorIcon size={16} style={{ color: "#38bdf8" }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#f1f5f9" }}>Mini overlay always-on-top</div>
                      <div style={{ fontSize: 11, color: "#4b5563", marginTop: 2 }}>S'affiche par-dessus vos jeux</div>
                    </div>
                  </div>
                  <button
                    onClick={() => invoke("open_overlay").catch(() => {})}
                    style={{
                      padding: "8px 18px", borderRadius: 8, fontSize: 12, fontWeight: 700, flexShrink: 0,
                      background: "rgba(56,189,248,0.12)", border: "1px solid rgba(56,189,248,0.3)", color: "#38bdf8",
                      cursor: "pointer", transition: "all 0.15s",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = "rgba(56,189,248,0.22)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "rgba(56,189,248,0.12)"; }}
                  >
                    Ouvrir
                  </button>
                </div>
              </div>
              </PlanGate>

              {/* ── Plan Pro ── */}
              <div style={{
                background: "#0c0c1a",
                border: `1px solid ${isPro ? "rgba(124,58,237,0.35)" : "rgba(255,255,255,0.06)"}`,
                borderRadius: 12, padding: "16px 18px",
                position: "relative", overflow: "hidden",
              }}>
                {/* Glow Pro actif */}
                {isPro && (
                  <div style={{
                    position: "absolute", top: -20, right: -20, width: 160, height: 160,
                    background: "radial-gradient(circle, rgba(124,58,237,0.15) 0%, transparent 70%)",
                    pointerEvents: "none",
                  }} />
                )}

                {/* Header */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{
                      width: 34, height: 34, borderRadius: 9, flexShrink: 0,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      background: isPro ? "linear-gradient(135deg,#7c3aed,#a855f7)" : "rgba(124,58,237,0.1)",
                      border: `1px solid ${isPro ? "rgba(168,85,247,0.5)" : "rgba(124,58,237,0.2)"}`,
                    }}>
                      <Crown size={15} style={{ color: isPro ? "#fff" : "#a78bfa" }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9" }}>Plan Pro</div>
                      <div style={{ fontSize: 11, color: "#4b5563", marginTop: 1 }}>
                        {isPro ? "Toutes les fonctionnalités débloquées" : "Débloquez l'expérience complète NexBoost"}
                      </div>
                    </div>
                  </div>
                  {isPro && (
                    <span style={{
                      fontSize: 9, fontWeight: 700, padding: "3px 8px", borderRadius: 5,
                      background: "rgba(168,85,247,0.15)", border: "1px solid rgba(168,85,247,0.35)",
                      color: "#c084fc", letterSpacing: "0.08em",
                    }}>
                      ACTIF
                    </span>
                  )}
                </div>

                {/* ── Vue Pro actif ── */}
                {isPro && (
                  <>
                    {/* Infos abonnement — affiché seulement si des données existent */}
                    {(user.planExpiresAt || user.billingCycle) && (
                      <div style={{
                        display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
                        padding: "10px 14px", borderRadius: 9,
                        background: "rgba(124,58,237,0.08)", border: "1px solid rgba(124,58,237,0.18)",
                        marginBottom: 14,
                      }}>
                        {user.planExpiresAt && (
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <Calendar size={11} style={{ color: "#a78bfa", flexShrink: 0 }} />
                            <span style={{ fontSize: 11, color: "#94a3b8" }}>
                              Expire le <span style={{ color: "#f1f5f9", fontWeight: 600 }}>{formatExpiry(user.planExpiresAt)}</span>
                            </span>
                            {daysRemaining(user.planExpiresAt) <= 7 && (
                              <span style={{
                                fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 3,
                                background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.3)",
                                color: "#fbbf24",
                              }}>
                                {daysRemaining(user.planExpiresAt)}j restants
                              </span>
                            )}
                          </div>
                        )}
                        {user.billingCycle && (
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <RotateCcw size={10} style={{ color: "#a78bfa", flexShrink: 0 }} />
                            <span style={{ fontSize: 11, color: "#94a3b8" }}>
                              {user.billingCycle === "annual" ? "Annuel" : "Mensuel"}
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Features grid */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 12px" }}>
                      {PRO_FEATURES.map(f => (
                        <div key={f} style={{ display: "flex", alignItems: "center", gap: 7 }}>
                          <CheckCircle size={10} style={{ color: "#a78bfa", flexShrink: 0 }} />
                          <span style={{ fontSize: 11, color: "#64748b" }}>{f}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {/* ── Vue Free : cartes tarifaires ── */}
                {!isPro && !keySuccess && (
                  <>
                    {/* Cartes prix */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
                      {/* Mensuel */}
                      <div style={{
                        borderRadius: 10, padding: "14px 14px 12px",
                        background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)",
                        display: "flex", flexDirection: "column", gap: 8,
                      }}>
                        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#4b5563" }}>
                          MENSUEL
                        </span>
                        <div>
                          <span style={{ fontSize: 24, fontWeight: 800, color: "#f1f5f9", lineHeight: 1 }}>6.99€</span>
                          <span style={{ fontSize: 11, color: "#4b5563" }}>/mois</span>
                        </div>
                        <span style={{ fontSize: 10, color: "#374151" }}>Résiliable à tout moment</span>
                        <button
                          onClick={() => openUrl(CHECKOUT_URL_MONTHLY).catch(() => {})}
                          style={{
                            padding: "8px 0", borderRadius: 7, fontSize: 11, fontWeight: 700,
                            background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
                            color: "#94a3b8", cursor: "pointer", transition: "all 0.15s",
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background = "rgba(56,189,248,0.08)"; e.currentTarget.style.borderColor = "rgba(56,189,248,0.25)"; e.currentTarget.style.color = "#38bdf8"; }}
                          onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)"; e.currentTarget.style.color = "#94a3b8"; }}
                        >
                          Choisir →
                        </button>
                      </div>

                      {/* Annuel (mis en avant) */}
                      <div style={{
                        borderRadius: 10, padding: "14px 14px 12px",
                        background: "rgba(124,58,237,0.08)",
                        border: "1px solid rgba(124,58,237,0.3)",
                        display: "flex", flexDirection: "column", gap: 8,
                        position: "relative",
                      }}>
                        <span style={{
                          position: "absolute", top: -1, right: 10,
                          fontSize: 8, fontWeight: 800, letterSpacing: "0.1em",
                          padding: "2px 7px", borderRadius: "0 0 5px 5px",
                          background: "linear-gradient(135deg,#7c3aed,#a855f7)", color: "#fff",
                        }}>
                          POPULAIRE
                        </span>
                        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#7c3aed" }}>
                          ANNUEL
                        </span>
                        <div>
                          <span style={{ fontSize: 24, fontWeight: 800, color: "#f1f5f9", lineHeight: 1 }}>34.99€</span>
                          <span style={{ fontSize: 11, color: "#4b5563" }}>/an</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                          <span style={{ fontSize: 10, color: "#64748b" }}>≈ 2.92€/mois</span>
                          <span style={{
                            fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 3,
                            background: "rgba(74,222,128,0.12)", border: "1px solid rgba(74,222,128,0.25)",
                            color: "#4ade80",
                          }}>
                            −58%
                          </span>
                        </div>
                        <button
                          onClick={() => openUrl(CHECKOUT_URL_ANNUAL).catch(() => {})}
                          style={{
                            padding: "8px 0", borderRadius: 7, fontSize: 11, fontWeight: 700,
                            background: "linear-gradient(135deg,#7c3aed,#a855f7)", border: "none",
                            color: "#fff", cursor: "pointer", transition: "opacity 0.15s",
                          }}
                          onMouseEnter={e => { e.currentTarget.style.opacity = "0.85"; }}
                          onMouseLeave={e => { e.currentTarget.style.opacity = "1"; }}
                        >
                          Choisir →
                        </button>
                      </div>
                    </div>

                    {/* Séparateur */}
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                      <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.05)" }} />
                      <span style={{ fontSize: 10, color: "#374151" }}>Déjà un code d'accès ?</span>
                      <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.05)" }} />
                    </div>

                    {/* Activation clé */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                      <div style={{ display: "flex", gap: 8 }}>
                        <input
                          className="input-base"
                          style={{ padding: "8px 12px", fontSize: 12, letterSpacing: "0.08em", fontFamily: "monospace" }}
                          placeholder="XXXX-XXXX-XXXX-XXXX"
                          value={keyInput}
                          onChange={e => { setKeyInput(e.target.value.toUpperCase()); setKeyError(""); }}
                          onKeyDown={e => e.key === "Enter" && handleActivateKey()}
                        />
                        <button
                          onClick={handleActivateKey}
                          disabled={keyLoading}
                          style={{
                            padding: "8px 14px", borderRadius: 8, fontSize: 12, fontWeight: 700, flexShrink: 0,
                            background: "rgba(124,58,237,0.15)", border: "1px solid rgba(124,58,237,0.35)", color: "#a78bfa",
                            cursor: keyLoading ? "not-allowed" : "pointer",
                            display: "flex", alignItems: "center", gap: 6, transition: "all 0.15s",
                            opacity: keyLoading ? 0.6 : 1,
                          }}
                          onMouseEnter={e => { if (!keyLoading) { e.currentTarget.style.background = "rgba(124,58,237,0.25)"; } }}
                          onMouseLeave={e => { e.currentTarget.style.background = "rgba(124,58,237,0.15)"; }}
                        >
                          {keyLoading
                            ? <div className="animate-spin" style={{ width: 14, height: 14, borderRadius: "50%", border: "2px solid rgba(167,139,250,0.2)", borderTopColor: "#a78bfa" }} />
                            : <><Zap size={12} /> Activer</>}
                        </button>
                      </div>
                      {keyError && (
                        <p style={{ fontSize: 11, color: "#f87171", margin: 0, display: "flex", alignItems: "center", gap: 5 }} className="animate-fadeIn">
                          <AlertTriangle size={11} />{keyError}
                        </p>
                      )}
                    </div>

                    {/* Features grid */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 12px", marginTop: 14 }}>
                      {PRO_FEATURES.map(f => (
                        <div key={f} style={{ display: "flex", alignItems: "center", gap: 7 }}>
                          <CheckCircle size={10} style={{ color: "#374151", flexShrink: 0 }} />
                          <span style={{ fontSize: 11, color: "#374151" }}>{f}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {/* ── Clé activée avec succès ── */}
                {!isPro && keySuccess && (
                  <div style={{
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                    padding: "14px 0", borderRadius: 8, fontSize: 12, fontWeight: 600,
                    background: "rgba(74,222,128,0.08)", border: "1px solid rgba(74,222,128,0.2)", color: "#4ade80",
                  }} className="animate-fadeIn">
                    <CheckCircle size={13} /> Plan Pro activé avec succès !
                  </div>
                )}
              </div>

              {/* ── À propos ── */}
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                padding: "12px 18px", borderRadius: 10,
                background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)",
              }}>
                <span style={{ fontSize: 10, color: "#374151" }}>NexBoost</span>
                <div style={{ width: 3, height: 3, borderRadius: "50%", background: "#374151" }} />
                <span style={{
                  fontSize: 10, fontWeight: 700, fontFamily: "monospace",
                  color: "#38bdf8", background: "rgba(56,189,248,0.08)",
                  padding: "2px 8px", borderRadius: 4,
                }}>
                  v{appVersion}
                </span>
                <div style={{ width: 3, height: 3, borderRadius: "50%", background: "#374151" }} />
                <span style={{ fontSize: 10, color: "#374151" }}>Windows 10/11</span>
              </div>

              <div style={{ height: 2 }} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
