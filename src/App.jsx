import React, { useState, useMemo } from "react";
import {
  FlaskConical, CheckCircle2, CircleDot, Circle, AlertTriangle, Clock,
  ChevronRight, ChevronDown, LayoutGrid, Users,
} from "lucide-react";

const C = {
  bg: "#FFFFFF",
  bg2: "#F3F8FD",
  panel: "#FFFFFF",
  panel2: "#EAF3FB",
  border: "#D3E6F5",
  borderSoft: "#E4EFF9",
  text: "#0B2A4A",
  textMuted: "#5B7A96",
  textFaint: "#9BB4C9",
  amber: "#C97F0E",
  amberDim: "#FBEBD3",
  green: "#1E9E6B",
  greenDim: "#DCF3E9",
  gray: "#7E93A6",
  cyan: "#0E6FBA",
  cyanDim: "#DCEDFB",
  red: "#C6493B",
  redDim: "#FBE4E1",
};

const STATUS = { WAIT: "Waiting", RUN: "Running", DONE: "Complete" };
const STATUS_RANK = { [STATUS.DONE]: 0, [STATUS.RUN]: 1, [STATUS.WAIT]: 2 };
const DAY_MS = 24 * 60 * 60 * 1000;
const WARN_DAYS = 10;
const LATE_DAYS = 15;
const NOW = Date.now();

function daysSince(ts) {
  return Math.floor((NOW - ts) / DAY_MS);
}
function computeJobStats(job) {
  const total = job.parameters.length;
  const complete = job.parameters.filter((p) => p.status === STATUS.DONE).length;
  const running = job.parameters.filter((p) => p.status === STATUS.RUN).length;
  const progress = total === 0 ? 0 : Math.round((complete / total) * 100);
  const status = total > 0 && complete === total ? STATUS.DONE : running > 0 ? STATUS.RUN : STATUS.WAIT;
  return { total, complete, running, progress, status };
}
function deadlineInfo(job) {
  const days = daysSince(job.createdAt);
  const done = computeJobStats(job).status === STATUS.DONE;
  if (done) return { level: "done", days };
  if (days >= LATE_DAYS) return { level: "late", days };
  if (days >= WARN_DAYS) return { level: "warn", days };
  return { level: "ok", days };
}
function statColor(status) {
  if (status === STATUS.DONE) return C.green;
  if (status === STATUS.RUN) return C.amber;
  return C.borderSoft;
}

// ---- mock data (same shape as the real job records, with an analyst per parameter) ----
const mkParam = (name, status, analyst) => ({ id: `${name}`, name, status, analyst: analyst || null });
const jobs = [
  {
    jobNo: "RD26-00514", sample: "Sugarcane", createdAt: NOW - 12 * DAY_MS,
    regStart: "05341", regEnd: "05420", sampleCount: 80,
    parameters: [
      mkParam("Pol", STATUS.DONE, "วรวิทย์"),
      mkParam("Brix", STATUS.DONE, "วรวิทย์"),
      mkParam("Purity", STATUS.DONE, "สมหมาย"),
      mkParam("Fiber", STATUS.DONE, "สมหมาย"),
      mkParam("CCS", STATUS.WAIT, "นก"),
    ],
  },
  {
    jobNo: "RD26-00527", sample: "Soil", createdAt: NOW,
    regStart: "05171", regEnd: "05230", sampleCount: 60,
    parameters: [
      mkParam("AW (Water Activity)", STATUS.DONE, "เอกชัย"),
      mkParam("ความชื้น", STATUS.DONE, "เอกชัย"),
      mkParam("Sucrose", STATUS.DONE, "ตุ๊กแก"),
      mkParam("Conductivity Ash", STATUS.RUN, "ตุ๊กแก"),
      mkParam("Color-Lab*", STATUS.RUN, "นก"),
      mkParam("Color-ICUMSA", STATUS.WAIT, "นก"),
      mkParam("Pol", STATUS.WAIT, "วรวิทย์"),
      mkParam("E. coli / Coliform (EC)", STATUS.WAIT, "แพด"),
      mkParam("Total plate count (TC)", STATUS.WAIT, "แพด"),
      mkParam("Yeast & Mold (YM)", STATUS.WAIT, "มุ้น"),
    ],
  },
  {
    jobNo: "RD26-00526", sample: "Soil", createdAt: NOW,
    regStart: "05231", regEnd: "05255", sampleCount: 25,
    parameters: [
      mkParam("AW (Water Activity)", STATUS.DONE, "เอกชัย"),
      mkParam("Color-Lab*", STATUS.RUN, "นก"),
      mkParam("Brix", STATUS.WAIT, "วรวิทย์"),
      mkParam("pH", STATUS.WAIT, "มุ้น"),
    ],
  },
  {
    jobNo: "RD26-00524", sample: "Water", createdAt: NOW - 7 * DAY_MS,
    regStart: "05256", regEnd: "05295", sampleCount: 40,
    parameters: [
      mkParam("ของแข็งละลายทั้งหมด (TDS)", STATUS.DONE, "สมหมาย"),
      mkParam("ความขุ่น", STATUS.DONE, "สมหมาย"),
      mkParam("Total ICP-A", STATUS.RUN, "พาน"),
      mkParam("Cl", STATUS.RUN, "พาน"),
      mkParam("EC", STATUS.DONE, "กมลวรรณ"),
      mkParam("pH", STATUS.DONE, "กมลวรรณ"),
      mkParam("Total P", STATUS.WAIT, "พาน"),
      mkParam("Total N (NH4, NO3)", STATUS.WAIT, "มุ้น"),
    ],
  },
  {
    jobNo: "RD26-00523", sample: "Soil", createdAt: NOW - 8 * DAY_MS,
    regStart: "05296", regEnd: "05325", sampleCount: 30,
    parameters: [
      mkParam("Extractable ICP-A", STATUS.WAIT, "พาน"),
      mkParam("Extractable ICP-B", STATUS.WAIT, "พาน"),
      mkParam("Available P", STATUS.DONE, "กมลวรรณ"),
      mkParam("OM (Organic matter)", STATUS.DONE, "กมลวรรณ"),
      mkParam("Total N (Kjeldahl Method)", STATUS.WAIT, "มุ้น"),
    ],
  },
  {
    jobNo: "RD26-00518", sample: "Soil", createdAt: NOW - 10 * DAY_MS,
    regStart: "05326", regEnd: "05340", sampleCount: 15,
    parameters: [
      mkParam("ความชื้น", STATUS.WAIT, "ตุ๊ก"),
      mkParam("Sulfated ash", STATUS.RUN, "ตุ๊ก"),
      mkParam("Total N (Kjeldahl Method)", STATUS.WAIT, "มุ้น"),
    ],
  },
  {
    jobNo: "RD26-00510", sample: "Molasses", createdAt: NOW - 5 * DAY_MS,
    regStart: "05100", regEnd: "05105", sampleCount: 6,
    parameters: [
      mkParam("Sulfated ash", STATUS.RUN, "ตุ๊ก"),
      mkParam("Brix", STATUS.DONE, "วรวิทย์"),
    ],
  },
  {
    jobNo: "RD26-00498", sample: "Soil", createdAt: NOW - 14 * DAY_MS,
    regStart: "04980", regEnd: "05010", sampleCount: 31,
    parameters: [
      mkParam("Total P", STATUS.RUN, "พาน"),
      mkParam("OM (Organic matter)", STATUS.DONE, "กมลวรรณ"),
    ],
  },
];

// ---------- shared bits ----------
function StatusGlyph({ status, size = 12 }) {
  if (status === STATUS.DONE) return <CheckCircle2 size={size} color={C.green} strokeWidth={2} />;
  if (status === STATUS.RUN) return <CircleDot size={size} color={C.amber} strokeWidth={2} />;
  return <Circle size={size} color={C.textFaint} strokeWidth={2} />;
}

// Segments always render complete -> running -> waiting, left to right,
// regardless of the order parameters were added in. Same visual grammar
// on every bar in the app, so progress is comparable at a glance.
function ProgressBar({ job }) {
  const ordered = [...job.parameters].sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status]);
  return (
    <div style={{ display: "flex", height: 7, borderRadius: 4, overflow: "hidden", background: C.panel2, border: `1px solid ${C.borderSoft}` }}>
      {ordered.map((p) => (
        <div key={p.id} style={{ flex: 1, background: statColor(p.status) }} />
      ))}
    </div>
  );
}

function DeadlinePill({ job }) {
  const { level, days } = deadlineInfo(job);
  if (level === "done") {
    return <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 600, color: C.green }}><CheckCircle2 size={12} /> เสร็จสมบูรณ์</span>;
  }
  if (level === "late") {
    return <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 600, color: C.red, background: C.redDim, padding: "3px 8px", borderRadius: 5 }}><AlertTriangle size={12} /> ล่าช้า {days} วัน</span>;
  }
  if (level === "warn") {
    return <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 600, color: C.amber, background: C.amberDim, padding: "3px 8px", borderRadius: 5 }}><Clock size={12} /> ใกล้ครบกำหนด · เหลือ {LATE_DAYS - days} วัน</span>;
  }
  return <span style={{ fontSize: 11.5, color: C.textMuted, fontFamily: "monospace" }}>{days} วัน</span>;
}

function MetricCard({ label, value, color, icon: Icon }) {
  return (
    <div style={{ flex: 1, background: C.panel2, borderRadius: 8, padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        {Icon && <Icon size={13} color={color} />}
        <div style={{ fontSize: 11, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 600 }}>{label}</div>
      </div>
      <div style={{ fontSize: 25, fontWeight: 700, fontFamily: "monospace", color }}>{value}</div>
    </div>
  );
}

function JobRow({ job }) {
  const stats = computeJobStats(job);
  const visible = job.parameters.slice(0, 6);
  const rest = job.parameters.length - visible.length;
  return (
    <div style={{ padding: "14px 4px", borderBottom: `1px solid ${C.borderSoft}`, cursor: "pointer" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <span style={{ fontFamily: "monospace", fontWeight: 700, color: C.cyan, fontSize: 14 }}>{job.jobNo}</span>
          <span style={{ fontSize: 12, background: C.panel2, color: C.textMuted, padding: "2px 8px", borderRadius: 4, fontWeight: 600 }}>{job.sample}</span>
          <span style={{ fontSize: 11.5, color: C.textFaint, fontFamily: "monospace" }}>{job.regStart}–{job.regEnd} ({job.sampleCount})</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
          <DeadlinePill job={job} />
          <span style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: C.text, minWidth: 34, textAlign: "right" }}>{stats.progress}%</span>
          <ChevronRight size={15} color={C.textFaint} />
        </div>
      </div>
      <div style={{ marginBottom: 8 }}>
        <ProgressBar job={job} />
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px" }}>
        {visible.map((p) => (
          <span key={p.id} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, color: p.status === STATUS.WAIT ? C.textFaint : C.text }}>
            <StatusGlyph status={p.status} /> {p.name}
          </span>
        ))}
        {rest > 0 && <span style={{ fontSize: 11.5, color: C.textFaint, fontStyle: "italic" }}>+{rest} พารามิเตอร์</span>}
      </div>
    </div>
  );
}

function DashboardTab() {
  const allParams = jobs.flatMap((j) => j.parameters);
  const running = allParams.filter((p) => p.status === STATUS.RUN).length;
  const complete = allParams.filter((p) => p.status === STATUS.DONE).length;
  const activeJobs = useMemo(() => [...jobs].sort((a, b) => {
    const da = deadlineInfo(a), db = deadlineInfo(b);
    const rank = { late: 0, warn: 1, ok: 2, done: 3 };
    if (rank[da.level] !== rank[db.level]) return rank[da.level] - rank[db.level];
    return b.createdAt - a.createdAt;
  }), []);
  const lateCount = jobs.filter((j) => deadlineInfo(j).level === "late").length;
  const dueSoonCount = jobs.filter((j) => deadlineInfo(j).level === "warn").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <MetricCard label="งานทั้งหมด" value={jobs.length} color={C.text} />
        <MetricCard label="กำลังดำเนินการ" value={running} color={C.amber} icon={CircleDot} />
        <MetricCard label="เสร็จสิ้นแล้ว" value={complete} color={C.green} icon={CheckCircle2} />
        <MetricCard label="ใกล้ครบกำหนด" value={dueSoonCount} color={C.amber} icon={Clock} />
        <MetricCard label="ล่าช้า (15+ วัน)" value={lateCount} color={C.red} icon={AlertTriangle} />
      </div>
      <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 16px" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.5, padding: "10px 4px 2px" }}>
          งานที่กำลังดำเนินการ — เรียงตามความเร่งด่วน
        </div>
        {activeJobs.map((job) => <JobRow key={job.jobNo} job={job} />)}
      </div>
    </div>
  );
}

// ---------- Analysts tab: queue split into running vs not-yet-started ----------
function computeAnalysts(jobsData) {
  const map = {};
  for (const job of jobsData) {
    for (const p of job.parameters) {
      if (!p.analyst) continue;
      if (!map[p.analyst]) map[p.analyst] = { name: p.analyst, running: [], waiting: [], done: [] };
      const row = { ...p, jobNo: job.jobNo, sample: job.sample };
      if (p.status === STATUS.RUN) map[p.analyst].running.push(row);
      else if (p.status === STATUS.WAIT) map[p.analyst].waiting.push(row);
      else map[p.analyst].done.push(row);
    }
  }
  return Object.values(map).sort((a, b) => a.name.localeCompare(b, "th"));
}

function QueueRow({ p, onOpenJob, tone }) {
  return (
    <div
      onClick={() => onOpenJob(p.jobNo)}
      style={{
        display: "grid", gridTemplateColumns: "110px 1fr 1fr 90px",
        gap: 10, alignItems: "center", padding: "8px 10px",
        background: C.panel, border: `1px solid ${C.borderSoft}`, borderRadius: 6, cursor: "pointer",
      }}
    >
      <span style={{ fontFamily: "monospace", fontWeight: 700, color: C.cyan, fontSize: 12 }}>{p.jobNo}</span>
      <span style={{ color: C.textMuted, fontSize: 12 }}>{p.sample || "-"}</span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: C.text, fontSize: 13, fontWeight: 600 }}>
        <StatusGlyph status={p.status} /> {p.name}
      </span>
      <span style={{ fontSize: 11.5, fontWeight: 700, color: tone === "amber" ? C.amber : C.textMuted }}>
        {tone === "amber" ? "กำลังวิเคราะห์" : "รอคิว"}
      </span>
    </div>
  );
}

function AnalystRow({ a, onOpenJob }) {
  const [open, setOpen] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const current = a.running[0];
  return (
    <div style={{ borderBottom: `1px solid ${C.borderSoft}` }}>
      <div
        onClick={() => setOpen((v) => !v)}
        style={{ display: "grid", gridTemplateColumns: "20px 1.2fr 1fr 1.4fr 90px", gap: 10, alignItems: "center", padding: "12px 10px", cursor: "pointer" }}
      >
        {open ? <ChevronDown size={15} color={C.textFaint} /> : <ChevronRight size={15} color={C.textFaint} />}
        <span style={{ fontWeight: 700, color: C.text, fontSize: 13.5 }}>{a.name}</span>
        <span style={{ fontFamily: "monospace", color: current ? C.cyan : C.textFaint, fontSize: 12.5 }}>{current ? current.jobNo : "ว่าง"}</span>
        <span style={{ fontSize: 13, color: C.text, display: "flex", alignItems: "center", gap: 6 }}>
          {current ? <><CircleDot size={12} color={C.amber} /> {current.name}</> : "-"}
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          {a.running.length > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: C.amber, background: C.amberDim, padding: "2px 8px", borderRadius: 4 }}>{a.running.length} กำลังทำ</span>}
        </div>
      </div>
      {open && (
        <div style={{ padding: "4px 12px 16px 42px", background: C.bg2 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.amber, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
                <CircleDot size={12} /> เข้าคิววิเคราะห์แล้ว ({a.running.length})
              </div>
              {a.running.length === 0 ? (
                <div style={{ color: C.textFaint, fontSize: 12.5 }}>ไม่มีงานที่กำลังวิเคราะห์อยู่</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {a.running.map((p) => <QueueRow key={`${p.jobNo}-${p.id}`} p={p} onOpenJob={onOpenJob} tone="amber" />)}
                </div>
              )}
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
                <Circle size={12} /> ยังไม่เข้าคิว ({a.waiting.length})
              </div>
              {a.waiting.length === 0 ? (
                <div style={{ color: C.textFaint, fontSize: 12.5 }}>ไม่มีงานค้างคิว</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {a.waiting.map((p) => <QueueRow key={`${p.jobNo}-${p.id}`} p={p} onOpenJob={onOpenJob} tone="gray" />)}
                </div>
              )}
            </div>
            {a.done.length > 0 && (
              <div>
                <button
                  onClick={(e) => { e.stopPropagation(); setShowDone((v) => !v); }}
                  style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: 11, color: C.green, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700, fontFamily: "inherit" }}
                >
                  {showDone ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  <CheckCircle2 size={13} /> เสร็จแล้ว ({a.done.length})
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AnalystsTab() {
  const analysts = useMemo(() => computeAnalysts(jobs), []);
  const openJob = (jobNo) => {};
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden" }}>
      <div style={{ display: "grid", gridTemplateColumns: "20px 1.2fr 1fr 1.4fr 90px", gap: 10, padding: "10px 10px", borderBottom: `1px solid ${C.border}` }}>
        {["", "ผู้วิเคราะห์", "งานปัจจุบัน", "พารามิเตอร์ที่ทำอยู่", "คิว"].map((h) => (
          <span key={h} style={{ fontSize: 11, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 600 }}>{h}</span>
        ))}
      </div>
      {analysts.map((a) => <AnalystRow key={a.name} a={a} onOpenJob={openJob} />)}
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState("dashboard");
  const tabBtn = (key, label, Icon) => (
    <button
      onClick={() => setTab(key)}
      style={{
        display: "flex", alignItems: "center", gap: 7,
        background: tab === key ? C.panel2 : "transparent",
        border: "none", borderBottom: tab === key ? `2px solid ${C.cyan}` : "2px solid transparent",
        color: tab === key ? C.text : C.textMuted,
        padding: "10px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
      }}
    >
      <Icon size={15} /> {label}
    </button>
  );
  return (
    <div style={{ background: C.bg, minHeight: 500, borderRadius: 10, fontFamily: "'Prompt', system-ui, sans-serif", color: C.text, border: `1px solid ${C.border}`, boxShadow: "0 2px 18px rgba(14, 111, 186, 0.08)" }}>
      <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.borderSoft}`, display: "flex", alignItems: "center", gap: 9 }}>
        <div style={{ width: 30, height: 30, borderRadius: 6, background: C.cyanDim, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <FlaskConical size={17} color={C.cyan} />
        </div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Lab Analysis Tracker</div>
          <div style={{ fontSize: 11, color: C.textFaint }}>Mockup v2 — แถบสีเรียงเขียว/เหลือง/ขาว + แยกคิววิเคราะห์</div>
        </div>
      </div>
      <div style={{ display: "flex", borderBottom: `1px solid ${C.borderSoft}`, padding: "0 12px" }}>
        {tabBtn("dashboard", "Dashboard", LayoutGrid)}
        {tabBtn("analysts", "Analysts", Users)}
      </div>
      <div style={{ padding: 20 }}>
        {tab === "dashboard" ? <DashboardTab /> : <AnalystsTab />}
      </div>
    </div>
  );
}
