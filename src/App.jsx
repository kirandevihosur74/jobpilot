import { useState, useEffect, useCallback, useRef } from "react";
import {
  Search, Send, FileText, RefreshCw, Settings,
  ExternalLink, Star, Clock, Building, MapPin,
  Briefcase, User, Mail, AlertCircle, CheckCircle,
  Loader2, X, Sparkles, Copy,
  Target, Rocket, Globe, MessageSquare, ChevronDown, ClipboardList, Upload,
} from "lucide-react";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";
const STORAGE_KEY = "jobpilot:state";

// ─── CSS vars ───────────────────────────────────────────────────────────────
const C = {
  bg:      "var(--bg)",
  bg2:     "var(--bg-2)",
  bg3:     "var(--bg-3)",
  accent:  "var(--accent)",
  aDim:    "var(--accent-dim)",
  aBorder: "var(--accent-border)",
  gold:    "var(--gold)",
  gDim:    "var(--gold-dim)",
  gBorder: "var(--gold-border)",
  violet:  "var(--violet)",
  vDim:    "var(--violet-dim)",
  vBorder: "var(--violet-border)",
  green:   "var(--green)",
  gnDim:   "var(--green-dim)",
  red:     "var(--red)",
  text:    "var(--text)",
  text2:   "var(--text-2)",
  text3:   "var(--text-3)",
  border:  "var(--border)",
  border2: "var(--border-2)",
};

// ─── API ─────────────────────────────────────────────────────────────────────
async function api(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.detail || `API error: ${res.status}`);
  }
  return res.json();
}

function loadState(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function saveState(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

const defaultPrefs = { role: "", location: "", skills: [], resumeContext: "", targetCompanies: "" };

// ─── Label ───────────────────────────────────────────────────────────────────
function Label({ children, color = C.text2 }) {
  return (
    <span style={{
      fontFamily: "var(--font-display)",
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: "0.12em",
      textTransform: "uppercase",
      color,
    }}>{children}</span>
  );
}

// ─── Score Badge ─────────────────────────────────────────────────────────────
function ScoreBadge({ score }) {
  const s = parseFloat(score) || 0;
  const color = s >= 8 ? C.green : s >= 6 ? C.gold : s >= 4 ? C.accent : C.red;
  return (
    <span style={{
      fontFamily: "var(--font-mono)",
      fontSize: 11,
      fontWeight: 600,
      padding: "2px 7px",
      borderRadius: 3,
      background: color + "18",
      color,
      border: `1px solid ${color}33`,
      letterSpacing: "-0.02em",
      whiteSpace: "nowrap",
    }}>
      {s.toFixed(1)}
    </span>
  );
}

// ─── Status Dot ──────────────────────────────────────────────────────────────
function StatusDot({ status }) {
  const colors = { sent: C.green, draft: C.gold, scheduled: C.violet, failed: C.red };
  return (
    <span style={{
      display: "inline-block",
      width: 6, height: 6,
      borderRadius: "50%",
      background: colors[status] || C.text3,
      flexShrink: 0,
    }} />
  );
}

// ─── Divider Line ────────────────────────────────────────────────────────────
function Divider({ color = C.border }) {
  return <div style={{ height: 1, background: color, width: "100%" }} />;
}

// ─── Card ────────────────────────────────────────────────────────────────────
function Card({ children, active, onClick, accentColor = C.accent, className = "" }) {
  return (
    <div
      onClick={onClick}
      className={className}
      style={{
        padding: "12px 14px",
        borderRadius: 6,
        border: `1px solid ${active ? accentColor + "44" : C.border}`,
        borderLeft: `3px solid ${active ? accentColor : C.border2}`,
        background: active ? accentColor + "08" : C.bg2,
        cursor: "pointer",
        transition: "border-color 0.15s, background 0.15s, border-left-color 0.15s",
        marginBottom: 8,
      }}
      onMouseEnter={e => {
        if (!active) {
          e.currentTarget.style.borderColor = C.border2;
          e.currentTarget.style.borderLeftColor = accentColor + "66";
          e.currentTarget.style.background = C.bg3;
        }
      }}
      onMouseLeave={e => {
        if (!active) {
          e.currentTarget.style.borderColor = C.border;
          e.currentTarget.style.borderLeftColor = C.border2;
          e.currentTarget.style.background = C.bg2;
        }
      }}
    >
      {children}
    </div>
  );
}

// ─── Skeleton ────────────────────────────────────────────────────────────────
function Skeleton({ count = 3 }) {
  return Array.from({ length: count }).map((_, i) => (
    <div key={i} style={{
      borderRadius: 6,
      border: `1px solid ${C.border}`,
      borderLeft: `3px solid ${C.border2}`,
      background: C.bg2,
      padding: "12px 14px",
      marginBottom: 8,
    }}>
      <div style={{ height: 12, width: "65%", background: C.bg3, borderRadius: 3, marginBottom: 8,
        animation: "pulse-accent 1.4s ease-in-out infinite" }} />
      <div style={{ height: 10, width: "40%", background: C.bg3, borderRadius: 3,
        animation: "pulse-accent 1.4s ease-in-out infinite 0.2s" }} />
    </div>
  ));
}

// ─── Btn ─────────────────────────────────────────────────────────────────────
function Btn({ children, onClick, disabled, color = C.accent, outline = false, small = false, full = false }) {
  const base = {
    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
    padding: small ? "6px 12px" : "10px 18px",
    borderRadius: 5,
    fontFamily: "var(--font-display)",
    fontSize: small ? 12 : 13,
    fontWeight: 600,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    border: "none",
    cursor: disabled ? "default" : "pointer",
    transition: "opacity 0.15s, background 0.15s",
    opacity: disabled ? 0.4 : 1,
    width: full ? "100%" : "auto",
  };

  if (outline) {
    return (
      <button onClick={onClick} disabled={disabled} style={{
        ...base,
        background: "transparent",
        border: `1px solid ${disabled ? C.border2 : color + "55"}`,
        color: disabled ? C.text3 : color,
      }}>{children}</button>
    );
  }

  return (
    <button onClick={onClick} disabled={disabled} style={{
      ...base,
      background: disabled ? C.bg3 : color,
      color: disabled ? C.text3 : "#0e0c0b",
    }}>{children}</button>
  );
}

// ─── Input ───────────────────────────────────────────────────────────────────
function Input({ value, onChange, placeholder, type = "text" }) {
  return (
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      style={{
        width: "100%",
        padding: "9px 12px",
        borderRadius: 5,
        border: `1px solid ${C.border2}`,
        background: C.bg,
        color: C.text,
        fontSize: 13,
        fontFamily: "var(--font-body)",
        outline: "none",
      }}
      onFocus={e => e.target.style.borderColor = C.accent + "66"}
      onBlur={e => e.target.style.borderColor = C.border2}
    />
  );
}

// ─── Resume Library (multi-resume with role tags) ───────────────────────────
function ResumeLibrary() {
  const [resumes, setResumes] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [roleTag, setRoleTag] = useState("");
  const [error, setError] = useState(null);
  const fileRef = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const data = await fetch(`${API_BASE}/api/resume/library`).then(r => r.json());
      setResumes(data.resumes || []);
    } catch (e) { setError(e.message); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleFile = async (file) => {
    if (!file) return;
    if (!roleTag.trim()) { setError("Set a role tag first (e.g. SDE, AI Engineer, FDE)"); return; }
    setUploading(true); setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("role_tag", roleTag.trim());
      fd.append("is_default", resumes.length === 0 ? "true" : "false");
      const res = await fetch(`${API_BASE}/api/resume/library/upload`, { method: "POST", body: fd });
      if (!res.ok) throw new Error((await res.json()).detail || "Upload failed");
      setRoleTag("");
      await refresh();
    } catch (e) { setError(e.message); }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this resume?")) return;
    await fetch(`${API_BASE}/api/resume/library/${id}`, { method: "DELETE" });
    refresh();
  };

  const setDefault = async (id) => {
    await fetch(`${API_BASE}/api/resume/library/${id}/default`, { method: "POST" });
    refresh();
  };

  return (
    <div style={{ marginTop: 5 }}>
      <input
        ref={fileRef}
        type="file"
        accept=".pdf,.docx,.doc,.txt"
        style={{ display: "none" }}
        onChange={e => handleFile(e.target.files[0])}
      />

      {/* Upload row */}
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        <input
          type="text"
          value={roleTag}
          onChange={e => setRoleTag(e.target.value)}
          placeholder="Role tag (e.g. SDE, AI Engineer, FDE)"
          style={{
            flex: 1, padding: "8px 10px", borderRadius: 5, fontSize: 12,
            background: C.bg, border: `1px solid ${C.border2}`, color: C.text,
            fontFamily: "var(--font-mono)", outline: "none",
          }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading || !roleTag.trim()}
          style={{
            padding: "8px 14px", borderRadius: 5, fontSize: 12, cursor: roleTag.trim() ? "pointer" : "not-allowed",
            background: C.aDim, border: `1px solid ${C.accent}`, color: C.accent,
            display: "flex", alignItems: "center", gap: 5, fontWeight: 600,
            opacity: roleTag.trim() ? 1 : 0.5,
          }}
        >
          {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
          {uploading ? "Uploading..." : "Add Resume"}
        </button>
      </div>

      {/* List of uploaded resumes */}
      {resumes.length === 0 ? (
        <div style={{
          padding: 14, borderRadius: 5, border: `1px dashed ${C.border2}`,
          textAlign: "center", color: C.text3, fontSize: 12,
        }}>
          No resumes yet. Tag with a role (SDE, AI Engineer, FDE) and upload — JobPilot picks the best one per job.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {resumes.map(r => (
            <div key={r.id} style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "8px 12px", borderRadius: 5,
              background: r.is_default ? C.gnDim : C.bg2,
              border: `1px solid ${r.is_default ? C.green : C.border}`,
            }}>
              <FileText size={13} color={r.is_default ? C.green : C.text2} />
              <span style={{
                fontSize: 11, padding: "2px 7px", borderRadius: 4,
                background: C.bg, color: C.gold, fontFamily: "var(--font-mono)",
                border: `1px solid ${C.gBorder}`,
              }}>
                {r.role_tag || "untagged"}
              </span>
              <span style={{ flex: 1, fontSize: 12, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.filename}
              </span>
              {r.is_template && (
                <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 3, background: C.vDim, color: C.violet }}>
                  TEMPLATE
                </span>
              )}
              {r.is_default ? (
                <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 3, background: C.gnDim, color: C.green }}>
                  DEFAULT
                </span>
              ) : (
                <button onClick={() => setDefault(r.id)} style={{
                  fontSize: 10, padding: "2px 6px", borderRadius: 3, cursor: "pointer",
                  background: "transparent", border: `1px solid ${C.border}`, color: C.text2,
                }}>Set default</button>
              )}
              <button onClick={() => handleDelete(r.id)} style={{
                fontSize: 10, padding: "2px 6px", borderRadius: 3, cursor: "pointer",
                background: "transparent", border: `1px solid ${C.red}`, color: C.red,
              }}>Delete</button>
            </div>
          ))}
        </div>
      )}
      {error && <div style={{ fontSize: 11, color: C.red, marginTop: 6 }}>{error}</div>}
    </div>
  );
}

// ─── Preferences Modal ───────────────────────────────────────────────────────
function PreferencesModal({ prefs, onSave, onClose, canClose }) {
  const [form, setForm] = useState({ ...prefs, skills: prefs.skills?.join(", ") || "" });
  const update = (key, val) => setForm(p => ({ ...p, [key]: val }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center grid-bg"
      style={{ background: "#0e0c0bdd", backdropFilter: "blur(12px)" }}>
      <div className="slide-in w-full max-w-md" style={{
        background: C.bg2,
        border: `1px solid ${C.border2}`,
        borderTop: `3px solid ${C.accent}`,
        borderRadius: 8,
        padding: 32,
        position: "relative",
      }}>
        {canClose && (
          <button onClick={onClose} style={{
            position: "absolute", top: 16, right: 16,
            background: "none", border: "none", color: C.text2,
            cursor: "pointer", display: "flex",
          }}>
            <X size={16} />
          </button>
        )}

        {/* Header */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <div style={{
              width: 8, height: 8, borderRadius: "50%", background: C.accent,
              animation: "pulse-accent 2s ease-in-out infinite",
            }} />
            <span style={{
              fontFamily: "var(--font-display)",
              fontSize: 22,
              fontWeight: 700,
              color: C.text,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}>Mission Config</span>
          </div>
          <p style={{ fontSize: 12, color: C.text2, marginLeft: 18 }}>Define your search parameters</p>
        </div>

        {[
          { key: "role", label: "Target role", ph: "Senior Frontend Engineer" },
          { key: "location", label: "Location", ph: "San Francisco, Remote" },
          { key: "skills", label: "Skills (comma-separated)", ph: "React, TypeScript, Python" },
          { key: "targetCompanies", label: "Target companies (optional)", ph: "Stripe, Vercel, Anthropic" },
        ].map(f => (
          <div key={f.key} style={{ marginBottom: 14 }}>
            <Label>{f.label}</Label>
            <div style={{ marginTop: 5 }}>
              <Input value={form[f.key]} onChange={e => update(f.key, e.target.value)} placeholder={f.ph} />
            </div>
          </div>
        ))}

        {/* Multi-resume library */}
        <div style={{ marginBottom: 14 }}>
          <Label>Resume library — tag each by role; auto-apply picks the best match per job</Label>
          <ResumeLibrary />
        </div>

        <div style={{ marginBottom: 22 }}>
          <Label>Resume context / bio</Label>
          <textarea
            value={form.resumeContext}
            onChange={e => update("resumeContext", e.target.value)}
            placeholder="Paste key resume highlights, experience summary..."
            rows={3}
            style={{
              marginTop: 5, width: "100%",
              padding: "9px 12px",
              borderRadius: 5,
              border: `1px solid ${C.border2}`,
              background: C.bg,
              color: C.text,
              fontSize: 13,
              fontFamily: "var(--font-body)",
              outline: "none",
              resize: "vertical",
            }}
            onFocus={e => e.target.style.borderColor = C.accent + "66"}
            onBlur={e => e.target.style.borderColor = C.border2}
          />
        </div>

        <Btn full onClick={() => {
          if (!form.role.trim()) return;
          onSave({ ...form, skills: form.skills.split(",").map(s => s.trim()).filter(Boolean) });
        }} disabled={!form.role.trim()}>
          <Rocket size={14} /> Launch agent
        </Btn>
      </div>
    </div>
  );
}

// ─── Job Card ─────────────────────────────────────────────────────────────────
function JobCard({ job, active, onClick }) {
  return (
    <Card active={active} onClick={onClick} accentColor={C.accent} className="fade-up">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
        <span style={{
          fontSize: 13,
          fontWeight: 500,
          color: C.text,
          lineHeight: 1.35,
          flex: 1,
          marginRight: 8,
        }}>{job.title}</span>
        <ScoreBadge score={job.score} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 5, color: C.text2, fontSize: 11 }}>
        <Building size={10} />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{job.company}</span>
        {job.location && (
          <>
            <span style={{ color: C.text3 }}>·</span>
            <MapPin size={10} />
            <span>{job.location}</span>
          </>
        )}
      </div>
      {job.type && (
        <span style={{
          display: "inline-block",
          marginTop: 6,
          fontSize: 10,
          padding: "2px 7px",
          borderRadius: 3,
          background: C.bg3,
          color: C.text2,
          fontFamily: "var(--font-mono)",
        }}>{job.type}</span>
      )}
    </Card>
  );
}


// ─── History Item ─────────────────────────────────────────────────────────────
function HistoryItem({ item }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "9px 0",
      borderBottom: `1px solid ${C.border}`,
    }}>
      <StatusDot status={item.status} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {item.company} — {item.role}
        </div>
        <div style={{ fontSize: 11, color: C.text2, fontFamily: "var(--font-mono)" }}>
          {item.status} · {item.date}
        </div>
      </div>
    </div>
  );
}

// ─── Section Header ───────────────────────────────────────────────────────────
function SectionHeader({ icon, label, color, right }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span style={{ color }}>{icon}</span>
        <Label color={color}>{label}</Label>
      </div>
      {right}
    </div>
  );
}

// ─── Resume Preview Modal ─────────────────────────────────────────────────────
function ResumePreviewModal({ tailored, job, prefs, onClose }) {
  const fullText = [
    prefs?.resumeContext ? `${prefs.resumeContext}\n` : "",
    "SUMMARY\n" + (tailored.summary || ""),
    "\nSKILLS\n" + (tailored.skills || []).join(" · "),
    ...Object.entries(tailored.experience_bullets || {}).map(
      ([role, bullets]) => `\n${role}\n` + bullets.map(b => `• ${b}`).join("\n")
    ),
  ].join("\n").trim();

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 60,
      background: "#000000cc", backdropFilter: "blur(10px)",
      display: "flex", alignItems: "flex-start", justifyContent: "center",
      padding: "32px 16px", overflowY: "auto",
    }}>
      <div style={{
        width: "100%", maxWidth: 720,
        background: "#fff",
        borderRadius: 6,
        overflow: "hidden",
        boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
      }}>
        {/* Modal toolbar */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 18px",
          background: C.bg2,
          borderBottom: `1px solid ${C.border}`,
        }}>
          <Label color={C.violet}>Tailored Resume Preview</Label>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => navigator.clipboard?.writeText(fullText)}
              style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "5px 10px", borderRadius: 4,
                border: `1px solid ${C.border2}`,
                background: "transparent", color: C.text2,
                fontSize: 11, fontFamily: "var(--font-display)",
                fontWeight: 600, letterSpacing: "0.06em",
                textTransform: "uppercase", cursor: "pointer",
              }}>
              <Copy size={11} /> Copy text
            </button>
            <button onClick={onClose} style={{
              background: "none", border: "none", color: C.text2,
              cursor: "pointer", display: "flex", padding: 4,
            }}>
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Resume document */}
        <div style={{
          background: "#fff",
          color: "#1a1a1a",
          padding: "48px 56px",
          fontFamily: "'Barlow', Georgia, serif",
          fontSize: 13,
          lineHeight: 1.6,
          minHeight: 500,
        }}>
          {/* Header */}
          <div style={{ marginBottom: 28, borderBottom: "2px solid #1a1a1a", paddingBottom: 16 }}>
            <h1 style={{
              fontSize: 26, fontWeight: 700, margin: 0,
              fontFamily: "'Barlow Condensed', sans-serif",
              letterSpacing: "0.04em", textTransform: "uppercase",
              color: "#1a1a1a",
            }}>{prefs?.role || "Software Engineer"}</h1>
            {job && (
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "#555" }}>
                Tailored for: <strong>{job.title}</strong> @ {job.company}
                {job.location ? ` · ${job.location}` : ""}
              </p>
            )}
          </div>

          {/* Summary */}
          {tailored.summary && (
            <div style={{ marginBottom: 24 }}>
              <h2 style={{
                fontSize: 11, fontWeight: 700, margin: "0 0 8px",
                letterSpacing: "0.12em", textTransform: "uppercase",
                color: "#ff5500", fontFamily: "'Barlow Condensed', sans-serif",
              }}>Summary</h2>
              <p style={{ margin: 0, fontSize: 13, color: "#222", lineHeight: 1.65 }}>
                {tailored.summary}
              </p>
            </div>
          )}

          {/* Skills */}
          {tailored.skills?.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <h2 style={{
                fontSize: 11, fontWeight: 700, margin: "0 0 8px",
                letterSpacing: "0.12em", textTransform: "uppercase",
                color: "#ff5500", fontFamily: "'Barlow Condensed', sans-serif",
              }}>Skills</h2>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px" }}>
                {tailored.skills.map((s, i) => (
                  <span key={i} style={{ fontSize: 12, color: "#333" }}>
                    {i > 0 && <span style={{ color: "#bbb", marginRight: 12 }}>·</span>}{s}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Experience */}
          {Object.entries(tailored.experience_bullets || {}).length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <h2 style={{
                fontSize: 11, fontWeight: 700, margin: "0 0 14px",
                letterSpacing: "0.12em", textTransform: "uppercase",
                color: "#ff5500", fontFamily: "'Barlow Condensed', sans-serif",
              }}>Experience</h2>
              {Object.entries(tailored.experience_bullets).map(([role, bullets]) => (
                <div key={role} style={{ marginBottom: 18 }}>
                  <div style={{
                    fontSize: 13, fontWeight: 600, color: "#111",
                    fontFamily: "'Barlow Condensed', sans-serif",
                    letterSpacing: "0.02em", marginBottom: 6,
                    borderLeft: "3px solid #ff5500",
                    paddingLeft: 10,
                  }}>{role}</div>
                  <ul style={{ margin: 0, paddingLeft: 22 }}>
                    {bullets.map((b, i) => (
                      <li key={i} style={{ fontSize: 12.5, color: "#333", lineHeight: 1.65, marginBottom: 3 }}>
                        {b}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {/* Keywords badge row */}
          {tailored.keywords_added?.length > 0 && (
            <div style={{
              marginTop: 24, paddingTop: 16,
              borderTop: "1px solid #eee",
            }}>
              <p style={{ fontSize: 10, color: "#999", margin: "0 0 6px", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                ATS keywords injected
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {tailored.keywords_added.map((k, i) => (
                  <span key={i} style={{
                    fontSize: 10, padding: "2px 7px", borderRadius: 3,
                    background: "#f0fff4", color: "#166534",
                    border: "1px solid #bbf7d0",
                  }}>{k}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MAIN APP
// ═══════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [prefs, setPrefs]                   = useState(null);
  const [showPrefs, setShowPrefs]           = useState(false);
  const [jobs, setJobs]                     = useState([]);
  const [hiringPosts, setHiringPosts]       = useState([]);
  const [loadingPosts, setLoadingPosts]     = useState(false);
  const [postsTimeFilter, setPostsTimeFilter] = useState("all");
  const [startupJobs, setStartupJobs]       = useState([]);
  const [loadingStartup, setLoadingStartup] = useState(false);
  const [startupRoles, setStartupRoles]     = useState([
    "Forward Deployed Engineer", "Forward Deployed AI Engineer",
    "AI Engineer", "AI Automation Engineer",
    "AI Deployment Strategist", "AI Operations", "Solutions Engineer",
  ]);
  const [startupPlatforms, setStartupPlatforms] = useState(["ashby", "greenhouse"]);
  const [emailCache, setEmailCache]             = useState({});   // "author|company" -> {email,score,loading}

  const [selected, setSelected]             = useState(null);
  const [draft, setDraft]                   = useState(null);
  const [history, setHistory]               = useState([]);
  const [loadingJobs, setLoadingJobs]       = useState(false);
  const [loadingDraft, setLoadingDraft]     = useState(false);
  const [sendingEmail, setSendingEmail]     = useState(false);
  const [error, setError]                   = useState(null);
  const [activePanel, setActivePanel]       = useState("jobs");
  const [lastRefresh, setLastRefresh]       = useState(null);
  const [emailTo, setEmailTo]               = useState("");
  const [tprSeconds, setTprSeconds]         = useState(3600);
  const [autofillFields, setAutofillFields] = useState(null);
  const [loadingAutofill, setLoadingAutofill] = useState(false);
  const [resumeFile, setResumeFile]         = useState(null);
  const [tailoredResume, setTailoredResume] = useState(null);
  const [loadingTailor, setLoadingTailor]   = useState(false);
  const [applySession, setApplySession]     = useState(null);
  const [applyStatus, setApplyStatus]       = useState(null);
  const [showResumePreview, setShowResumePreview] = useState(false);
  const applyPollRef = useRef(null);
  const draftRef = useRef(null);

  useEffect(() => {
    api("/api/prefs").then(p => {
      if (p?.role) {
        setPrefs(p);
        fetchHistory();
        // restore all three data sets from DB in parallel
        Promise.all([
          api(`/api/jobs/cached?role=${encodeURIComponent(p.role)}`).catch(() => null),
          api(`/api/jobs/hiring-posts/cached?role=${encodeURIComponent(p.role)}`).catch(() => null),
          api("/api/jobs/startup-roles/cached").catch(() => null),
        ]).then(([jobs, posts, startups]) => {
          if (jobs?.jobs?.length)    { setJobs(jobs.jobs); setLastRefresh(jobs.jobs[0]?.scraped_at || null); }
          if (posts?.posts?.length)   setHiringPosts(posts.posts);
          if (startups?.jobs?.length) setStartupJobs(startups.jobs);
        });
      } else {
        setShowPrefs(true);
      }
    }).catch(() => setShowPrefs(true));
  }, []);

  const fetchHistory = async () => {
    try { setHistory(await api("/api/history/")); } catch {}
  };


  const searchJobs = useCallback(async () => {
    if (!prefs?.role) return;
    setLoadingJobs(true); setError(null);
    try {
      const data = await api("/api/jobs/search", {
        role: prefs.role, location: prefs.location,
        skills: prefs.skills, target_companies: prefs.targetCompanies,
        limit: 10, tpr_seconds: tprSeconds,
      });
      setJobs(data.jobs || []);
      setLastRefresh(new Date().toISOString());
    } catch (e) { setError("Job search failed: " + e.message); }
    setLoadingJobs(false);
  }, [prefs, tprSeconds]);


  const generateOutreach = useCallback(async (item) => {
    setLoadingDraft(true); setDraft(null);
    try {
      const data = await api("/api/outreach/draft", { item, prefs });
      if (data?.body) {
        setDraft(data);
        setTimeout(() => draftRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
      }
    } catch (e) { setError("Draft failed: " + e.message); }
    setLoadingDraft(false);
  }, [prefs]);

  const generateAutofill = useCallback(async (job) => {
    setLoadingAutofill(true); setAutofillFields(null);
    try {
      const data = await api("/api/autofill/generate", { job, prefs });
      setAutofillFields(data.fields || {});
    } catch (e) { setError("Autofill failed: " + e.message); }
    setLoadingAutofill(false);
  }, [prefs]);

  const tailorResume = useCallback(async (job) => {
    if (!resumeFile || !job) return;
    setLoadingTailor(true); setTailoredResume(null);
    try {
      const form = new FormData();
      form.append("file", resumeFile);
      form.append("job", JSON.stringify(job));
      form.append("prefs", JSON.stringify(prefs));
      const res = await fetch(`${API_BASE}/api/resume/tailor`, { method: "POST", body: form });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e?.detail || `API error: ${res.status}`); }
      const data = await res.json();
      setTailoredResume(data.tailored);
    } catch (e) { setError("Resume tailor failed: " + e.message); }
    setLoadingTailor(false);
  }, [resumeFile, prefs]);

  const startApply = useCallback(async (job) => {
    if (!job?.url) return;
    setError(null);
    try {
      const data = await api("/api/apply/start", { job_url: job.url, job, prefs });
      setApplySession(data.session_id);
      setApplyStatus({ status: "starting", message: "Starting browser…", screenshot: null });
      // poll status
      applyPollRef.current = setInterval(async () => {
        try {
          const r = await fetch(`${API_BASE}/api/apply/status/${data.session_id}`);
          if (r.status === 404) {
            // Backend restarted / session expired — clear stale state
            clearInterval(applyPollRef.current);
            setApplySession(null);
            setApplyStatus(null);
            return;
          }
          const s = await r.json();
          setApplyStatus(s);
          if (["submitted", "failed", "aborted"].includes(s.status)) {
            clearInterval(applyPollRef.current);
          }
        } catch {}
      }, 2000);
    } catch (e) { setError("Auto-apply failed: " + e.message); }
  }, [prefs]);

  const confirmApply = useCallback(async () => {
    if (!applySession) return;
    try { await api("/api/apply/confirm", { session_id: applySession }); }
    catch (e) { setError("Confirm failed: " + e.message); }
  }, [applySession]);

  const abortApply = useCallback(async () => {
    if (!applySession) return;
    clearInterval(applyPollRef.current);
    try { await api("/api/apply/abort", { session_id: applySession }); }
    catch {}
    setApplySession(null);
    setApplyStatus(null);
  }, [applySession]);

  const sendEmail = useCallback(async () => {
    if (!draft || !emailTo) return;
    setSendingEmail(true);
    try {
      await api("/api/email/send", { to: emailTo, subject: draft.subject, body: draft.body });
      await api("/api/history/", {
        company: selected.company,
        role: selected.title || selected.role || prefs.role,
        status: "sent", recipient: emailTo,
        subject: draft.subject, body: draft.body,
      });
      await fetchHistory();
      setDraft(null); setEmailTo(""); setSelected(null);
    } catch (e) { setError("Send failed: " + e.message); }
    setSendingEmail(false);
  }, [draft, emailTo, selected, prefs]);

  const searchHiringPosts = useCallback(async () => {
    if (!prefs?.role) return;
    setLoadingPosts(true); setError(null);
    try {
      const data = await api("/api/jobs/hiring-posts", { role: prefs.role, location: prefs.location, max_results: 20 });
      setHiringPosts(data.posts || []);
    } catch (e) { setError("Hiring posts failed: " + e.message); }
    setLoadingPosts(false);
  }, [prefs]);

  const findEmail = useCallback(async (author, company) => {
    const key = `${author}|${company}`;
    if (emailCache[key]?.email || emailCache[key]?.loading) return;
    setEmailCache(prev => ({ ...prev, [key]: { loading: true } }));
    try {
      const params = new URLSearchParams({ name: author, company });
      const data = await fetch(`${API_BASE}/api/outreach/find-email?${params}`).then(r => r.json());
      setEmailCache(prev => ({ ...prev, [key]: { email: data.email, score: data.score, loading: false } }));
    } catch {
      setEmailCache(prev => ({ ...prev, [key]: { email: null, loading: false } }));
    }
  }, [emailCache]);

  const searchStartupRoles = useCallback(async (roles = startupRoles, platforms = startupPlatforms) => {
    setLoadingStartup(true); setError(null);
    try {
      const data = await api("/api/jobs/startup-roles", { roles, platforms, max_results: 50 });
      setStartupJobs(data.jobs || []);
    } catch (e) { setError("Startup search failed: " + e.message); }
    setLoadingStartup(false);
  }, [startupRoles, startupPlatforms]);

  const runAll = useCallback(() => {
    searchJobs();
  }, [searchJobs]);

  const handleSavePrefs = (newPrefs) => {
    setPrefs(newPrefs);
    api("/api/prefs", newPrefs).catch(() => {});
    setShowPrefs(false);
    setTimeout(runAll, 300);
  };

  const selectItem = (item) => {
    setSelected(item);
    setDraft(null);
    setAutofillFields(null);
    setActivePanel("action");
  };

  const totalSent = history.filter(h => h.status === "sent").length;
  const isLoading = loadingJobs || loadingPosts;

  const tabs = [
    { key: "jobs",     label: "Radar",    icon: <Briefcase size={12} />,     color: C.accent,  count: jobs.length },
    { key: "posts",    label: "Hiring",   icon: <MessageSquare size={12} />, color: C.gold,    count: hiringPosts.length },
    { key: "startups", label: "Startups", icon: <Rocket size={12} />,        color: C.green,   count: startupJobs.length || null },
    { key: "action",   label: "Outreach", icon: <Send size={12} />,          color: "#f472b6", count: null },
    { key: "resume",   label: "Resume",   icon: <FileText size={12} />,      color: C.violet,  count: null },
  ];

  return (
    <div className="noise" style={{ minHeight: "100vh", background: C.bg }}>
      {(showPrefs || !prefs?.role) && (
        <PreferencesModal
          prefs={prefs || defaultPrefs}
          onSave={handleSavePrefs}
          onClose={() => prefs?.role && setShowPrefs(false)}
          canClose={!!prefs?.role}
        />
      )}

      {showResumePreview && tailoredResume && (
        <ResumePreviewModal
          tailored={tailoredResume}
          job={selected}
          prefs={prefs}
          onClose={() => setShowResumePreview(false)}
        />
      )}

      {/* ── HEADER ─────────────────────────────────────────────────────────── */}
      <header style={{
        position: "sticky", top: 0, zIndex: 40,
        background: C.bg + "ee",
        backdropFilter: "blur(14px)",
        borderBottom: `1px solid ${C.border}`,
        display: "flex", alignItems: "center", gap: 12,
        padding: "10px 20px",
      }}>
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginRight: "auto" }}>
          <div style={{
            width: 28, height: 28, borderRadius: 5,
            background: C.accent,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Rocket size={14} color="#0e0c0b" />
          </div>
          <div>
            <span style={{
              fontFamily: "var(--font-display)",
              fontSize: 18,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: C.text,
            }}>JobPilot</span>
            <span style={{
              marginLeft: 8,
              fontFamily: "var(--font-mono)",
              fontSize: 9,
              padding: "2px 6px",
              borderRadius: 3,
              background: C.aDim,
              color: C.accent,
              border: `1px solid ${C.aBorder}`,
              letterSpacing: "0.08em",
            }}>AI AGENT</span>
          </div>
        </div>

        {/* Role pill */}
        {prefs?.role && (
          <span style={{
            display: "none",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: C.text2,
            maxWidth: 180,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
            className="md:inline-block">
            {prefs.role}{prefs.location ? ` / ${prefs.location}` : ""}
          </span>
        )}

        {/* Config */}
        <button onClick={() => setShowPrefs(true)} style={{
          display: "flex", alignItems: "center", gap: 5,
          padding: "6px 10px",
          borderRadius: 5,
          border: `1px solid ${C.border2}`,
          background: "transparent",
          color: C.text2,
          fontSize: 11,
          fontFamily: "var(--font-display)",
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          cursor: "pointer",
          transition: "border-color 0.15s, color 0.15s",
        }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = C.accent + "55"; e.currentTarget.style.color = C.text; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.color = C.text2; }}>
          <Settings size={12} />
          <span className="hidden sm:inline">Config</span>
        </button>

        {/* Scan */}
        <button onClick={runAll} disabled={isLoading} style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "7px 14px",
          borderRadius: 5,
          border: "none",
          background: isLoading ? C.bg3 : C.accent,
          color: isLoading ? C.text3 : "#0e0c0b",
          fontSize: 12,
          fontFamily: "var(--font-display)",
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          cursor: isLoading ? "default" : "pointer",
          transition: "background 0.15s",
        }}>
          {isLoading
            ? <><Loader2 size={13} className="animate-spin" /> Scanning</>
            : <><RefreshCw size={13} /> Scan</>}
        </button>
      </header>

      {/* ── STATS BAR ──────────────────────────────────────────────────────── */}
      <div style={{
        display: "flex",
        gap: 20,
        padding: "7px 20px",
        borderBottom: `1px solid ${C.border}`,
        background: C.bg,
        overflowX: "auto",
      }}>
        {[
          { icon: <Briefcase size={11} />, val: jobs.length,   label: "jobs",    color: C.accent },
          { icon: <Send size={11} />,      val: totalSent,      label: "sent",    color: C.green },
          lastRefresh && { icon: <Clock size={11} />, val: new Date(lastRefresh).toLocaleTimeString(), label: "", color: C.text2 },
        ].filter(Boolean).map((s, i) => (
          <span key={i} style={{
            display: "flex", alignItems: "center", gap: 5,
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            color: C.text2,
            whiteSpace: "nowrap",
          }}>
            <span style={{ color: s.color }}>{s.icon}</span>
            <span style={{ color: C.text, fontWeight: 600 }}>{s.val}</span>
            {s.label && <span>{s.label}</span>}
          </span>
        ))}
      </div>

      {/* ── ERROR ──────────────────────────────────────────────────────────── */}
      {error && (
        <div style={{
          margin: "12px 20px",
          padding: "10px 14px",
          borderRadius: 6,
          background: C.red + "18",
          border: `1px solid ${C.red}33`,
          color: "#fca5a5",
          fontSize: 12,
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <AlertCircle size={14} style={{ flexShrink: 0 }} />
          <span style={{ flex: 1 }}>{error}</span>
          <button onClick={() => setError(null)} style={{ background: "none", border: "none", color: "#fca5a5", cursor: "pointer" }}>
            <X size={13} />
          </button>
        </div>
      )}

      {/* ── TABS ───────────────────────────────────────────────────────────── */}
      <div style={{
        display: "flex",
        borderBottom: `1px solid ${C.border}`,
        background: C.bg,
        padding: "0 20px",
      }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setActivePanel(t.key)} style={{
            display: "flex", alignItems: "center", gap: 5,
            padding: "10px 14px",
            background: "none",
            border: "none",
            borderBottom: activePanel === t.key ? `2px solid ${t.color}` : "2px solid transparent",
            marginBottom: -1,
            color: activePanel === t.key ? t.color : C.text2,
            fontFamily: "var(--font-display)",
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            cursor: "pointer",
            transition: "color 0.15s, border-color 0.15s",
            whiteSpace: "nowrap",
          }}>
            {t.icon}
            <span className="hidden sm:inline">{t.label}</span>
            {t.count !== null && t.count > 0 && (
              <span style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                padding: "1px 5px",
                borderRadius: 3,
                background: t.color + "22",
                color: t.color,
              }}>{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── HIRING POSTS (full-width panel, outside grid) ─────────────────── */}
      {activePanel === "posts" && (
        <div style={{ padding: 20, overflowY: "auto", maxHeight: "calc(100vh - 148px)" }}>
          <SectionHeader
            icon={<MessageSquare size={13} />}
            label="Hiring Posts"
            color={C.gold}
            right={
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <select
                  value={postsTimeFilter}
                  onChange={e => setPostsTimeFilter(e.target.value)}
                  style={{
                    fontSize: 11, padding: "2px 6px", borderRadius: 4,
                    background: C.gDim, border: `1px solid ${C.gBorder}`,
                    color: C.text2, cursor: "pointer",
                  }}
                >
                  <option value="all">All time</option>
                  <option value="24h">Last 24h</option>
                  <option value="3d">Last 3 days</option>
                  <option value="week">Last week</option>
                  <option value="month">Last month</option>
                </select>
                <button onClick={searchHiringPosts} disabled={loadingPosts} style={{
                  background: "none", border: "none", color: C.text2, cursor: "pointer", padding: 3, display: "flex",
                }}>
                  {loadingPosts ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                </button>
              </div>
            }
          />
          {(() => {
            const cutoffMs = { "24h": 864e5, "3d": 259.2e6, "week": 6048e5, "month": 2592e6 };
            const now = Date.now();
            const filtered = postsTimeFilter === "all"
              ? hiringPosts
              : hiringPosts.filter(p => {
                  if (!p.posted_ts) return true; // no ts → always show
                  const ts = p.posted_ts > 1e10 ? p.posted_ts : p.posted_ts * 1000; // handle s vs ms
                  return now - ts <= cutoffMs[postsTimeFilter];
                });
            return (
              <div className="grid grid-cols-1 lg:grid-cols-3" style={{ gap: 12 }}>
                {loadingPosts && !hiringPosts.length
                  ? <Skeleton count={6} />
                  : filtered.length
                    ? filtered.map((p, i) => (
                        <Card key={i} className="fade-up" accentColor={C.gold}>
                          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 8 }}>
                            <div style={{
                              width: 30, height: 30, borderRadius: "50%", flexShrink: 0,
                              background: C.gDim, border: `1px solid ${C.gBorder}`,
                              display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
                            }}>
                              {p.avatar
                                ? <img src={p.avatar} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                : <User size={13} color={C.gold} />}
                            </div>
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {p.author}
                              </div>
                              {p.job_title && (
                                <div style={{ fontSize: 10, color: C.gold, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 }}>
                                  {p.job_title}
                                </div>
                              )}
                              <div style={{ fontSize: 11, color: C.text2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font-mono)" }}>
                                {p.company_name || p.company}
                              </div>
                            </div>
                            {p.url && (
                              <a href={p.url} target="_blank" rel="noopener noreferrer" style={{ color: C.gold, flexShrink: 0 }}>
                                <ExternalLink size={12} />
                              </a>
                            )}
                          </div>
                          <p style={{ fontSize: 12, color: C.text, lineHeight: 1.6, margin: 0,
                            display: "-webkit-box", WebkitLineClamp: 5, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                            {p.text}
                          </p>
                          {/* ── Email finder row ── */}
                          {(() => {
                            const ekey = `${p.author}|${p.company_name || p.company}`;
                            const es   = emailCache[ekey] || {};
                            return (
                              <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                {es.email ? (
                                  <a href={`mailto:${es.email}`} style={{
                                    fontSize: 11, color: C.green, display: "flex", alignItems: "center", gap: 4,
                                    textDecoration: "none", fontFamily: "var(--font-mono)",
                                  }}>
                                    <Mail size={10} /> {es.email}
                                    {es.score > 0 && <span style={{ color: C.text3, fontSize: 9 }}>({es.score}%)</span>}
                                  </a>
                                ) : es.loading ? (
                                  <span style={{ fontSize: 11, color: C.text3, display: "flex", alignItems: "center", gap: 4 }}>
                                    <Loader2 size={10} className="animate-spin" /> Finding…
                                  </span>
                                ) : es.email === null ? (
                                  <span style={{ fontSize: 10, color: C.text3 }}>No email found</span>
                                ) : (
                                  <button
                                    onClick={() => findEmail(p.author, p.company_name || p.company)}
                                    style={{
                                      fontSize: 10, padding: "2px 8px", borderRadius: 4, cursor: "pointer",
                                      background: C.gnDim, border: `1px solid ${C.green}`,
                                      color: C.green, display: "flex", alignItems: "center", gap: 4,
                                    }}
                                  >
                                    <Mail size={9} /> Find Email
                                  </button>
                                )}
                                {p.posted && (
                                  <span style={{ fontSize: 10, color: C.text3, marginLeft: "auto", fontFamily: "var(--font-mono)" }}>
                                    {p.posted}
                                  </span>
                                )}
                              </div>
                            );
                          })()}
                        </Card>
                      ))
                    : (
                      <div style={{ textAlign: "center", padding: "48px 0", color: C.text3, gridColumn: "1/-1" }}>
                        <MessageSquare size={28} style={{ margin: "0 auto 12px", opacity: 0.4 }} />
                        <p style={{ fontSize: 12, marginBottom: 12 }}>
                          {hiringPosts.length ? "No posts in this time range." : "No hiring posts yet."}
                        </p>
                        {!hiringPosts.length && (
                          <button onClick={searchHiringPosts} style={{
                            padding: "6px 14px", borderRadius: 5, fontSize: 12, cursor: "pointer",
                            background: C.gDim, border: `1px solid ${C.gBorder}`, color: C.gold,
                          }}>Scan LinkedIn Posts</button>
                        )}
                      </div>
                    )
                }
              </div>
            );
          })()}
        </div>
      )}

      {/* ── STARTUPS PANEL ─────────────────────────────────────────────────── */}
      {activePanel === "startups" && (
        <div style={{ padding: 20, overflowY: "auto", maxHeight: "calc(100vh - 148px)" }}>
          {/* Role chips */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, color: C.text3, marginBottom: 6, fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: 1 }}>
              Target Roles
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
              {["Forward Deployed Engineer","Forward Deployed AI Engineer","AI Engineer",
                "AI Automation Engineer","AI Deployment Strategist","AI Operations","Solutions Engineer"].map(role => {
                const active = startupRoles.includes(role);
                return (
                  <button key={role} onClick={() => setStartupRoles(prev =>
                    active ? prev.filter(r => r !== role) : [...prev, role]
                  )} style={{
                    padding: "3px 10px", borderRadius: 20, fontSize: 11, cursor: "pointer",
                    background: active ? C.gnDim : C.bg2,
                    border: `1px solid ${active ? C.green : C.border}`,
                    color: active ? C.green : C.text2,
                    transition: "all 0.15s",
                  }}>
                    {role}
                  </button>
                );
              })}
            </div>
            {/* Platform toggles + search */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontSize: 10, color: C.text3, fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: 1 }}>
                Boards:
              </div>
              {[["ashby","Ashby","#7c3aed"],["greenhouse","Greenhouse","#059669"],["lever","Lever","#0ea5e9"],["dover","Dover","#f59e0b"]].map(([key, label, col]) => {
                const active = startupPlatforms.includes(key);
                return (
                  <button key={key} onClick={() => setStartupPlatforms(prev =>
                    active ? prev.filter(p => p !== key) : [...prev, key]
                  )} style={{
                    padding: "3px 10px", borderRadius: 20, fontSize: 11, cursor: "pointer",
                    background: active ? col + "22" : C.bg2,
                    border: `1px solid ${active ? col : C.border}`,
                    color: active ? col : C.text2,
                    transition: "all 0.15s",
                  }}>
                    {label}
                  </button>
                );
              })}
              <button
                onClick={() => searchStartupRoles(startupRoles, startupPlatforms)}
                disabled={loadingStartup || startupRoles.length === 0 || startupPlatforms.length === 0}
                style={{
                  padding: "4px 16px", borderRadius: 5, fontSize: 12, cursor: "pointer",
                  background: C.gnDim, border: `1px solid ${C.green}`, color: C.green,
                  display: "flex", alignItems: "center", gap: 5, marginLeft: "auto",
                  opacity: (loadingStartup || startupRoles.length === 0) ? 0.5 : 1,
                }}
              >
                {loadingStartup ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
                {loadingStartup ? "Scanning…" : "Find Jobs"}
              </button>
            </div>
          </div>

          {/* Results */}
          <div className="grid grid-cols-1 lg:grid-cols-3" style={{ gap: 12 }}>
            {loadingStartup && !startupJobs.length
              ? <Skeleton count={9} />
              : startupJobs.length
                ? startupJobs.map((j, i) => {
                    const platColor = j.platform === "Ashby" ? "#7c3aed"
                      : j.platform === "Greenhouse" ? "#059669"
                      : j.platform === "Lever" ? "#0ea5e9"
                      : j.platform === "Dover" ? "#f59e0b" : C.green;
                    return (
                      <Card key={i} className="fade-up" accentColor={platColor}>
                        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 6, marginBottom: 6 }}>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: C.text, lineHeight: 1.4 }}>
                              {j.title}
                            </div>
                            <div style={{ fontSize: 12, color: C.text2, marginTop: 2 }}>
                              {j.company}
                            </div>
                          </div>
                          <span style={{
                            fontSize: 9, padding: "2px 7px", borderRadius: 20, flexShrink: 0,
                            background: platColor + "22", border: `1px solid ${platColor}`,
                            color: platColor, fontFamily: "var(--font-mono)", textTransform: "uppercase",
                          }}>
                            {j.platform}
                          </span>
                        </div>
                        {j.description && (
                          <p style={{ fontSize: 11, color: C.text3, lineHeight: 1.5, margin: "0 0 10px",
                            display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                            {j.description}
                          </p>
                        )}
                        {j.url && (
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <a href={j.url} target="_blank" rel="noopener noreferrer" style={{
                              display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11,
                              padding: "4px 10px", borderRadius: 5,
                              background: platColor + "22", border: `1px solid ${platColor}`,
                              color: platColor, textDecoration: "none", fontWeight: 600,
                            }}>
                              View <ExternalLink size={10} />
                            </a>
                            <button
                              onClick={() => startApply(j)}
                              disabled={!!applySession}
                              style={{
                                display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11,
                                padding: "4px 10px", borderRadius: 5, cursor: applySession ? "not-allowed" : "pointer",
                                background: C.aDim, border: `1px solid ${C.accent}`,
                                color: C.accent, fontWeight: 600, opacity: applySession ? 0.4 : 1,
                              }}
                            >
                              <Rocket size={10} /> Auto Apply
                            </button>
                          </div>
                        )}
                      </Card>
                    );
                  })
                : (
                  <div style={{ textAlign: "center", padding: "60px 0", color: C.text3, gridColumn: "1/-1" }}>
                    <Rocket size={28} style={{ margin: "0 auto 12px", opacity: 0.4 }} />
                    <p style={{ fontSize: 12, marginBottom: 16 }}>
                      Select roles and platforms, then hit <strong>Find Jobs</strong>.
                    </p>
                  </div>
                )
            }
          </div>
        </div>
      )}

      {/* ── MAIN GRID ──────────────────────────────────────────────────────── */}
      {activePanel !== "resume" && activePanel !== "posts" && activePanel !== "startups" && (
        <div className="grid grid-cols-1 lg:grid-cols-2" style={{ minHeight: "calc(100vh - 148px)" }}>

          {/* COL 1: JOBS */}
          <div className={`p-4 overflow-y-auto ${activePanel !== "jobs" ? "hidden lg:block" : ""}`}
            style={{ borderRight: `1px solid ${C.border}`, maxHeight: "calc(100vh - 148px)" }}>
            <SectionHeader
              icon={<Briefcase size={13} />}
              label="Job radar"
              color={C.accent}
              right={
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <select
                    value={tprSeconds}
                    onChange={e => setTprSeconds(Number(e.target.value))}
                    style={{
                      fontSize: 11,
                      borderRadius: 4,
                      border: `1px solid ${C.border2}`,
                      background: C.bg2,
                      color: C.text2,
                      padding: "3px 6px",
                      outline: "none",
                      fontFamily: "var(--font-mono)",
                      cursor: "pointer",
                    }}>
                    <option value={3600}>1h</option>
                    <option value={7200}>2h</option>
                    <option value={14400}>4h</option>
                    <option value={86400}>24h</option>
                  </select>
                  <button onClick={searchJobs} disabled={loadingJobs} style={{
                    background: "none", border: "none", color: C.text2, cursor: "pointer", padding: 3, display: "flex",
                  }}>
                    {loadingJobs ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                  </button>
                </div>
              }
            />
            {loadingJobs && !jobs.length
              ? <Skeleton count={4} />
              : jobs.length
                ? jobs.map((j, i) => (
                    <JobCard key={i} job={j} active={selected === j} onClick={() => selectItem(j)} />
                  ))
                : (
                  <div style={{ textAlign: "center", padding: "48px 0", color: C.text3 }}>
                    <Globe size={28} style={{ margin: "0 auto 12px", opacity: 0.4 }} />
                    <p style={{ fontSize: 12 }}>No jobs yet. Hit Scan.</p>
                  </div>
                )
            }
          </div>

          {/* COL 2: ACTION */}
          <div className={`p-4 overflow-y-auto ${activePanel !== "action" ? "hidden lg:block" : ""}`}
            style={{ maxHeight: "calc(100vh - 148px)" }}>
            <SectionHeader icon={<Send size={13} />} label="Action" color="#f472b6" />

            {selected ? (
              <div className="fade-up">
                {/* Selected item card */}
                <div style={{
                  padding: 14,
                  borderRadius: 6,
                  border: `1px solid ${C.border2}`,
                  borderTop: `2px solid ${C.accent}`,
                  background: C.bg2,
                  marginBottom: 12,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                    <h3 style={{ fontSize: 14, fontWeight: 600, color: C.text, lineHeight: 1.3, flex: 1, marginRight: 8 }}>
                      {selected.title || `${selected.author}'s post`}
                    </h3>
                    <button onClick={() => setSelected(null)}
                      style={{ background: "none", border: "none", color: C.text2, cursor: "pointer", padding: 2, display: "flex" }}>
                      <X size={14} />
                    </button>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: C.text2, marginBottom: 8, fontFamily: "var(--font-mono)" }}>
                    <Building size={11} />{selected.company}
                    {selected.location && <><span style={{ color: C.text3 }}>·</span><MapPin size={11} />{selected.location}</>}
                  </div>
                  <p style={{ fontSize: 12, color: C.text, lineHeight: 1.55, margin: 0 }}>
                    {(selected.description || selected.content || "").slice(0, 280)}
                    {(selected.description || selected.content || "").length > 280 ? "…" : ""}
                  </p>
                  {selected.url && (
                    <a href={selected.url} target="_blank" rel="noopener noreferrer"
                      style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, marginTop: 10, color: C.accent, textDecoration: "none" }}>
                      <ExternalLink size={11} /> View posting
                    </a>
                  )}
                </div>

                {/* Generate outreach */}
                {!draft && (
                  <Btn full onClick={() => generateOutreach(selected)} disabled={loadingDraft} color="#f472b6">
                    {loadingDraft
                      ? <><Loader2 size={13} className="animate-spin" /> Crafting...</>
                      : <><Sparkles size={13} /> Generate outreach</>}
                  </Btn>
                )}

                {/* Draft */}
                {draft && (
                  <div ref={draftRef} className="slide-in" style={{ marginBottom: 12 }}>
                    <div style={{
                      padding: 14,
                      borderRadius: 6,
                      border: `1px solid ${C.vBorder}`,
                      background: C.vDim,
                      marginBottom: 10,
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
                        <Mail size={13} color={C.violet} />
                        <Label color={C.violet}>Draft ready</Label>
                        <button onClick={() => generateOutreach(selected)}
                          style={{ marginLeft: "auto", background: "none", border: "none", color: C.text2, cursor: "pointer",
                            display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
                          <RefreshCw size={11} /> Redo
                        </button>
                      </div>
                      <Label>Subject</Label>
                      <div style={{ fontSize: 13, fontWeight: 500, color: C.text, marginTop: 4, marginBottom: 10 }}>{draft.subject}</div>
                      <Label>Body</Label>
                      <div style={{ fontSize: 12, color: C.text, lineHeight: 1.65, marginTop: 4, whiteSpace: "pre-wrap" }}>{draft.body}</div>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <Input value={emailTo} onChange={e => setEmailTo(e.target.value)} placeholder="Recipient email address" />
                      <Btn full onClick={sendEmail} disabled={!emailTo || sendingEmail} color={C.green}>
                        {sendingEmail ? <><Loader2 size={13} className="animate-spin" /> Sending…</> : <><Send size={13} /> Send via Gmail</>}
                      </Btn>
                      <Btn full outline onClick={() => navigator.clipboard?.writeText(`Subject: ${draft.subject}\n\n${draft.body}`)}>
                        <Copy size={12} /> Copy to clipboard
                      </Btn>
                    </div>
                  </div>
                )}

                {/* Autofill */}
                {selected?.url && (
                  <div style={{ marginTop: 16 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
                      <ClipboardList size={13} color={C.violet} />
                      <Label color={C.violet}>Autofill Application</Label>
                    </div>

                    {!autofillFields && (
                      <Btn full onClick={() => generateAutofill(selected)} disabled={loadingAutofill} color={C.violet}>
                        {loadingAutofill
                          ? <><Loader2 size={13} className="animate-spin" /> Generating fields…</>
                          : <><ClipboardList size={13} /> Generate autofill fields</>}
                      </Btn>
                    )}

                    {autofillFields && (
                      <div style={{
                        borderRadius: 6,
                        border: `1px solid ${C.border2}`,
                        background: C.bg2,
                        overflow: "hidden",
                        marginBottom: 8,
                      }}>
                        <div style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                          padding: "8px 12px",
                          borderBottom: `1px solid ${C.border}`,
                        }}>
                          <Label>Generated fields</Label>
                          <button onClick={() => generateAutofill(selected)}
                            style={{ background: "none", border: "none", color: C.text2, cursor: "pointer",
                              display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
                            <RefreshCw size={11} /> Redo
                          </button>
                        </div>
                        <div style={{ padding: 10, maxHeight: 260, overflowY: "auto" }}>
                          {Object.entries(autofillFields).map(([key, value]) => value ? (
                            <div key={key} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 10, color: C.text2, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "var(--font-display)", marginBottom: 2 }}>
                                  {key.replace(/_/g, " ")}
                                </div>
                                <div style={{ fontSize: 12, color: C.text, lineHeight: 1.4,
                                  display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                                  {value}
                                </div>
                              </div>
                              <button onClick={() => navigator.clipboard?.writeText(value)}
                                style={{ background: "none", border: "none", color: C.text3, cursor: "pointer", padding: 2, display: "flex", flexShrink: 0 }}>
                                <Copy size={11} />
                              </button>
                            </div>
                          ) : null)}
                        </div>
                        <div style={{ display: "flex", gap: 6, padding: "8px 10px", borderTop: `1px solid ${C.border}` }}>
                          <button
                            onClick={() => {
                              const fieldText = Object.entries(autofillFields).filter(([, v]) => v)
                                .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join('\n\n');
                              const prompt = `Autofill this job application using Playwright MCP.\n\nJob URL: ${selected.url}\n\nPre-generated answers:\n${fieldText}\n\nNavigate to the URL, click Apply, fill every visible field using the answers above. For any question not covered, generate a suitable answer from context. Leave the browser open for me to review before submitting.`;
                              navigator.clipboard?.writeText(prompt);
                            }}
                            style={{
                              flex: 1, padding: "7px 10px", borderRadius: 4,
                              background: "linear-gradient(135deg, #7c3aed, #9b72f5)",
                              color: "#fff", border: "none", cursor: "pointer",
                              fontSize: 11, fontFamily: "var(--font-display)", fontWeight: 700,
                              letterSpacing: "0.06em", textTransform: "uppercase",
                              display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                            }}>
                            <Copy size={11} /> Copy Claude Code prompt
                          </button>
                          <button
                            onClick={() => navigator.clipboard?.writeText(
                              Object.entries(autofillFields).filter(([, v]) => v)
                                .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join('\n\n')
                            )}
                            style={{
                              padding: "7px 10px", borderRadius: 4,
                              border: `1px solid ${C.border2}`, background: "transparent",
                              color: C.text2, cursor: "pointer", fontSize: 11,
                              display: "flex", alignItems: "center", gap: 4,
                            }}>
                            <Copy size={11} /> All
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ textAlign: "center", padding: "60px 0", color: C.text3 }}>
                <MessageSquare size={32} style={{ margin: "0 auto 12px", opacity: 0.3 }} />
                <p style={{ fontSize: 13, color: C.text2, marginBottom: 4 }}>Select a job or signal</p>
                <p style={{ fontSize: 11 }}>Click any item to generate outreach</p>
              </div>
            )}

            {/* ── AUTO-APPLY ── */}
            {selected?.url && (() => {
              const STEPS = [
                { key: "starting",        label: "Launch browser",       icon: <Rocket size={11} /> },
                { key: "navigating",      label: "Navigate to posting",  icon: <Globe size={11} /> },
                { key: "filling",         label: "Fill form fields",     icon: <ClipboardList size={11} /> },
                { key: "awaiting_confirm",label: "Review & confirm",     icon: <AlertCircle size={11} /> },
                { key: "submitting",      label: "Submit application",   icon: <Send size={11} /> },
                { key: "submitted",       label: "Done",                 icon: <CheckCircle size={11} /> },
              ];
              const currentIdx = STEPS.findIndex(s => s.key === applyStatus?.status);
              const isActive  = s => applyStatus?.status === s.key;
              const isDone    = s => currentIdx > STEPS.findIndex(x => x.key === s.key);
              const isFailed  = applyStatus?.status === "failed";
              const isAborted = applyStatus?.status === "aborted";

              return (
                <div style={{ marginTop: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <Rocket size={13} color={C.accent} />
                      <Label color={C.accent}>Auto-Apply</Label>
                    </div>
                    {applySession && (
                      <button onClick={abortApply} style={{
                        background: "none", border: "none", color: C.text2,
                        cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", gap: 4,
                        fontFamily: "var(--font-display)", fontWeight: 600, letterSpacing: "0.06em",
                        textTransform: "uppercase",
                      }}>
                        <X size={11} /> Abort
                      </button>
                    )}
                  </div>

                  {!applySession && (
                    <Btn full onClick={() => startApply(selected)} color={C.accent}>
                      <Rocket size={13} /> Start autonomous apply
                    </Btn>
                  )}

                  {applyStatus && (
                    <div style={{
                      borderRadius: 8,
                      border: `1px solid ${isFailed ? C.red + "44" : isAborted ? C.text3 : C.aBorder}`,
                      background: isFailed ? C.red + "08" : C.aDim,
                      overflow: "hidden",
                    }}>
                      {/* Step timeline */}
                      <div style={{ padding: "14px 14px 10px" }}>
                        {STEPS.map((step, i) => {
                          const active = isActive(step);
                          const done   = isDone(step);
                          const color  = done ? C.green : active ? C.accent : C.text3;
                          const last   = i === STEPS.length - 1;
                          return (
                            <div key={step.key} style={{ display: "flex", gap: 10, position: "relative" }}>
                              {/* Line connector */}
                              {!last && (
                                <div style={{
                                  position: "absolute",
                                  left: 11, top: 22,
                                  width: 1,
                                  height: "calc(100% - 8px)",
                                  background: done ? C.green + "55" : C.border2,
                                  transition: "background 0.4s",
                                }} />
                              )}
                              {/* Circle */}
                              <div style={{
                                width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
                                border: `1.5px solid ${color}`,
                                background: done ? C.green + "22" : active ? C.accent + "22" : "transparent",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                color,
                                transition: "all 0.3s",
                                position: "relative", zIndex: 1,
                              }}>
                                {done
                                  ? <CheckCircle size={11} color={C.green} />
                                  : active && !["awaiting_confirm","submitted"].includes(step.key)
                                    ? <Loader2 size={11} className="animate-spin" color={C.accent} />
                                    : step.icon
                                }
                              </div>
                              {/* Label + message */}
                              <div style={{ paddingBottom: last ? 0 : 14, flex: 1, minWidth: 0 }}>
                                <div style={{
                                  fontSize: 12,
                                  fontFamily: "var(--font-display)",
                                  fontWeight: active ? 700 : 500,
                                  letterSpacing: "0.04em",
                                  textTransform: "uppercase",
                                  color: done ? C.green : active ? C.text : C.text3,
                                  transition: "color 0.3s",
                                }}>{step.label}</div>
                                {active && applyStatus.message && (
                                  <div style={{
                                    fontSize: 11, color: C.text2, marginTop: 2,
                                    fontFamily: "var(--font-mono)",
                                    animation: "fadeUp 0.3s both",
                                  }}>{applyStatus.message}</div>
                                )}
                              </div>
                            </div>
                          );
                        })}

                        {/* Failed / aborted state */}
                        {(isFailed || isAborted) && (
                          <div style={{
                            marginTop: 10, padding: "8px 10px", borderRadius: 5,
                            background: isFailed ? C.red + "15" : C.bg3,
                            border: `1px solid ${isFailed ? C.red + "33" : C.border2}`,
                            fontSize: 11, color: isFailed ? "#fca5a5" : C.text2,
                            fontFamily: "var(--font-mono)",
                          }}>
                            {applyStatus.error || applyStatus.message}
                          </div>
                        )}
                      </div>

                      {/* Screenshot panel */}
                      {applyStatus.screenshot && (
                        <div style={{ padding: "0 12px 12px" }}>
                          <div style={{
                            fontSize: 10, color: C.text2, marginBottom: 6,
                            fontFamily: "var(--font-mono)",
                            display: "flex", alignItems: "center", gap: 5,
                          }}>
                            <div style={{
                              width: 6, height: 6, borderRadius: "50%", background: C.accent,
                              animation: applyStatus.status === "awaiting_confirm" ? "pulse-accent 1.5s ease-in-out infinite" : "none",
                            }} />
                            Browser preview
                          </div>
                          <img
                            src={`data:image/png;base64,${applyStatus.screenshot}`}
                            alt="Browser state"
                            style={{
                              width: "100%", borderRadius: 5,
                              border: `1px solid ${applyStatus.status === "awaiting_confirm" ? C.gold + "55" : C.border2}`,
                              display: "block",
                            }}
                          />
                        </div>
                      )}

                      {/* Confirm CTA */}
                      {applyStatus.status === "awaiting_confirm" && (
                        <div style={{
                          padding: "12px 12px",
                          borderTop: `1px solid ${C.gold + "33"}`,
                          background: C.gold + "08",
                        }}>
                          <p style={{ fontSize: 11, color: C.gold, marginBottom: 10, fontFamily: "var(--font-mono)" }}>
                            ⚠ Review the form above. Confirm only if everything looks correct.
                          </p>
                          <div style={{ display: "flex", gap: 8 }}>
                            <Btn full onClick={confirmApply} color={C.green}>
                              <CheckCircle size={13} /> Confirm & submit
                            </Btn>
                            <Btn outline onClick={abortApply} color={C.red}>
                              <X size={13} /> Abort
                            </Btn>
                          </div>
                        </div>
                      )}

                      {/* Terminal reset */}
                      {["submitted","failed","aborted"].includes(applyStatus.status) && (
                        <div style={{ padding: "10px 12px", borderTop: `1px solid ${C.border}` }}>
                          <Btn full outline onClick={() => { setApplySession(null); setApplyStatus(null); }}>
                            Start new apply session
                          </Btn>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* History */}
            {history.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
                  <CheckCircle size={13} color={C.green} />
                  <Label color={C.green}>Outreach log</Label>
                </div>
                {history.map((h, i) => <HistoryItem key={i} item={h} />)}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── RESUME PANEL ───────────────────────────────────────────────────── */}
      {activePanel === "resume" && (
        <div style={{ maxWidth: 640, margin: "0 auto", padding: "24px 20px" }}>
          <SectionHeader icon={<FileText size={14} />} label="Resume Tailor" color={C.violet} />

          {/* Upload zone */}
          <div style={{
            padding: 20,
            borderRadius: 8,
            border: `1px solid ${C.border2}`,
            background: C.bg2,
            marginBottom: 14,
          }}>
            <Label>Upload resume (.docx or .txt)</Label>
            <label style={{
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              gap: 8, padding: "28px 20px", marginTop: 10,
              borderRadius: 6,
              border: `2px dashed ${resumeFile ? C.violet : C.border2}`,
              background: resumeFile ? C.vDim : C.bg,
              cursor: "pointer",
              transition: "border-color 0.2s, background 0.2s",
            }}>
              <Upload size={20} color={resumeFile ? C.violet : C.text3} />
              <span style={{ fontSize: 13, color: resumeFile ? C.violet : C.text2 }}>
                {resumeFile ? resumeFile.name : "Click to upload resume"}
              </span>
              <span style={{ fontSize: 11, color: C.text3, fontFamily: "var(--font-mono)" }}>
                .docx · .txt
              </span>
              <input type="file" accept=".docx,.txt" style={{ display: "none" }}
                onChange={e => { setResumeFile(e.target.files[0]); setTailoredResume(null); }} />
            </label>
          </div>

          {/* Job selector */}
          <div style={{
            padding: 20, borderRadius: 8,
            border: `1px solid ${C.border2}`, background: C.bg2, marginBottom: 14,
          }}>
            <Label>Select job to tailor for</Label>
            {jobs.length ? (
              <select
                onChange={e => { const j = jobs[parseInt(e.target.value)]; setSelected(j); setTailoredResume(null); }}
                style={{
                  marginTop: 10, width: "100%",
                  padding: "9px 12px", borderRadius: 5,
                  border: `1px solid ${C.border2}`,
                  background: C.bg, color: C.text,
                  fontSize: 13, outline: "none",
                  fontFamily: "var(--font-body)",
                  cursor: "pointer",
                }}>
                <option value="">— Pick a job —</option>
                {jobs.map((j, i) => (
                  <option key={i} value={i}>{j.title} @ {j.company}</option>
                ))}
              </select>
            ) : (
              <p style={{ fontSize: 12, color: C.text2, marginTop: 10 }}>
                No jobs loaded — scan first from Radar tab.
              </p>
            )}
          </div>

          {/* Tailor button */}
          <Btn
            full
            onClick={() => tailorResume(selected)}
            disabled={!resumeFile || !selected || loadingTailor}
            color={C.violet}
          >
            {loadingTailor
              ? <><Loader2 size={13} className="animate-spin" /> Tailoring resume…</>
              : <><Sparkles size={13} /> Tailor resume</>}
          </Btn>

          {/* Results */}
          {tailoredResume && (
            <div className="slide-in" style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 12 }}>

              {/* Match score */}
              <div style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: 12, borderRadius: 6,
                border: `1px solid ${C.border2}`, background: C.bg2,
              }}>
                <ScoreBadge score={tailoredResume.match_score} />
                <span style={{ fontSize: 12, color: C.text2, lineHeight: 1.5 }}>{tailoredResume.tailoring_notes}</span>
              </div>

              {/* Summary */}
              {[{
                label: "Summary", content: tailoredResume.summary,
                copyText: tailoredResume.summary,
                render: () => <p style={{ fontSize: 13, color: C.text, lineHeight: 1.65, margin: 0 }}>{tailoredResume.summary}</p>
              }].map(s => (
                <div key={s.label} style={{ padding: 14, borderRadius: 6, border: `1px solid ${C.border2}`, background: C.bg2 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <Label>{s.label}</Label>
                    <button onClick={() => navigator.clipboard?.writeText(s.copyText)}
                      style={{ background: "none", border: "none", color: C.text2, cursor: "pointer",
                        display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
                      <Copy size={11} /> Copy
                    </button>
                  </div>
                  {s.render()}
                </div>
              ))}

              {/* Skills */}
              <div style={{ padding: 14, borderRadius: 6, border: `1px solid ${C.border2}`, background: C.bg2 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <Label>Skills (reordered)</Label>
                  <button onClick={() => navigator.clipboard?.writeText(tailoredResume.skills.join(", "))}
                    style={{ background: "none", border: "none", color: C.text2, cursor: "pointer",
                      display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
                    <Copy size={11} /> Copy
                  </button>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {tailoredResume.skills.map((s, i) => (
                    <span key={i} style={{
                      fontSize: 11, padding: "3px 8px", borderRadius: 4,
                      background: C.vDim, color: C.violet,
                      border: `1px solid ${C.vBorder}`,
                      fontFamily: "var(--font-mono)",
                    }}>{s}</span>
                  ))}
                </div>
              </div>

              {/* Experience bullets */}
              {Object.entries(tailoredResume.experience_bullets || {}).map(([role, bullets]) => (
                <div key={role} style={{ padding: 14, borderRadius: 6, border: `1px solid ${C.border2}`, background: C.bg2 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                    <Label>{role}</Label>
                    <button onClick={() => navigator.clipboard?.writeText(bullets.join("\n"))}
                      style={{ background: "none", border: "none", color: C.text2, cursor: "pointer",
                        display: "flex", alignItems: "center", gap: 4, fontSize: 11, flexShrink: 0, marginLeft: 8 }}>
                      <Copy size={11} /> Copy
                    </button>
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 16 }}>
                    {bullets.map((b, i) => (
                      <li key={i} style={{ fontSize: 13, color: C.text, lineHeight: 1.65, marginBottom: 4 }}>{b}</li>
                    ))}
                  </ul>
                </div>
              ))}

              {/* Keywords */}
              {tailoredResume.keywords_added?.length > 0 && (
                <div style={{ padding: 14, borderRadius: 6, border: `1px solid ${C.border2}`, background: C.bg2 }}>
                  <Label style={{ display: "block", marginBottom: 10 }}>Keywords injected</Label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                    {tailoredResume.keywords_added.map((k, i) => (
                      <span key={i} style={{
                        fontSize: 11, padding: "3px 8px", borderRadius: 4,
                        background: C.gnDim, color: C.green,
                        border: `1px solid ${C.green}33`,
                        fontFamily: "var(--font-mono)",
                      }}>{k}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div style={{ display: "flex", gap: 8 }}>
                <Btn full onClick={() => setShowResumePreview(true)} color={C.violet}>
                  <FileText size={13} /> Preview full resume
                </Btn>
                <Btn outline onClick={() => {
                  const text = [
                    "SUMMARY\n" + tailoredResume.summary,
                    "\nSKILLS\n" + tailoredResume.skills.join(", "),
                    ...Object.entries(tailoredResume.experience_bullets || {}).map(
                      ([role, bullets]) => `\n${role}\n` + bullets.map(b => `• ${b}`).join("\n")
                    ),
                  ].join("\n");
                  navigator.clipboard?.writeText(text);
                }}>
                  <Copy size={13} />
                </Btn>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
