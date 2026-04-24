import { useState, useEffect, useCallback, useRef } from "react";
import {
  Search, Zap, Send, Calendar, FileText, RefreshCw, Settings,
  ChevronRight, ExternalLink, Star, Clock, Building, MapPin,
  Briefcase, TrendingUp, User, Mail, AlertCircle, CheckCircle,
  Loader2, X, Plus, ArrowRight, Sparkles, Radio, Eye, Copy,
  Target, Rocket, Globe, MessageSquare, Key, Shield, ChevronDown,
  Menu, XCircle
} from "lucide-react";

// ─── Constants ───
const API_URL = "https://api.anthropic.com/v1/messages";
const STORAGE_KEY = "jobpilot:state";
const API_KEY_STORAGE = "jobpilot:apikey";

// ─── MCP Server configs ───
const MCP_SERVERS = {
  gmail: { type: "url", url: "https://gmailmcp.googleapis.com/mcp/v1", name: "gmail" },
  calendar: { type: "url", url: "https://calendarmcp.googleapis.com/mcp/v1", name: "gcal" },
  drive: { type: "url", url: "https://drivemcp.googleapis.com/mcp/v1", name: "gdrive" },
};

// ─── API Helper ───
async function callClaude(apiKey, messages, tools = [], mcpServers = []) {
  const body = {
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    messages,
  };
  if (tools.length) body.tools = tools;
  if (mcpServers.length) body.mcp_servers = mcpServers;

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `API error: ${res.status}`);
  }
  return res.json();
}

function extractText(data) {
  return (data?.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
}

function parseJSON(text) {
  try {
    const clean = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const arrMatch = clean.match(/\[[\s\S]*\]/);
    if (arrMatch) return JSON.parse(arrMatch[0]);
    const objMatch = clean.match(/\{[\s\S]*\}/);
    if (objMatch) return JSON.parse(objMatch[0]);
    return JSON.parse(clean);
  } catch {
    return null;
  }
}

// ─── Local Storage helpers ───
function loadState(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}
function saveState(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

const defaultPrefs = { role: "", location: "", skills: [], resumeContext: "", targetCompanies: "" };

// ─── Components ───

function ScoreBadge({ score }) {
  const s = parseFloat(score) || 0;
  const color = s >= 8 ? "#10b981" : s >= 6 ? "#f59e0b" : "#ef4444";
  return (
    <span className="inline-flex items-center gap-1 rounded-full text-xs font-semibold"
      style={{ padding: "2px 8px", fontFamily: "monospace", background: color + "18", color, border: `1px solid ${color}33` }}>
      <Star size={10} fill={color} />{s.toFixed(1)}
    </span>
  );
}

function StatusDot({ status }) {
  const colors = { sent: "#10b981", draft: "#f59e0b", scheduled: "#6366f1", failed: "#ef4444" };
  return <span className="inline-block shrink-0 rounded-full" style={{ width: 8, height: 8, background: colors[status] || "#666" }} />;
}

function GlowCard({ children, active, onClick, color = "#22d3ee", className = "" }) {
  return (
    <div onClick={onClick}
      className={`cursor-pointer rounded-xl transition-all duration-200 ${className}`}
      style={{
        padding: "14px 16px",
        border: active ? `1px solid ${color}55` : "1px solid #1e293b",
        background: active ? color + "08" : "#0f172a",
        boxShadow: active ? `0 0 20px ${color}15, inset 0 0 20px ${color}05` : "none",
      }}>
      {children}
    </div>
  );
}

function Skeleton({ count = 3 }) {
  return Array.from({ length: count }).map((_, i) => (
    <div key={i} className="rounded-xl border border-slate-800 bg-slate-900 p-4 mb-2.5">
      <div className="h-3.5 w-3/4 bg-slate-800 rounded mb-2.5 animate-pulse" />
      <div className="h-2.5 w-1/2 bg-slate-800 rounded animate-pulse" />
    </div>
  ));
}

// ─── API Key Modal ───
function ApiKeyModal({ onSave }) {
  const [key, setKey] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "#000000dd", backdropFilter: "blur(12px)" }}>
      <div className="w-full max-w-md rounded-2xl border border-slate-800 p-8" style={{ background: "#0f172a" }}>
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "#22d3ee18" }}>
            <Key size={20} color="#22d3ee" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-100">Connect your API key</h2>
            <p className="text-xs text-slate-500">Stored locally in your browser, never sent anywhere else</p>
          </div>
        </div>
        <div className="mb-2">
          <label className="block text-xs font-medium text-slate-400 mb-2 uppercase tracking-wider">Anthropic API key</label>
          <input type="password" value={key} onChange={e => setKey(e.target.value)}
            placeholder="sk-ant-api03-..."
            className="w-full rounded-lg border border-slate-800 bg-slate-950 text-slate-100 text-sm p-3 outline-none focus:border-cyan-600"
          />
        </div>
        <div className="flex items-center gap-2 mb-6 mt-3">
          <Shield size={12} className="text-slate-500" />
          <span className="text-xs text-slate-500">Key is stored in localStorage only. Read the source to verify.</span>
        </div>
        <button onClick={() => key.startsWith("sk-") && onSave(key)} disabled={!key.startsWith("sk-")}
          className="w-full rounded-xl py-3 text-sm font-semibold flex items-center justify-center gap-2 transition-all"
          style={{
            background: key.startsWith("sk-") ? "linear-gradient(135deg, #0891b2, #22d3ee)" : "#1e293b",
            color: key.startsWith("sk-") ? "#020617" : "#64748b",
            cursor: key.startsWith("sk-") ? "pointer" : "default", border: "none",
          }}>
          <Rocket size={16} /> Connect & Launch
        </button>
      </div>
    </div>
  );
}

// ─── Preferences Modal ───
function PreferencesModal({ prefs, onSave, onClose, canClose }) {
  const [form, setForm] = useState({ ...prefs, skills: prefs.skills?.join(", ") || "" });
  const update = (key, val) => setForm(p => ({ ...p, [key]: val }));

  const fields = [
    { key: "role", label: "Target role", ph: "Senior Frontend Engineer" },
    { key: "location", label: "Preferred location", ph: "San Francisco, Remote" },
    { key: "skills", label: "Key skills (comma-separated)", ph: "React, TypeScript, Node.js, System Design" },
    { key: "targetCompanies", label: "Target companies (optional)", ph: "Stripe, Vercel, Linear, Anthropic" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "#000000cc", backdropFilter: "blur(8px)" }}>
      <div className="w-full max-w-lg rounded-2xl border border-slate-800 p-8 relative" style={{ background: "#0f172a" }}>
        {canClose && (
          <button onClick={onClose} className="absolute top-4 right-4 text-slate-500 hover:text-slate-300" style={{ background: "none", border: "none", cursor: "pointer" }}>
            <X size={18} />
          </button>
        )}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "#22d3ee18" }}>
            <Target size={18} color="#22d3ee" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-100">Mission parameters</h2>
            <p className="text-xs text-slate-500">Configure your job search agent</p>
          </div>
        </div>
        {fields.map(f => (
          <div key={f.key} className="mb-4">
            <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">{f.label}</label>
            <input value={form[f.key]} onChange={e => update(f.key, e.target.value)} placeholder={f.ph}
              className="w-full rounded-lg border border-slate-800 bg-slate-950 text-slate-100 text-sm p-2.5 outline-none focus:border-cyan-700"
            />
          </div>
        ))}
        <div className="mb-5">
          <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">Resume context / bio</label>
          <textarea value={form.resumeContext} onChange={e => update("resumeContext", e.target.value)}
            placeholder="Paste a summary of your experience or key resume highlights..." rows={3}
            className="w-full rounded-lg border border-slate-800 bg-slate-950 text-slate-100 text-sm p-2.5 outline-none focus:border-cyan-700 resize-y"
          />
        </div>
        <button onClick={() => {
          if (!form.role.trim()) return;
          onSave({ ...form, skills: form.skills.split(",").map(s => s.trim()).filter(Boolean) });
        }}
          className="w-full rounded-xl py-3 text-sm font-semibold flex items-center justify-center gap-2"
          style={{
            background: form.role.trim() ? "linear-gradient(135deg, #0891b2, #22d3ee)" : "#1e293b",
            color: form.role.trim() ? "#020617" : "#64748b",
            cursor: form.role.trim() ? "pointer" : "default", border: "none",
          }}>
          <Rocket size={16} /> Launch agent
        </button>
      </div>
    </div>
  );
}

// ─── Job Card ───
function JobCard({ job, active, onClick }) {
  return (
    <GlowCard active={active} onClick={onClick} color="#22d3ee" className="hover:border-slate-700 mb-2">
      <div className="flex justify-between items-start mb-1.5">
        <span className="text-sm font-semibold text-slate-100 leading-snug flex-1 mr-2">{job.title}</span>
        <ScoreBadge score={job.score} />
      </div>
      <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-1.5">
        <Building size={11} /><span>{job.company}</span>
        {job.location && <><span className="text-slate-700">·</span><MapPin size={11} /><span>{job.location}</span></>}
      </div>
      {job.type && <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-500">{job.type}</span>}
    </GlowCard>
  );
}

// ─── Signal Card ───
function SignalCard({ signal, active, onClick }) {
  return (
    <GlowCard active={active} onClick={onClick} color="#f59e0b" className="hover:border-slate-700 mb-2">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center" style={{ background: "#f59e0b18" }}>
          <User size={14} color="#f59e0b" />
        </div>
        <div className="min-w-0">
          <span className="text-[13px] font-semibold text-slate-100 block truncate">{signal.author}</span>
          <span className="text-[11px] text-slate-500 block truncate">{signal.company} · {signal.platform || "LinkedIn"}</span>
        </div>
      </div>
      <p className="text-xs text-slate-300 leading-relaxed line-clamp-3 m-0">{signal.content}</p>
    </GlowCard>
  );
}

// ─── History Item ───
function HistoryItem({ item }) {
  return (
    <div className="flex items-center gap-2.5 py-2.5 border-b border-slate-800">
      <StatusDot status={item.status} />
      <div className="flex-1 min-w-0">
        <span className="text-xs font-medium text-slate-200 block truncate">{item.company} — {item.role}</span>
        <span className="text-[11px] text-slate-500">{item.status} · {item.date}</span>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════
//  MAIN APP COMPONENT
// ═══════════════════════════════════════════
export default function App() {
  const [apiKey, setApiKey] = useState(() => loadState(API_KEY_STORAGE, null));
  const [prefs, setPrefs] = useState(null);
  const [showPrefs, setShowPrefs] = useState(false);
  const [jobs, setJobs] = useState([]);
  const [signals, setSignals] = useState([]);
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState(null);
  const [history, setHistory] = useState([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [loadingSignals, setLoadingSignals] = useState(false);
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [error, setError] = useState(null);
  const [activePanel, setActivePanel] = useState("jobs");
  const [lastRefresh, setLastRefresh] = useState(null);
  const [emailTo, setEmailTo] = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const draftRef = useRef(null);

  // ─── Load persisted state ───
  useEffect(() => {
    const s = loadState(STORAGE_KEY, null);
    if (s) {
      if (s.prefs?.role) setPrefs(s.prefs);
      if (s.jobs?.length) setJobs(s.jobs);
      if (s.signals?.length) setSignals(s.signals);
      if (s.history?.length) setHistory(s.history);
      if (s.lastRefresh) setLastRefresh(s.lastRefresh);
    }
    if (!s?.prefs?.role && apiKey) setShowPrefs(true);
  }, [apiKey]);

  // ─── Persist on change ───
  useEffect(() => {
    if (prefs) saveState(STORAGE_KEY, { prefs, jobs, signals, history, lastRefresh });
  }, [prefs, jobs, signals, history, lastRefresh]);

  // ─── Save API key ───
  const handleApiKeySave = (key) => {
    saveState(API_KEY_STORAGE, key);
    setApiKey(key);
    setShowPrefs(true);
  };

  // ─── Search Jobs ───
  const searchJobs = useCallback(async () => {
    if (!prefs?.role || !apiKey) return;
    setLoadingJobs(true); setError(null);
    try {
      const data = await callClaude(apiKey, [{
        role: "user",
        content: `Search for fresh, recently posted ${prefs.role} job openings${prefs.location ? ` in or near ${prefs.location}` : ""}${prefs.targetCompanies ? `. Prioritize: ${prefs.targetCompanies}` : ""}. Focus on roles requiring: ${prefs.skills.join(", ")}.

Find REAL current job postings. Return ONLY a valid JSON array of 6-10 jobs, no markdown, no backticks:
[{"title":"exact job title","company":"company name","location":"city/remote","type":"Full-time/Contract","url":"application url if found","posted":"e.g. 2 days ago","description":"1-2 sentence summary","score":7.5}]

Score each 1-10 for relevance to: ${prefs.role}, skills: ${prefs.skills.join(", ")}.`
      }], [{ type: "web_search_20250305", name: "web_search" }]);
      const text = extractText(data);
      const parsed = parseJSON(text);
      if (Array.isArray(parsed) && parsed.length) {
        setJobs(parsed);
        setLastRefresh(new Date().toISOString());
      } else setError("Could not parse job results. Try again.");
    } catch (e) { setError("Job search failed: " + e.message); }
    setLoadingJobs(false);
  }, [prefs, apiKey]);

  // ─── Search Signals ───
  const searchSignals = useCallback(async () => {
    if (!prefs?.role || !apiKey) return;
    setLoadingSignals(true); setError(null);
    try {
      const data = await callClaude(apiKey, [{
        role: "user",
        content: `Search for very recent LinkedIn posts and tweets from hiring managers, startup founders, and tech leaders who are actively hiring for ${prefs.role} or similar roles. Look for "we're hiring", "join our team", "open role".${prefs.targetCompanies ? ` Focus on: ${prefs.targetCompanies}.` : ""}

Find REAL recent posts. Return ONLY a valid JSON array:
[{"author":"name","role":"their title","company":"company","platform":"LinkedIn","content":"post summary (2-3 sentences)","url":"url if available","posted":"relative time"}]

Return 4-8 results.`
      }], [{ type: "web_search_20250305", name: "web_search" }]);
      const text = extractText(data);
      const parsed = parseJSON(text);
      if (Array.isArray(parsed) && parsed.length) setSignals(parsed);
      else setError("Could not parse signal results.");
    } catch (e) { setError("Signal search failed: " + e.message); }
    setLoadingSignals(false);
  }, [prefs, apiKey]);

  // ─── Generate Outreach ───
  const generateOutreach = useCallback(async (item) => {
    if (!apiKey) return;
    setLoadingDraft(true); setDraft(null);
    try {
      const isSignal = !!item.author;
      const data = await callClaude(apiKey, [{
        role: "user",
        content: `Draft a personalized ${isSignal ? "cold outreach message" : "job application message"} for:

${isSignal ? `Person: ${item.author} (${item.role || "Hiring Manager"} at ${item.company})
Their post: "${item.content}"` : `Job: ${item.title} at ${item.company}
Location: ${item.location}
Description: ${item.description}`}

My background — Role: ${prefs.role}, Skills: ${prefs.skills.join(", ")}
${prefs.resumeContext ? `Bio: ${prefs.resumeContext}` : ""}

Write concise, warm, specific, non-generic. Under 120 words. Sound human.
Return ONLY JSON: {"subject":"email subject","body":"message body"}`
      }]);
      const text = extractText(data);
      const parsed = parseJSON(text);
      if (parsed?.body) {
        setDraft(parsed);
        setTimeout(() => draftRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
      }
    } catch (e) { setError("Draft failed: " + e.message); }
    setLoadingDraft(false);
  }, [prefs, apiKey]);

  // ─── Send via Gmail MCP ───
  const sendEmail = useCallback(async () => {
    if (!draft || !emailTo || !apiKey) return;
    setSendingEmail(true);
    try {
      await callClaude(apiKey, [{
        role: "user",
        content: `Send an email to ${emailTo} with subject "${draft.subject}" and body:\n\n${draft.body}`
      }], [], [MCP_SERVERS.gmail]);
      const entry = {
        company: selected.company,
        role: selected.title || selected.role || prefs.role,
        status: "sent", date: new Date().toLocaleDateString(), to: emailTo,
      };
      setHistory(h => [entry, ...h]);
      setDraft(null); setEmailTo(""); setSelected(null);
    } catch (e) { setError("Send failed: " + e.message); }
    setSendingEmail(false);
  }, [draft, emailTo, selected, prefs, apiKey]);

  // ─── Schedule Follow-up ───
  const scheduleFollowUp = useCallback(async () => {
    if (!selected || !apiKey) return;
    try {
      const inDays = new Date(Date.now() + 3 * 86400000).toISOString();
      await callClaude(apiKey, [{
        role: "user",
        content: `Create a calendar event titled "Follow up: ${selected.company} - ${selected.title || prefs.role}" for ${inDays}. 15-minute reminder.`
      }], [], [MCP_SERVERS.calendar]);
    } catch (e) { setError("Calendar failed: " + e.message); }
  }, [selected, prefs, apiKey]);

  // ─── Run All ───
  const runAll = useCallback(async () => {
    await Promise.all([searchJobs(), searchSignals()]);
  }, [searchJobs, searchSignals]);

  // ─── Save Prefs ───
  const handleSavePrefs = (newPrefs) => {
    setPrefs(newPrefs);
    setShowPrefs(false);
    setTimeout(runAll, 300);
  };

  const totalSent = history.filter(h => h.status === "sent").length;
  const isLoading = loadingJobs || loadingSignals;

  // ─── No API key yet ───
  if (!apiKey) return <ApiKeyModal onSave={handleApiKeySave} />;

  // ═══ RENDER ═══
  return (
    <div className="min-h-screen" style={{ background: "#020617" }}>
      {(showPrefs || !prefs?.role) && (
        <PreferencesModal prefs={prefs || defaultPrefs} onSave={handleSavePrefs}
          onClose={() => prefs?.role && setShowPrefs(false)} canClose={!!prefs?.role} />
      )}

      {/* ─── HEADER ─── */}
      <header className="sticky top-0 z-40 border-b border-slate-900 flex items-center gap-3 px-4 py-3 sm:px-6"
        style={{ background: "#020617ee", backdropFilter: "blur(12px)" }}>
        <div className="flex items-center gap-2.5 mr-auto">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, #0891b2, #22d3ee)" }}>
            <Rocket size={15} color="#020617" />
          </div>
          <span className="text-base font-bold text-slate-100 tracking-tight hidden sm:inline">JobPilot</span>
          <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider hidden sm:inline"
            style={{ background: "#22d3ee18", color: "#22d3ee" }}>AI Agent</span>
        </div>

        {prefs?.role && (
          <span className="text-xs text-slate-500 max-w-[180px] truncate hidden md:inline">
            {prefs.role}{prefs.location ? ` · ${prefs.location}` : ""}
          </span>
        )}

        <button onClick={() => setShowPrefs(true)}
          className="rounded-lg border border-slate-800 px-2.5 py-1.5 text-xs text-slate-400 flex items-center gap-1.5 hover:border-slate-600 transition-colors"
          style={{ background: "none", cursor: "pointer" }}>
          <Settings size={13} /> <span className="hidden sm:inline">Config</span>
        </button>

        <button onClick={() => { saveState(API_KEY_STORAGE, null); setApiKey(null); }}
          className="rounded-lg border border-slate-800 px-2.5 py-1.5 text-xs text-slate-500 flex items-center gap-1.5 hover:border-red-800 hover:text-red-400 transition-colors"
          style={{ background: "none", cursor: "pointer" }}>
          <Key size={13} />
        </button>

        <button onClick={runAll} disabled={isLoading}
          className="rounded-lg px-3.5 py-2 text-[13px] font-semibold flex items-center gap-1.5 transition-all"
          style={{
            background: isLoading ? "#1e293b" : "linear-gradient(135deg, #0891b2, #22d3ee)",
            color: isLoading ? "#64748b" : "#020617", border: "none", cursor: "pointer",
          }}>
          {isLoading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          {isLoading ? "Scanning..." : "Scan"}
        </button>
      </header>

      {/* ─── STATS BAR ─── */}
      <div className="px-4 sm:px-6 py-2.5 border-b border-slate-900 flex gap-5 text-xs text-slate-500"
        style={{ background: "#020617" }}>
        {[
          { icon: <Briefcase size={12} />, label: `${jobs.length} jobs`, color: "#22d3ee" },
          { icon: <Radio size={12} />, label: `${signals.length} signals`, color: "#f59e0b" },
          { icon: <Send size={12} />, label: `${totalSent} sent`, color: "#10b981" },
          lastRefresh && { icon: <Clock size={12} />, label: new Date(lastRefresh).toLocaleTimeString() },
        ].filter(Boolean).map((s, i) => (
          <span key={i} className="flex items-center gap-1.5">
            <span style={{ color: s.color || "#64748b" }}>{s.icon}</span>{s.label}
          </span>
        ))}
      </div>

      {/* ─── ERROR ─── */}
      {error && (
        <div className="mx-4 sm:mx-6 mt-3 p-3 rounded-lg flex items-center gap-2.5 text-[13px]"
          style={{ background: "#ef444418", border: "1px solid #ef444433", color: "#fca5a5" }}>
          <AlertCircle size={16} />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} style={{ background: "none", border: "none", color: "#fca5a5", cursor: "pointer" }}><X size={14} /></button>
        </div>
      )}

      {/* ─── TABS (mobile-friendly) ─── */}
      <div className="flex border-b border-slate-900 px-4 sm:px-6" style={{ background: "#020617" }}>
        {[
          { key: "jobs", label: "Job radar", icon: <Briefcase size={13} />, color: "#22d3ee" },
          { key: "signals", label: "Signals", icon: <Zap size={13} />, color: "#f59e0b" },
          { key: "action", label: "Outreach", icon: <Send size={13} />, color: "#f472b6" },
        ].map(t => (
          <button key={t.key} onClick={() => setActivePanel(t.key)}
            className="py-2.5 px-3 sm:px-4 text-xs font-semibold flex items-center gap-1.5 uppercase tracking-wide transition-all"
            style={{
              background: "none", border: "none", cursor: "pointer",
              borderBottom: activePanel === t.key ? `2px solid ${t.color}` : "2px solid transparent",
              color: activePanel === t.key ? t.color : "#64748b",
            }}>
            {t.icon}<span className="hidden sm:inline">{t.label}</span>
          </button>
        ))}
      </div>

      {/* ─── MAIN GRID ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-3" style={{ minHeight: "calc(100vh - 170px)" }}>

        {/* ═══ COLUMN 1: JOBS ═══ */}
        <div className={`border-r border-slate-900 p-4 overflow-y-auto ${activePanel !== "jobs" ? "hidden lg:block" : ""}`}
          style={{ maxHeight: "calc(100vh - 170px)" }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Briefcase size={14} color="#22d3ee" />
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Job radar</span>
            </div>
            <button onClick={searchJobs} disabled={loadingJobs}
              style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", padding: 4 }}>
              {loadingJobs ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            </button>
          </div>
          {loadingJobs && !jobs.length ? <Skeleton count={4} /> :
            jobs.length ? jobs.sort((a, b) => (b.score || 0) - (a.score || 0)).map((j, i) => (
              <JobCard key={i} job={j} active={selected === j}
                onClick={() => { setSelected(j); setDraft(null); setActivePanel("action"); }} />
            )) : (
              <div className="text-center py-10 text-slate-600">
                <Globe size={32} className="mx-auto mb-3 opacity-40" />
                <p className="text-[13px]">No jobs yet. Hit Scan to search.</p>
              </div>
            )
          }
        </div>

        {/* ═══ COLUMN 2: SIGNALS ═══ */}
        <div className={`border-r border-slate-900 p-4 overflow-y-auto ${activePanel !== "signals" ? "hidden lg:block" : ""}`}
          style={{ maxHeight: "calc(100vh - 170px)" }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Zap size={14} color="#f59e0b" />
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Signals</span>
            </div>
            <button onClick={searchSignals} disabled={loadingSignals}
              style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", padding: 4 }}>
              {loadingSignals ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            </button>
          </div>
          {loadingSignals && !signals.length ? <Skeleton count={3} /> :
            signals.length ? signals.map((s, i) => (
              <SignalCard key={i} signal={s} active={selected === s}
                onClick={() => { setSelected(s); setDraft(null); setActivePanel("action"); }} />
            )) : (
              <div className="text-center py-10 text-slate-600">
                <Radio size={32} className="mx-auto mb-3 opacity-40" />
                <p className="text-[13px]">No signals yet. Hit Scan to detect.</p>
              </div>
            )
          }
        </div>

        {/* ═══ COLUMN 3: ACTION PANEL ═══ */}
        <div className={`p-4 overflow-y-auto ${activePanel !== "action" ? "hidden lg:block" : ""}`}
          style={{ maxHeight: "calc(100vh - 170px)" }}>
          <div className="flex items-center gap-2 mb-3">
            <Send size={14} color="#f472b6" />
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Action panel</span>
          </div>

          {selected ? (
            <div className="fade-in">
              {/* Detail Card */}
              <div className="p-4 rounded-xl border border-slate-800 mb-3" style={{ background: "#0f172a" }}>
                <div className="flex justify-between items-start mb-2">
                  <h3 className="text-base font-semibold text-slate-100 m-0">
                    {selected.title || `${selected.author}'s post`}
                  </h3>
                  <button onClick={() => setSelected(null)}
                    style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer" }}>
                    <X size={16} />
                  </button>
                </div>
                <div className="text-[13px] text-slate-400 mb-2 flex items-center gap-1">
                  <Building size={12} />{selected.company}
                  {selected.location && <><span className="text-slate-700 mx-1">·</span><MapPin size={12} />{selected.location}</>}
                </div>
                <p className="text-[13px] text-slate-300 leading-relaxed m-0">
                  {selected.description || selected.content}
                </p>
                {selected.url && (
                  <a href={selected.url} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs mt-2.5 no-underline" style={{ color: "#22d3ee" }}>
                    <ExternalLink size={12} /> View original
                  </a>
                )}
              </div>

              {/* Generate button */}
              {!draft && (
                <button onClick={() => generateOutreach(selected)} disabled={loadingDraft}
                  className="w-full py-3 rounded-xl text-[13px] font-semibold flex items-center justify-center gap-2 mb-3 transition-all"
                  style={{
                    border: "1px solid #f472b633",
                    background: loadingDraft ? "#1e293b" : "#f472b618",
                    color: loadingDraft ? "#94a3b8" : "#f472b6", cursor: "pointer",
                  }}>
                  {loadingDraft ? <><Loader2 size={14} className="animate-spin" /> Crafting...</> : <><Sparkles size={14} /> Generate outreach</>}
                </button>
              )}

              {/* Draft */}
              {draft && (
                <div ref={draftRef} className="slide-up mb-3">
                  <div className="p-4 rounded-xl" style={{ border: "1px solid #6366f133", background: "#6366f108" }}>
                    <div className="flex items-center gap-1.5 mb-3">
                      <Mail size={14} color="#818cf8" />
                      <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#818cf8" }}>Draft ready</span>
                      <button onClick={() => generateOutreach(selected)}
                        className="ml-auto flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-300"
                        style={{ background: "none", border: "none", cursor: "pointer" }}>
                        <RefreshCw size={11} /> Redo
                      </button>
                    </div>
                    <div className="text-xs text-slate-400 mb-1">Subject:</div>
                    <div className="text-sm font-medium text-slate-200 mb-3">{draft.subject}</div>
                    <div className="text-xs text-slate-400 mb-1">Body:</div>
                    <div className="text-[13px] text-slate-300 leading-relaxed whitespace-pre-wrap">{draft.body}</div>
                  </div>

                  <div className="mt-3 flex flex-col gap-2">
                    <input value={emailTo} onChange={e => setEmailTo(e.target.value)}
                      placeholder="Recipient email address"
                      className="w-full p-2.5 rounded-lg border border-slate-800 bg-slate-950 text-slate-100 text-[13px] outline-none focus:border-cyan-700"
                    />
                    <div className="flex gap-2">
                      <button onClick={sendEmail} disabled={!emailTo || sendingEmail}
                        className="flex-1 py-2.5 rounded-lg text-[13px] font-semibold flex items-center justify-center gap-1.5 transition-all"
                        style={{
                          background: emailTo ? "linear-gradient(135deg, #10b981, #34d399)" : "#1e293b",
                          color: emailTo ? "#020617" : "#64748b", border: "none",
                          cursor: emailTo ? "pointer" : "default",
                        }}>
                        {sendingEmail ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                        {sendingEmail ? "Sending..." : "Send via Gmail"}
                      </button>
                      <button onClick={scheduleFollowUp}
                        className="px-3 py-2.5 rounded-lg border border-slate-800 text-[13px] text-slate-400 flex items-center gap-1.5 hover:border-slate-600"
                        style={{ background: "#0f172a", cursor: "pointer" }}>
                        <Calendar size={14} />
                      </button>
                    </div>
                    <button onClick={() => navigator.clipboard?.writeText(`Subject: ${draft.subject}\n\n${draft.body}`)}
                      className="py-2 rounded-lg border border-slate-800 text-xs text-slate-500 flex items-center justify-center gap-1.5 hover:border-slate-600"
                      style={{ background: "none", cursor: "pointer" }}>
                      <Copy size={12} /> Copy to clipboard
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-16 text-slate-600">
              <MessageSquare size={36} className="mx-auto mb-4 opacity-30" />
              <p className="text-sm text-slate-500 mb-1">Select a job or signal</p>
              <p className="text-xs">Click any item to generate personalized outreach</p>
            </div>
          )}

          {/* History */}
          {history.length > 0 && (
            <div className="mt-5">
              <div className="flex items-center gap-2 mb-2.5">
                <CheckCircle size={14} color="#10b981" />
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Outreach log</span>
              </div>
              {history.map((h, i) => <HistoryItem key={i} item={h} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
