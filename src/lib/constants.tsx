import {
  Zap, Cpu, Wifi, HardDrive, Monitor, Shield, Activity, Gauge,
  Trash2, Layers, BarChart2, LayoutDashboard, Settings, Power, Gamepad2,
  MousePointer2, Keyboard, Timer, Network, Server, Radio,
} from "lucide-react";
import type { Tab } from "../types";

export interface Tweak {
  id:    string;
  label: string;
  desc:  string;
  icon:  React.ReactNode;
  color: string;
  group: "fps" | "latency" | "network" | "input" | "services" | "gpu";
  requiresAdmin?: boolean;
}

export const TWEAKS: Tweak[] = [
  // ─── FPS Boost ───────────────────────────────────────────────
  {
    id: "power", group: "fps", color: "#f59e0b",
    label: "Plan haute performance",
    desc:  "Désactive l'économie d'énergie pour des performances CPU/GPU maximales",
    icon: <Zap size={14} />,
  },
  {
    id: "priority", group: "fps", color: "#f59e0b",
    label: "Priorité CPU premier plan",
    desc:  "Alloue plus de temps processeur aux applications actives (Win32PrioritySeparation)",
    icon: <Cpu size={14} />,
  },
  {
    id: "hags", group: "fps", color: "#f59e0b", requiresAdmin: true,
    label: "GPU Scheduling matériel (HAGS)",
    desc:  "Réduit la latence GPU en déléguant la planification au pilote graphique",
    icon: <Monitor size={14} />,
  },
  {
    id: "core_parking", group: "fps", color: "#f59e0b", requiresAdmin: true,
    label: "Désactiver Core Parking CPU",
    desc:  "Maintient tous les cœurs processeur actifs — supprime les micro-stutters",
    icon: <Cpu size={14} />,
  },
  {
    id: "power_throttling", group: "fps", color: "#f59e0b", requiresAdmin: true,
    label: "Désactiver Power Throttling",
    desc:  "Empêche Windows de brider automatiquement la puissance CPU en arrière-plan",
    icon: <Zap size={14} />,
  },
  {
    id: "timer_res", group: "fps", color: "#f59e0b", requiresAdmin: true,
    label: "Timer Résolution 1 ms",
    desc:  "Force la résolution du timer système à 1 ms pour des FPS plus stables",
    icon: <Timer size={14} />,
  },
  {
    id: "ultimate_performance", group: "fps", color: "#f59e0b", requiresAdmin: true,
    label: "Plan Performances Ultimes",
    desc:  "Active le plan d'alimentation caché Windows avec toutes les limites levées",
    icon: <Power size={14} />,
  },
  {
    id: "gamebar", group: "fps", color: "#f59e0b",
    label: "Désactiver Xbox Game Bar",
    desc:  "Supprime l'overlay Xbox qui consomme du GPU et de la RAM inutilement",
    icon: <Shield size={14} />,
  },
  {
    id: "gamemode", group: "fps", color: "#f59e0b",
    label: "Activer le Game Mode Windows",
    desc:  "Priorise le jeu actif et réduit l'activité des tâches en arrière-plan",
    icon: <Gauge size={14} />,
  },
  {
    id: "msi_mode", group: "fps", color: "#f59e0b", requiresAdmin: true,
    label: "MSI Mode GPU & Réseau",
    desc:  "Active les interruptions MSI sur GPU et carte réseau — réduit la latence d'interruption matérielle",
    icon: <Cpu size={14} />,
  },
  {
    id: "c_states", group: "fps", color: "#f59e0b", requiresAdmin: true,
    label: "Désactiver C-States CPU",
    desc:  "Empêche le CPU d'entrer en veille profonde — élimine les latences de réveil entre les frames",
    icon: <Zap size={14} />,
  },

  // ─── Latence Système ─────────────────────────────────────────
  {
    id: "nagle", group: "latency", color: "#ef4444", requiresAdmin: true,
    label: "Désactiver algorithme Nagle",
    desc:  "Envoie chaque paquet TCP immédiatement sans attendre — réduit le ping en jeu",
    icon: <Network size={14} />,
  },
  {
    id: "network_throttle", group: "latency", color: "#ef4444", requiresAdmin: true,
    label: "Désactiver Network Throttling",
    desc:  "Supprime la limite de bande passante réseau imposée par Windows (MMCSS)",
    icon: <Wifi size={14} />,
  },
  {
    id: "mmcss", group: "latency", color: "#ef4444", requiresAdmin: true,
    label: "Optimiser MMCSS Gaming",
    desc:  "Passe les tâches jeux en priorité haute dans le scheduler multimédia Windows",
    icon: <Activity size={14} />,
  },
  {
    id: "dynamic_tick", group: "latency", color: "#ef4444", requiresAdmin: true,
    label: "Désactiver Dynamic Tick",
    desc:  "Stabilise la fréquence d'horloge système pour éliminer les micro-stutters",
    icon: <Timer size={14} />,
  },

  // ─── Réseau ──────────────────────────────────────────────────
  {
    id: "network", group: "network", color: "#0891b2",
    label: "Optimiser TCP Autotuning",
    desc:  "Active l'auto-tuning TCP Windows pour améliorer le débit et la stabilité",
    icon: <Wifi size={14} />,
  },
  {
    id: "dns_fast", group: "network", color: "#0891b2", requiresAdmin: true,
    label: "DNS Cloudflare 1.1.1.1",
    desc:  "Remplace les DNS FAI par Cloudflare 1.1.1.1 + Google 8.8.8.8 (plus rapides)",
    icon: <Server size={14} />,
  },
  {
    id: "qos", group: "network", color: "#0891b2", requiresAdmin: true,
    label: "Désactiver réservation QoS 20%",
    desc:  "Libère les 20% de bande passante que Windows réserve par défaut pour lui-même",
    icon: <Radio size={14} />,
  },
  {
    id: "lso", group: "network", color: "#0891b2", requiresAdmin: true,
    label: "Désactiver Large Send Offload",
    desc:  "Réduit la latence réseau en désactivant le LSO sur toutes les interfaces actives",
    icon: <Network size={14} />,
  },

  // ─── Clavier & Souris ────────────────────────────────────────
  {
    id: "mouse_accel", group: "input", color: "#8b5cf6",
    label: "Désactiver accélération souris",
    desc:  "Supprime la précision du pointeur améliorée pour une visée brute et constante",
    icon: <MousePointer2 size={14} />,
  },
  {
    id: "mouse_raw", group: "input", color: "#8b5cf6", requiresAdmin: true,
    label: "Optimiser buffer souris",
    desc:  "Augmente la file de données souris (mouclass) pour ne perdre aucun input",
    icon: <MousePointer2 size={14} />,
  },
  {
    id: "keyboard_speed", group: "input", color: "#8b5cf6",
    label: "Répétition clavier maximale",
    desc:  "Passe la vitesse de répétition et le délai initial du clavier au maximum",
    icon: <Keyboard size={14} />,
  },
  {
    id: "keyboard_buffer", group: "input", color: "#8b5cf6", requiresAdmin: true,
    label: "Optimiser buffer clavier",
    desc:  "Augmente la file de données clavier (kbdclass) pour une réponse plus rapide",
    icon: <Keyboard size={14} />,
  },

  // ─── GPU Optimisations ───────────────────────────────────────
  {
    id: "nvidia_low_latency", group: "gpu", color: "#76d275", requiresAdmin: true,
    label: "NVIDIA Low Latency Ultra",
    desc:  "Force 0 frame pré-rendu — réduit la latence GPU de manière significative",
    icon: <Monitor size={14} />,
  },
  {
    id: "nvidia_threaded_opt", group: "gpu", color: "#76d275", requiresAdmin: true,
    label: "NVIDIA Threaded Optimization OFF",
    desc:  "Désactive l'optimisation multithread NVIDIA — recommandé pour les jeux CPU-bound",
    icon: <Cpu size={14} />,
  },
  {
    id: "nvidia_shader_cache", group: "gpu", color: "#76d275", requiresAdmin: true,
    label: "Shader Cache DirectX activé",
    desc:  "Active le cache de shaders DirectX globalement — réduit les micro-stutters au premier chargement",
    icon: <HardDrive size={14} />,
  },
  {
    id: "amd_ulps", group: "gpu", color: "#76d275", requiresAdmin: true,
    label: "Désactiver AMD ULPS",
    desc:  "Désactive l'Ultra Low Power State AMD — évite les baisses de fréquence GPU imprévues",
    icon: <Zap size={14} />,
  },
  {
    id: "amd_anti_lag", group: "gpu", color: "#76d275", requiresAdmin: true,
    label: "AMD High Performance Mode",
    desc:  "Force le GPU AMD en haute performance — désactive les états d'économie d'énergie en jeu",
    icon: <Gauge size={14} />,
  },

  // ─── Services Windows ─────────────────────────────────────────
  {
    id: "visual", group: "services", color: "#059669",
    label: "Désactiver les animations Windows",
    desc:  "Supprime tous les effets visuels et transitions pour libérer CPU et GPU",
    icon: <Monitor size={14} />,
  },
  {
    id: "sysmain", group: "services", color: "#059669", requiresAdmin: true,
    label: "Désactiver SysMain (Superfetch)",
    desc:  "Arrête le service qui précharge les apps en RAM — utile sur SSD",
    icon: <Activity size={14} />,
  },
  {
    id: "wsearch", group: "services", color: "#059669", requiresAdmin: true,
    label: "Désactiver Windows Search",
    desc:  "Arrête l'indexation disque permanente qui charge le CPU/disque en arrière-plan",
    icon: <HardDrive size={14} />,
  },
  {
    id: "xbox_services", group: "services", color: "#059669", requiresAdmin: true,
    label: "Désactiver services Xbox",
    desc:  "Arrête XblGameSave, XboxNetApiSvc, XboxGipSvc et XblAuthManager inutiles",
    icon: <Gamepad2 size={14} />,
  },
  {
    id: "diagtrack", group: "services", color: "#059669", requiresAdmin: true,
    label: "Désactiver Télémétrie Windows",
    desc:  "Arrête DiagTrack et bloque la collecte de données Microsoft en arrière-plan",
    icon: <Shield size={14} />,
  },
  {
    id: "defender_realtime", group: "services", color: "#059669", requiresAdmin: true,
    label: "Suspendre Defender (session jeu)",
    desc:  "Désactive la protection temps réel Windows Defender — à réactiver après la session",
    icon: <Shield size={14} />,
  },
];

export const TWEAK_GROUPS: { id: Tweak["group"]; label: string; color: string }[] = [
  { id: "fps",      label: "FPS Boost",        color: "#f59e0b" },
  { id: "latency",  label: "Latence Système",  color: "#ef4444" },
  { id: "network",  label: "Réseau",           color: "#0891b2" },
  { id: "input",    label: "Clavier & Souris", color: "#8b5cf6" },
  { id: "gpu",      label: "GPU Optimisations", color: "#76d275" },
  { id: "services", label: "Services Windows", color: "#059669" },
];

export const PROFILES = [
  {
    id: "game", label: "Jeu", color: "#f59e0b",
    tweaks: ["power","priority","hags","gamebar","gamemode","nagle","network_throttle","mmcss","mouse_accel","keyboard_speed","network","qos","core_parking","power_throttling","msi_mode","c_states","defender_realtime"],
    desc: "Performances maximales pour le gaming",
  },
  {
    id: "work", label: "Travail", color: "#2563eb",
    tweaks: ["power","priority","network","visual","wsearch"],
    desc: "Priorité aux applications actives",
  },
  {
    id: "eco", label: "Économie", color: "#059669",
    tweaks: [],
    desc: "Désactive toutes les optimisations",
  },
];

export const NAV: { id: Tab; icon: React.ReactNode; label: string }[] = [
  { id: "dashboard",   icon: <LayoutDashboard size={18} />, label: "Dashboard"    },
  { id: "performance", icon: <Zap size={18} />,             label: "Performance"  },
  { id: "network",     icon: <Wifi size={18} />,            label: "Réseau"       },
  { id: "cleanup",     icon: <Trash2 size={18} />,          label: "Nettoyage"    },
  { id: "games",       icon: <Gamepad2 size={18} />,        label: "Jeux"         },
  { id: "system",      icon: <Settings size={18} />,        label: "Système"      },
];

export const TAB_TITLES: Record<Tab, string> = {
  dashboard:   "Dashboard",
  performance: "Performance",
  network:     "Réseau",
  processes:   "Processus",
  cleanup:     "Nettoyage",
  games:       "Jeux & Benchmark",
  system:      "Système",
};

export const STAT_COLORS = {
  cpu:  "#38bdf8",
  ram:  "#818cf8",
  temp: "#fb923c",
  disk: "#fbbf24",
  gpu:  "#c084fc",
  net:  "#34d399",
};

export const APP_FEATURES: {
  icon: React.ReactNode; title: string; desc: string; color: string; tab: Tab;
}[] = [
  { icon: <BarChart2 size={15} />, title: "Monitoring",    desc: "Stats temps réel",       color: STAT_COLORS.cpu,  tab: "dashboard"   },
  { icon: <Zap size={15} />,       title: "FPS Boost",     desc: "Tweaks & processus",     color: "#f59e0b",        tab: "performance" },
  { icon: <Wifi size={15} />,      title: "Réseau",        desc: "Débit & latence",        color: STAT_COLORS.net,  tab: "network"     },
  { icon: <Trash2 size={15} />,    title: "Nettoyage",     desc: "Libérez de l'espace",    color: "#ef4444",        tab: "cleanup"     },
  { icon: <Gamepad2 size={15} />,  title: "Jeux",          desc: "Steam, Epic, Benchmark", color: STAT_COLORS.gpu,  tab: "games"       },
  { icon: <Power size={15} />,     title: "Système",       desc: "Démarrage & réglages",   color: STAT_COLORS.disk, tab: "system"      },
  { icon: <Layers size={15} />,    title: "Processus",     desc: "Gérez les processus",    color: STAT_COLORS.ram,  tab: "processes"   },
  { icon: <Shield size={15} />,    title: "Services",      desc: "Désactiver l'inutile",   color: "#0891b2",        tab: "performance" },
];
