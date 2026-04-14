import { useState, useEffect, useRef } from "react";
import nexboostLogo from "../assets/nexboost-logo.svg";
import { AlertTriangle, CheckCircle, Crown, LogOut, Minus, X, Zap, Settings, Wifi, Trash2, Gamepad2, LayoutDashboard, ShieldAlert, ShieldCheck, Download } from "lucide-react";
import { check as checkUpdate } from "@tauri-apps/plugin-updater";
import { relaunch, exit as processExit } from "@tauri-apps/plugin-process";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { UserData } from "../App";
import type { GpuStats, TweakResult, TweakStatus, Tab } from "../types";
import { TWEAKS } from "../lib/constants";
import { useSystemStats } from "../hooks/useSystemStats";
import { notify } from "../lib/notify";

import DashboardTab   from "../tabs/DashboardTab";
import PerformanceTab from "../tabs/PerformanceTab";
import NetworkTab     from "../tabs/NetworkTab";
import CleanupTab     from "../tabs/CleanupTab";
import GamesTab       from "../tabs/GamesTab";
import SystemTab      from "../tabs/SystemTab";

interface Props { user: UserData; onLogout: () => void; onPremiumActivated: () => void; }

const BG = {
  background: "#07070d",
  backgroundImage: `
    repeating-radial-gradient(ellipse at 20% 55%, transparent 0, transparent 58px, rgba(255,255,255,0.022) 59px, rgba(255,255,255,0.022) 60px),
    repeating-radial-gradient(ellipse at 78% 28%, transparent 0, transparent 78px, rgba(255,255,255,0.018) 79px, rgba(255,255,255,0.018) 80px),
    repeating-radial-gradient(ellipse at 50% 80%, transparent 0, transparent 98px, rgba(255,255,255,0.014) 99px, rgba(255,255,255,0.014) 100px)
  `,
} as React.CSSProperties;

const NAV_ITEMS: { id: Tab; icon: React.ReactNode; label: string }[] = [
  { id: "dashboard",   icon: <LayoutDashboard size={16} />, label: "Dashboard"     },
  { id: "performance", icon: <Zap size={16} />,             label: "Optimisations" },
  { id: "network",     icon: <Wifi size={16} />,            label: "Réseau"        },
  { id: "cleanup",     icon: <Trash2 size={16} />,          label: "Nettoyage"     },
  { id: "games",       icon: <Gamepad2 size={16} />,        label: "Jeux"          },
  { id: "system",      icon: <Settings size={16} />,        label: "Système"       },
];

const win = getCurrentWindow();

const handleDragStart = (e: React.MouseEvent) => {
  if (e.button !== 0) return;
  if ((e.target as HTMLElement).closest("button")) return;
  win.startDragging().catch(() => {});
};

export default function Dashboard({ user, onLogout, onPremiumActivated }: Props) {
  const { stats, history, info, ping, pingHistory } = useSystemStats();

  const [activeTab,      setActiveTab]      = useState<Tab>("dashboard");
  const [tweakStates,    setTweakStates]    = useState<Record<string, boolean>>({});
  const [tweakLoading,   setTweakLoading]   = useState<Record<string, boolean>>({});
  const [toasts,         setToasts]         = useState<{ id: number; msg: string; ok: boolean }[]>([]);
  const [optimizing,     setOptimizing]     = useState(false);
  const [optimizedCount, setOptimizedCount] = useState(0);
  const [gpuHistory,     setGpuHistory]     = useState<number[]>(Array(30).fill(0));
  const [isAdmin,        setIsAdmin]        = useState<boolean | null>(null);
  const [relaunching,    setRelaunching]    = useState(false);
  const [updateVersion,  setUpdateVersion]  = useState<string | null>(null);
  const [installing,     setInstalling]     = useState(false);
  const tempNotifSentAt = useRef<number>(0);

  // ── Vérification mise à jour (après 15s pour ne pas ralentir le démarrage) ──
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const update = await checkUpdate();
        if (update?.available) {
          setUpdateVersion(update.version);
          notify("🔄 Mise à jour disponible", `NexBoost v${update.version} est prêt à installer !`);
        }
      } catch {}
    }, 15_000);
    return () => clearTimeout(t);
  }, []);

  const handleInstallUpdate = async () => {
    setInstalling(true);
    try {
      const update = await checkUpdate();
      if (update?.available) {
        await update.downloadAndInstall();
        // exit(0) laisse le NSIS installer terminer et redémarrer l'app
        // relaunch() relançait l'ancienne version avant que l'install soit finie
        await processExit(0);
      }
    } catch {
      setInstalling(false);
    }
  };

  // ── Vérification droits admin au démarrage ──
  useEffect(() => {
    invoke<boolean>("is_admin").then(setIsAdmin).catch(() => setIsAdmin(false));
  }, []);

  const handleRelaunchAdmin = async () => {
    setRelaunching(true);
    try { await invoke("relaunch_as_admin"); } catch {}
    setRelaunching(false);
  };

  // ── Chargement de l'état réel des tweaks depuis le registre ──
  useEffect(() => {
    invoke<TweakStatus[]>("get_tweaks_status")
      .then(statuses => {
        const states: Record<string, boolean> = {};
        statuses.forEach(s => { states[s.id] = s.active; });
        setTweakStates(states);
      })
      .catch(() => {});
  }, []);

  const thresholds = (() => {
    try { return { temp: 85, cpu: 90, ram: 90, ...JSON.parse(localStorage.getItem("nexboost_thresholds") || "{}") }; }
    catch { return { temp: 85, cpu: 90, ram: 90 }; }
  })();
  const tempAlert  = stats.temp > thresholds.temp && stats.temp > 0;
  const perfScore  = Math.max(0, Math.min(100, Math.floor(100 - (stats.cpu + stats.ram) / 4)));
  const activeCount = Object.values(tweakStates).filter(Boolean).length;

  /* Alerte température → notification OS (max 1 fois / 5 min) */
  useEffect(() => {
    if (stats.temp > 0 && stats.temp > thresholds.temp) {
      const now = Date.now();
      if (now - tempNotifSentAt.current > 5 * 60 * 1000) {
        tempNotifSentAt.current = now;
        notify("⚠️ Température CPU élevée", `CPU à ${stats.temp}°C — pensez à nettoyer vos ventilateurs.`);
      }
    }
  }, [stats.temp, thresholds.temp]);

  /* GPU polling */
  useEffect(() => {
    const fetch = () => {
      invoke<GpuStats>("get_gpu_stats").then(g => {
        setGpuHistory(h => [...h.slice(-29), g.usage]);
      }).catch(() => {});
    };
    fetch();
    const iv = setInterval(fetch, 3000);
    return () => clearInterval(iv);
  }, []);

  /* Raccourcis clavier 1-6 */
  useEffect(() => {
    const TABS: Tab[] = ["dashboard", "performance", "network", "cleanup", "games", "system"];
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const idx = parseInt(e.key) - 1;
      if (!isNaN(idx) && idx >= 0 && idx < TABS.length) setActiveTab(TABS[idx]);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const toast = (msg: string, ok: boolean) => {
    const id = Date.now() + Math.random();
    setToasts(p => [...p, { id, msg, ok }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3500);
  };

  const handleToggleTweak = async (id: string) => {
    const isActive = tweakStates[id] ?? false;
    setTweakLoading(p => ({ ...p, [id]: true }));
    try {
      const result = await invoke<TweakResult>(isActive ? "revert_tweak" : "apply_tweak", { id });
      if (result.success) setTweakStates(p => ({ ...p, [id]: !isActive }));
      toast(result.message, result.success);
    } catch {
      toast(`Erreur pour le tweak '${id}'`, false);
    } finally {
      setTweakLoading(p => ({ ...p, [id]: false }));
    }
  };

  const handleBigBoost = async () => {
    setOptimizing(true); setOptimizedCount(0);
    for (let i = 0; i < TWEAKS.length; i++) {
      try {
        const result = await invoke<TweakResult>("apply_tweak", { id: TWEAKS[i].id });
        if (result.success) setTweakStates(p => ({ ...p, [TWEAKS[i].id]: true }));
      } catch {}
      setOptimizedCount(i + 1);
    }
    setOptimizing(false);
    toast(`Boost appliqué — ${TWEAKS.length} optimisations traitées`, true);
    notify("✅ Boost NexBoost terminé", `${TWEAKS.length} optimisations appliquées avec succès.`);
    setActiveTab("performance");
  };

  return (
    <div className="fixed inset-0 select-none animate-fadeIn" style={BG}>
      <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>

        {/* ── Sidebar icon-only ── */}
        <aside
          onMouseDown={handleDragStart}
          style={{
            width: 52,
            background: "#09091a",
            borderRight: "1px solid rgba(255,255,255,0.05)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            padding: "12px 0 10px",
            flexShrink: 0,
            userSelect: "none",
          }}
        >
          {/* Logo NexBoost */}
          <img
            src={nexboostLogo}
            alt="NexBoost"
            style={{ width: 30, height: 30, borderRadius: 7, marginBottom: 14, flexShrink: 0 }}
          />

          {/* Navigation */}
          <nav style={{ display: "flex", flexDirection: "column", gap: 4, width: "100%", padding: "0 8px" }}>
            {NAV_ITEMS.map(({ id, icon, label }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                title={label}
                style={{
                  position: "relative",
                  width: "100%", height: 36, borderRadius: 7,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: activeTab === id ? "rgba(56,189,248,0.12)" : "transparent",
                  border: activeTab === id ? "1px solid rgba(56,189,248,0.22)" : "1px solid transparent",
                  color: activeTab === id ? "#38bdf8" : "#4b5563",
                  cursor: "pointer",
                  transition: "all 0.15s",
                  flexShrink: 0,
                }}
                onMouseEnter={e => {
                  if (activeTab !== id) {
                    e.currentTarget.style.background = "rgba(255,255,255,0.05)";
                    e.currentTarget.style.color = "#94a3b8";
                  }
                }}
                onMouseLeave={e => {
                  if (activeTab !== id) {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.color = "#4b5563";
                  }
                }}
              >
                {icon}
                {id === "dashboard" && tempAlert && (
                  <span
                    style={{
                      position: "absolute", top: 5, right: 5,
                      width: 5, height: 5, borderRadius: "50%",
                      background: "#f87171",
                    }}
                  />
                )}
              </button>
            ))}
          </nav>

          <div style={{ flex: 1 }} />

          {/* Avatar utilisateur (affichage seul) */}
          <div
            title={user.username}
            style={{
              width: 28, height: 28, borderRadius: "50%", marginBottom: 6,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 11, fontWeight: 700, flexShrink: 0,
              background: user.premium ? "rgba(168,85,247,0.2)" : "rgba(56,189,248,0.15)",
              border: `1px solid ${user.premium ? "rgba(168,85,247,0.4)" : "rgba(56,189,248,0.3)"}`,
              color: user.premium ? "#c084fc" : "#38bdf8",
            }}
          >
            {user.premium ? <Crown size={11} /> : user.username.charAt(0).toUpperCase()}
          </div>

          {/* Indicateur admin */}
          {isAdmin !== null && (
            <div
              title={isAdmin ? "Administrateur — tous les tweaks disponibles" : "Mode limité — cliquer pour relancer en admin"}
              onClick={isAdmin ? undefined : handleRelaunchAdmin}
              style={{
                width: 28, height: 28, borderRadius: 7, marginBottom: 4,
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0, cursor: isAdmin ? "default" : "pointer",
                background: isAdmin ? "rgba(74,222,128,0.1)" : "rgba(251,191,36,0.1)",
                border: `1px solid ${isAdmin ? "rgba(74,222,128,0.25)" : "rgba(251,191,36,0.3)"}`,
                color: isAdmin ? "#4ade80" : "#fbbf24",
                transition: "all 0.15s",
              }}
            >
              {isAdmin ? <ShieldCheck size={12} /> : <ShieldAlert size={12} />}
            </div>
          )}

          {/* Bouton déconnexion */}
          <button
            onClick={onLogout}
            title="Se déconnecter"
            style={{
              width: 32, height: 32, borderRadius: 7, marginBottom: 6,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "transparent", border: "1px solid transparent",
              color: "#374151", cursor: "pointer", transition: "all 0.15s", flexShrink: 0,
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = "rgba(248,113,113,0.1)";
              e.currentTarget.style.borderColor = "rgba(248,113,113,0.25)";
              e.currentTarget.style.color = "#f87171";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.borderColor = "transparent";
              e.currentTarget.style.color = "#374151";
            }}
          >
            <LogOut size={14} />
          </button>
        </aside>

        {/* ── Zone principale ── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

          {/* ── Barre du haut (drag + fenêtre) ── */}
          <div
            onMouseDown={handleDragStart}
            style={{
              height: 30,
              display: "flex", alignItems: "center", justifyContent: "flex-end",
              padding: "0 6px",
              flexShrink: 0,
              userSelect: "none",
              cursor: "default",
            }}
          >
            {/* Gauche : alerte admin / update / live */}
            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6, paddingLeft: 4, minWidth: 0 }}>
              {isAdmin === false ? (
                /* ── Alerte admin dans la titlebar ── */
                <>
                  <ShieldAlert size={10} style={{ color: "#fbbf24", flexShrink: 0 }} />
                  <span style={{ fontSize: 9, color: "#fbbf24", fontWeight: 500, whiteSpace: "nowrap" }}>
                    Mode limité
                  </span>
                  <button
                    onClick={handleRelaunchAdmin}
                    disabled={relaunching}
                    style={{
                      display: "flex", alignItems: "center", gap: 4,
                      padding: "2px 8px", borderRadius: 4,
                      fontSize: 9, fontWeight: 700,
                      cursor: relaunching ? "not-allowed" : "pointer",
                      background: "rgba(251,191,36,0.12)",
                      border: "1px solid rgba(251,191,36,0.3)",
                      color: "#fbbf24", transition: "all 0.15s", flexShrink: 0,
                    }}
                    onMouseEnter={e => { if (!relaunching) e.currentTarget.style.background = "rgba(251,191,36,0.22)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "rgba(251,191,36,0.12)"; }}
                  >
                    {relaunching
                      ? <div className="animate-spin" style={{ width: 7, height: 7, borderRadius: "50%", border: "2px solid rgba(251,191,36,0.2)", borderTopColor: "#fbbf24" }} />
                      : <ShieldAlert size={8} />}
                    {relaunching ? "Relancement..." : "Relancer en admin"}
                  </button>
                </>
              ) : updateVersion ? (
                /* ── Alerte mise à jour dans la titlebar ── */
                <>
                  <Download size={10} style={{ color: "#38bdf8", flexShrink: 0 }} />
                  <span style={{ fontSize: 9, color: "#38bdf8", fontWeight: 500, whiteSpace: "nowrap" }}>
                    v{updateVersion} dispo
                  </span>
                  <button
                    onClick={handleInstallUpdate}
                    disabled={installing}
                    style={{
                      display: "flex", alignItems: "center", gap: 4,
                      padding: "2px 8px", borderRadius: 4,
                      fontSize: 9, fontWeight: 700,
                      cursor: installing ? "not-allowed" : "pointer",
                      background: "rgba(56,189,248,0.12)",
                      border: "1px solid rgba(56,189,248,0.3)",
                      color: "#38bdf8", transition: "all 0.15s", flexShrink: 0,
                    }}
                    onMouseEnter={e => { if (!installing) e.currentTarget.style.background = "rgba(56,189,248,0.22)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "rgba(56,189,248,0.12)"; }}
                  >
                    {installing
                      ? <div className="animate-spin" style={{ width: 7, height: 7, borderRadius: "50%", border: "2px solid rgba(56,189,248,0.2)", borderTopColor: "#38bdf8" }} />
                      : <Download size={8} />}
                    {installing ? "Installation..." : "Installer"}
                  </button>
                  <button
                    onClick={() => setUpdateVersion(null)}
                    style={{ background: "none", border: "none", color: "#4b5563", cursor: "pointer", padding: 2, display: "flex", flexShrink: 0 }}
                  >
                    <X size={9} />
                  </button>
                </>
              ) : (
                /* ── Indicateur live normal ── */
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <div style={{ width: 4, height: 4, borderRadius: "50%", background: "#22c55e" }} />
                    <span style={{ fontSize: 8, letterSpacing: "0.08em", textTransform: "uppercase", color: "#1e3a2f" }}>
                      Live
                    </span>
                  </div>
                  {tempAlert && (
                    <div
                      className="animate-fadeIn"
                      style={{
                        fontSize: 8, fontWeight: 600, padding: "1px 5px", borderRadius: 3,
                        background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)",
                        color: "#f87171", display: "flex", alignItems: "center", gap: 3,
                      }}
                    >
                      <AlertTriangle size={7} /> {stats.temp}°C
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Minimize + Close */}
            <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
              <button
                onClick={() => win.minimize().catch(() => {})}
                style={{
                  width: 22, height: 22, borderRadius: 4, background: "transparent",
                  border: "none", color: "#374151", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "all 0.15s",
                }}
                onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.07)"; e.currentTarget.style.color = "#94a3b8"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#374151"; }}
              >
                <Minus size={10} />
              </button>
              <button
                onClick={() => win.close().catch(() => {})}
                style={{
                  width: 22, height: 22, borderRadius: 4, background: "transparent",
                  border: "none", color: "#374151", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "all 0.15s",
                }}
                onMouseEnter={e => { e.currentTarget.style.background = "rgba(220,38,38,0.1)"; e.currentTarget.style.color = "#ef4444"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#374151"; }}
              >
                <X size={10} />
              </button>
            </div>
          </div>

          {/* ── Contenu de l'onglet ── */}
          <div style={{ flex: 1, overflow: "hidden" }}>
            {activeTab === "dashboard" && (
              <DashboardTab
                stats={stats} history={history} gpuHistory={gpuHistory}
                perfScore={perfScore} activeCount={activeCount}
                optimizing={optimizing} handleBigBoost={handleBigBoost}
                username={user.username} setActiveTab={setActiveTab}
              />
            )}
            {activeTab === "performance" && (
              <PerformanceTab
                tweakStates={tweakStates} tweakLoading={tweakLoading}
                activeCount={activeCount} handleToggleTweak={handleToggleTweak}
                setTweakStates={setTweakStates}
              />
            )}
            {activeTab === "network"  && <NetworkTab ping={ping} pingHistory={pingHistory} />}
            {activeTab === "cleanup"  && <CleanupTab />}
            {activeTab === "games"    && <GamesTab userId={user.id} />}
            {activeTab === "system"   && (
              <SystemTab
                user={user} activeCount={activeCount} perfScore={perfScore}
                stats={stats} info={info} onLogout={onLogout}
                onPremiumActivated={onPremiumActivated}
              />
            )}
          </div>
        </div>
      </div>

      {/* ── Toasts ── */}
      {toasts.length > 0 && (
        <div className="fixed bottom-5 right-5 flex flex-col gap-2 z-50 pointer-events-none">
          {toasts.map(t => (
            <div
              key={t.id}
              className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-xs font-medium animate-fadeIn"
              style={{
                background: t.ok ? "rgba(34,197,94,0.1)" : "rgba(248,113,113,0.1)",
                border: `1px solid ${t.ok ? "rgba(34,197,94,0.3)" : "rgba(248,113,113,0.3)"}`,
                color: t.ok ? "#4ade80" : "#f87171",
                boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
                maxWidth: 300,
              }}
            >
              {t.ok
                ? <CheckCircle size={12} style={{ flexShrink: 0 }} />
                : <AlertTriangle size={12} style={{ flexShrink: 0 }} />}
              {t.msg}
            </div>
          ))}
        </div>
      )}

      {/* ── Boost en cours ── */}
      {optimizing && (
        <div
          className="fixed bottom-5 left-1/2 -translate-x-1/2 flex items-center gap-3 px-5 py-3 rounded-xl z-50 animate-fadeIn"
          style={{
            background: "#0e0e18",
            border: "1px solid rgba(56,189,248,0.25)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          }}
        >
          <div
            className="w-4 h-4 rounded-full border-2 animate-spin"
            style={{ borderColor: "rgba(56,189,248,0.2)", borderTopColor: "#38bdf8" }}
          />
          <span className="text-sm font-medium" style={{ color: "#f1f5f9" }}>
            Boost en cours... {optimizedCount}/{TWEAKS.length}
          </span>
          <Zap size={14} style={{ color: "#38bdf8" }} />
        </div>
      )}
    </div>
  );
}
