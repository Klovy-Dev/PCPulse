import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Eye, EyeOff, Zap, AlertCircle, ArrowLeft, Activity, Shield, Monitor } from "lucide-react";
import { loginUser, initDatabase } from "../lib/db";
import type { UserData } from "../App";
import TitleBar from "../components/TitleBar";
import nexboostLogo from "../assets/nexboost-logo.svg";

interface Props { onLogin: (user: UserData) => void; }

const FEATURES = [
  { icon: <Activity size={14} />, title: "Monitoring temps réel",  desc: "CPU, RAM, temp à la seconde",     color: "#38bdf8" },
  { icon: <Zap size={14} />,      title: "Boost instantané",        desc: "6 optimisations en 1 clic",       color: "#818cf8" },
  { icon: <Shield size={14} />,   title: "Données sécurisées",      desc: "Tout reste local sur votre PC",   color: "#4ade80" },
  { icon: <Monitor size={14} />,  title: "Interface claire",         desc: "Design épuré, lisible par tous", color: "#f97316" },
];

export default function Login({ onLogin }: Props) {
  const navigate = useNavigate();
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");

  useEffect(() => { initDatabase().catch(console.error); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) { setError("Veuillez remplir tous les champs."); return; }
    setLoading(true); setError("");
    try {
      const user = await loginUser(email, password);
      if (!user) { setError("Email ou mot de passe incorrect."); return; }
      onLogin(user); navigate("/dashboard");
    } catch {
      setError("Erreur de connexion. Vérifiez votre configuration.");
    } finally { setLoading(false); }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, display: "flex", flexDirection: "column",
      background: "#07070d",
      backgroundImage: "radial-gradient(ellipse at 20% 50%, rgba(56,189,248,0.04) 0%, transparent 50%), radial-gradient(ellipse at 80% 30%, rgba(129,140,248,0.04) 0%, transparent 50%)",
    }}>
      <TitleBar />
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* ── Panneau gauche ── */}
        <div style={{
          width: 300, flexShrink: 0,
          background: "rgba(10,10,20,0.9)", borderRight: "1px solid rgba(255,255,255,0.06)",
          padding: "26px 24px", display: "flex", flexDirection: "column", justifyContent: "space-between",
        }}>
          <div>
            {/* Logo */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 26 }}>
              <img src={nexboostLogo} alt="NexBoost" style={{ width: 36, height: 36, borderRadius: 9, flexShrink: 0 }} />
              <div>
                <div style={{ fontFamily: "'Orbitron', monospace", fontWeight: 700, fontSize: 13, color: "#f1f5f9", letterSpacing: "0.12em" }}>NEXBOOST</div>
                <div style={{ fontSize: 10, color: "#4b5563" }}>Gaming Optimizer</div>
              </div>
            </div>

            <h2 style={{ fontSize: 20, fontWeight: 800, color: "#f1f5f9", lineHeight: 1.25, margin: "0 0 8px" }}>
              Optimisez.<br /><span style={{ color: "#38bdf8" }}>Performez.</span>
            </h2>
            <p style={{ fontSize: 11, color: "#4b5563", lineHeight: 1.6, margin: "0 0 22px" }}>
              Connectez-vous pour accéder à votre tableau de bord et booster les performances.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {FEATURES.map(f => (
                <div key={f.title} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{
                    width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                    background: `${f.color}14`, color: f.color,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>{f.icon}</div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#f1f5f9" }}>{f.title}</div>
                    <div style={{ fontSize: 10, color: "#4b5563", marginTop: 1 }}>{f.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Avis */}
          <div style={{
            padding: "14px 16px", borderRadius: 10,
            background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
          }}>
            <span style={{
              fontSize: 9, fontWeight: 800, letterSpacing: "0.15em",
              padding: "3px 10px", borderRadius: 5,
              background: "rgba(56,189,248,0.08)", border: "1px solid rgba(56,189,248,0.18)",
              color: "#38bdf8",
            }}>
              SOON
            </span>
            <p style={{ fontSize: 10, color: "#374151", margin: 0, textAlign: "center", lineHeight: 1.5 }}>
              Les avis utilisateurs arrivent bientôt
            </p>
          </div>
        </div>

        {/* ── Formulaire ── */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px 40px", position: "relative" }}>

          {/* Bouton retour */}
          <button
            onClick={() => navigate("/")}
            style={{
              position: "absolute", top: 16, left: 16,
              display: "flex", alignItems: "center", gap: 5,
              padding: "6px 10px", borderRadius: 6, fontSize: 11,
              background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", color: "#4b5563",
              cursor: "pointer", transition: "all 0.15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.color = "#94a3b8"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)"; }}
            onMouseLeave={e => { e.currentTarget.style.color = "#4b5563"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.07)"; }}
          >
            <ArrowLeft size={12} /> Retour
          </button>

          <div style={{ width: "100%", maxWidth: 340 }} className="animate-fadeIn">
            {/* Logo centré */}
            <div style={{ textAlign: "center", marginBottom: 22 }}>
              <img src={nexboostLogo} alt="NexBoost" style={{ width: 44, height: 44, borderRadius: 11, margin: "0 auto 10px", display: "block" }} />
              <div style={{ fontFamily: "'Orbitron', monospace", fontWeight: 700, fontSize: 13, color: "#f1f5f9", letterSpacing: "0.12em" }}>NEXBOOST</div>
              <div style={{ fontSize: 10, color: "#4b5563", marginTop: 2 }}>Gaming Optimizer</div>
            </div>

            {/* Carte formulaire */}
            <div style={{
              background: "#0c0c1a", border: "1px solid rgba(255,255,255,0.07)",
              borderRadius: 14, padding: "22px 24px",
            }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#f1f5f9", marginBottom: 2 }}>Connexion</div>
              <div style={{ fontSize: 11, color: "#4b5563", marginBottom: 18 }}>Accédez à votre espace optimisation</div>

              {error && (
                <div style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "10px 12px",
                  borderRadius: 8, marginBottom: 14,
                  background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)",
                }} className="animate-fadeIn">
                  <AlertCircle size={13} style={{ color: "#f87171", flexShrink: 0 }} />
                  <span style={{ fontSize: 11, color: "#f87171" }}>{error}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 13 }}>
                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#94a3b8", marginBottom: 5 }}>
                    Adresse email
                  </label>
                  <input
                    type="email" className="input-base"
                    style={{ padding: "9px 12px", fontSize: 12 }}
                    placeholder="votre@email.com" value={email}
                    onChange={e => setEmail(e.target.value)} autoComplete="email"
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#94a3b8", marginBottom: 5 }}>
                    Mot de passe
                  </label>
                  <div style={{ position: "relative" }}>
                    <input
                      type={showPass ? "text" : "password"} className="input-base"
                      style={{ padding: "9px 36px 9px 12px", fontSize: 12 }}
                      placeholder="••••••••" value={password}
                      onChange={e => setPassword(e.target.value)} autoComplete="current-password"
                    />
                    <button
                      type="button" onClick={() => setShowPass(!showPass)}
                      style={{
                        position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
                        background: "none", border: "none", color: "#4b5563", cursor: "pointer", padding: 0,
                      }}
                    >
                      {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit" disabled={loading}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                    padding: "10px 20px", borderRadius: 8, fontSize: 13, fontWeight: 700, marginTop: 2,
                    background: "rgba(56,189,248,0.12)", border: "1px solid rgba(56,189,248,0.35)", color: "#38bdf8",
                    cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1, transition: "all 0.15s",
                  }}
                  onMouseEnter={e => { if (!loading) e.currentTarget.style.background = "rgba(56,189,248,0.22)"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "rgba(56,189,248,0.12)"; }}
                >
                  {loading ? (
                    <>
                      <div className="animate-spin" style={{ width: 13, height: 13, borderRadius: "50%", border: "2px solid rgba(56,189,248,0.2)", borderTopColor: "#38bdf8" }} />
                      Connexion...
                    </>
                  ) : (
                    <><Zap size={13} /> Se connecter</>
                  )}
                </button>
              </form>

              <div style={{ marginTop: 16, paddingTop: 14, textAlign: "center", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                <span style={{ fontSize: 11, color: "#4b5563" }}>Pas encore de compte ?{" "}</span>
                <Link to="/register" style={{ fontSize: 11, fontWeight: 600, color: "#38bdf8", textDecoration: "none" }}>
                  Créer un compte
                </Link>
              </div>
            </div>

            <p style={{ textAlign: "center", fontSize: 10, color: "#4b5563", marginTop: 12 }}>
              Vos données restent sur votre PC, rien n'est partagé
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
