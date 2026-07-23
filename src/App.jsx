import React, { useState, useEffect, useMemo, useCallback } from "react";
import { FlaskConical, Plus, X, RefreshCw, LayoutGrid, ListChecks, Users, Trash2, Play, CheckCircle2, CircleDot, Circle, ChevronRight, ChevronDown, AlertCircle } from "lucide-react";
import { db } from "./firebase";
import { ref, onValue, set, remove } from "firebase/database";

const C = {
  bg: "#0E1613",
  bg2: "#0B120F",
  panel: "#141F1B",
  panel2: "#1A2620",
  border: "#25352E",
  borderSoft: "#1E2C26",
  text: "#E6EFE9",
  textMuted: "#93AA9E",
  textFaint: "#5B7268",
  amber: "#E5A039",
  amberDim: "#4A3A1E",
  green: "#4BB784",
  greenDim: "#1E3A2C",
  gray: "#516259",
  cyan: "#3ED8C4",
  red: "#D9695A",
};

const STATUS = { WAIT: "Waiting", RUN: "Running", DONE: "Complete" };

function nowHM() {
  return new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", hour12: false });
}
function nowTS() {
  return Date.now();
}
function uid() {
  return Math.random().toString(36).slice(2, 10);
}
function genJobNo(existingCount) {
  const d = new Date();
  const yy = String(d.getFullYear() + 543).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const seq = String(existingCount + 1).padStart(3, "0");
  return `LAB${yy}${mm}${seq}`;
}

function statColor(status) {
  if (status === STATUS.DONE) return C.green;
  if (status === STATUS.RUN) return C.amber;
  return C.gray;
}

function computeJobStats(job) {
  const total = job.parameters.length;
  const complete = job.parameters.filter((p) => p.status === STATUS.DONE).length;
  const running = job.parameters.filter((p) => p.status === STATUS.RUN).length;
  const progress = total === 0 ? 0 : Math.round((complete / total) * 100);
  const status = total > 0 && complete === total ? STATUS.DONE : running > 0 ? STATUS.RUN : STATUS.WAIT;
  return { total, complete, running, progress, status };
}

function computeAnalysts(jobs) {
  const map = {};
  for (const job of jobs) {
    for (const p of job.parameters) {
      if (!p.analyst) continue;
      if (!map[p.analyst]) {
        map[p.analyst] = { name: p.analyst, currentJob: null, currentParam: null, started: null, lastUpdate: 0, queue: 0 };
      }
      const a = map[p.analyst];
      if (p.status === STATUS.WAIT) a.queue += 1;
      if (p.status === STATUS.RUN) {
        if (!a.started || (p.startTs || 0) > a.started) {
          a.currentJob = job.jobNo;
          a.currentParam = p.name;
          a.started = p.startTs || 0;
          a.startedLabel = p.start;
        }
      }
      if ((p.updatedTs || 0) > a.lastUpdate) {
        a.lastUpdate = p.updatedTs || 0;
        a.lastUpdateLabel = p.updatedLabel || "-";
      }
    }
  }
  return Object.values(map).sort((x, y) => x.name.localeCompare(y.name, "th"));
}

function StatusGlyph({ status, size = 15 }) {
  if (status === STATUS.DONE) return <CheckCircle2 size={size} color={C.green} strokeWidth={2} />;
  if (status === STATUS.RUN) return <CircleDot size={size} color={C.amber} strokeWidth={2} />;
  return <Circle size={size} color={C.textFaint} strokeWidth={2} />;
}

function LedBar({ parameters }) {
  return (
    <div style={{ display: "flex", gap: 3 }}>
      {parameters.map((p) => (
        <div
          key={p.id}
          title={`${p.name}: ${p.status}`}
          style={{
            flex: 1,
            height: 8,
            borderRadius: 2,
            background: statColor(p.status),
            opacity: p.status === STATUS.WAIT ? 0.4 : 1,
          }}
        />
      ))}
    </div>
  );
}

function Badge({ children, color, bg }) {
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: 0.3,
        padding: "2px 8px",
        borderRadius: 3,
        color,
        background: bg,
        fontFamily: "monospace",
        textTransform: "uppercase",
      }}
    >
      {children}
    </span>
  );
}

function StatusBadge({ status }) {
  if (status === STATUS.DONE) return <Badge color={C.green} bg={C.greenDim}>Complete</Badge>;
  if (status === STATUS.RUN) return <Badge color={C.amber} bg={C.amberDim}>Running</Badge>;
  return <Badge color={C.textMuted} bg={C.panel2}>Waiting</Badge>;
}

function Btn({ children, onClick, kind = "default", small, disabled, title }) {
  const styles = {
    default: { bg: "transparent", border: C.border, color: C.text },
    primary: { bg: C.cyan, border: C.cyan, color: "#04211C" },
    danger: { bg: "transparent", border: C.red, color: C.red },
    amber: { bg: C.amber, border: C.amber, color: "#3A2A05" },
    green: { bg: C.green, border: C.green, color: "#08281B" },
  };
  const s = styles[kind];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        background: s.bg,
        border: `1px solid ${s.border}`,
        color: s.color,
        borderRadius: 5,
        padding: small ? "4px 9px" : "7px 14px",
        fontSize: small ? 12 : 13,
        fontWeight: 600,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.4 : 1,
        fontFamily: "inherit",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

function Panel({ children, style }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, ...style }}>
      {children}
    </div>
  );
}

// ---------- storage (Firebase Realtime Database) ----------
// All jobs live under the "jobs/{jobNo}" path. We subscribe with onValue
// in the App component so every connected user sees updates live.
function subscribeJobs(callback, onError) {
  const jobsRef = ref(db, "jobs");
  return onValue(
    jobsRef,
    (snapshot) => {
      const val = snapshot.val() || {};
      const jobs = Object.values(val);
      jobs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      callback(jobs);
    },
    (err) => onError && onError(err)
  );
}
async function saveJob(job) {
  await set(ref(db, `jobs/${job.jobNo}`), job);
}
async function deleteJobStorage(jobNo) {
  await remove(ref(db, `jobs/${jobNo}`));
}

// ---------- New Job Form ----------
function NewJobForm({ onCancel, onCreate, suggestedNo, knownAnalysts }) {
  const [jobNo, setJobNo] = useState(suggestedNo);
  const [sample, setSample] = useState("");
  const [rows, setRows] = useState([
    { id: uid(), name: "", analyst: "" },
    { id: uid(), name: "", analyst: "" },
  ]);

  const updateRow = (id, field, val) => {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, [field]: val } : r)));
  };
  const addRow = () => setRows((rs) => [...rs, { id: uid(), name: "", analyst: "" }]);
  const removeRow = (id) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.id !== id) : rs));

  const canSubmit = jobNo.trim() && rows.some((r) => r.name.trim());

  const submit = () => {
    const parameters = rows
      .filter((r) => r.name.trim())
      .map((r) => ({
        id: uid(),
        name: r.name.trim(),
        analyst: r.analyst.trim(),
        status: STATUS.WAIT,
        start: null,
        finish: null,
        startTs: null,
        updatedTs: nowTS(),
        updatedLabel: nowHM(),
      }));
    onCreate({ jobNo: jobNo.trim(), sample: sample.trim(), createdAt: nowTS(), parameters });
  };

  const inputStyle = {
    background: C.bg2,
    border: `1px solid ${C.border}`,
    color: C.text,
    borderRadius: 5,
    padding: "7px 9px",
    fontSize: 13,
    fontFamily: "inherit",
    width: "100%",
    outline: "none",
  };

  return (
    <Panel style={{ padding: 18, marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.text, display: "flex", alignItems: "center", gap: 8 }}>
          <FlaskConical size={16} color={C.cyan} />
          สร้างรหัสงานใหม่
        </div>
        <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", color: C.textMuted }}>
          <X size={18} />
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
        <div>
          <label style={{ fontSize: 11, color: C.textMuted, display: "block", marginBottom: 4 }}>รหัสงาน (Job No)</label>
          <input style={{ ...inputStyle, fontFamily: "monospace" }} value={jobNo} onChange={(e) => setJobNo(e.target.value)} />
        </div>
        <div>
          <label style={{ fontSize: 11, color: C.textMuted, display: "block", marginBottom: 4 }}>ตัวอย่าง (Sample)</label>
          <input style={inputStyle} value={sample} onChange={(e) => setSample(e.target.value)} placeholder="Soil-01" />
        </div>
      </div>

      <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
        พารามิเตอร์ ({rows.filter((r) => r.name.trim()).length})
      </div>
      <datalist id="analyst-list">
        {knownAnalysts.map((a) => <option key={a} value={a} />)}
      </datalist>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
        {rows.map((r, i) => (
          <div key={r.id} style={{ display: "grid", gridTemplateColumns: "20px 1.5fr 1fr 26px", gap: 8, alignItems: "center" }}>
            <div style={{ fontSize: 11, color: C.textFaint, fontFamily: "monospace" }}>{i + 1}</div>
            <input style={inputStyle} placeholder="พารามิเตอร์ เช่น pH" value={r.name} onChange={(e) => updateRow(r.id, "name", e.target.value)} />
            <input style={inputStyle} placeholder="ผู้วิเคราะห์" list="analyst-list" value={r.analyst} onChange={(e) => updateRow(r.id, "analyst", e.target.value)} />
            <button onClick={() => removeRow(r.id)} style={{ background: "none", border: "none", cursor: "pointer", color: C.textFaint }}>
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Btn small onClick={addRow}><Plus size={14} /> เพิ่มพารามิเตอร์</Btn>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn onClick={onCancel}>ยกเลิก</Btn>
          <Btn kind="primary" onClick={submit} disabled={!canSubmit}>บันทึกรหัสงาน</Btn>
        </div>
      </div>
    </Panel>
  );
}

// ---------- Job Detail ----------
function JobDetail({ job, onBack, onUpdateParam, onDeleteJob }) {
  const stats = computeJobStats(job);
  return (
    <Panel style={{ padding: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
        <div>
          <button onClick={onBack} style={{ background: "none", border: "none", color: C.textMuted, fontSize: 12, cursor: "pointer", padding: 0, marginBottom: 8 }}>
            ‹ กลับไปที่รายการรหัสงาน
          </button>
          <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "monospace", color: C.text, letterSpacing: 0.5 }}>{job.jobNo}</div>
          <div style={{ fontSize: 13, color: C.textMuted, marginTop: 2 }}>
            {job.sample || "-"}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <StatusBadge status={stats.status} />
          <div style={{ fontSize: 22, fontWeight: 700, color: C.text, marginTop: 6, fontFamily: "monospace" }}>{stats.progress}%</div>
          <div style={{ fontSize: 11, color: C.textMuted }}>{stats.complete} / {stats.total} parameters</div>
        </div>
      </div>

      <div style={{ margin: "14px 0 18px" }}>
        <LedBar parameters={job.parameters} />
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
              {["", "Parameter", "Analyst", "Status", "Start", "Finish", ""].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "6px 8px", color: C.textMuted, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {job.parameters.map((p) => (
              <tr key={p.id} style={{ borderBottom: `1px solid ${C.borderSoft}` }}>
                <td style={{ padding: "8px" }}><StatusGlyph status={p.status} /></td>
                <td style={{ padding: "8px", fontWeight: 600, color: C.text }}>{p.name}</td>
                <td style={{ padding: "8px", color: C.textMuted }}>{p.analyst || "-"}</td>
                <td style={{ padding: "8px" }}><StatusBadge status={p.status} /></td>
                <td style={{ padding: "8px", color: C.textMuted, fontFamily: "monospace" }}>{p.start || "-"}</td>
                <td style={{ padding: "8px", color: C.textMuted, fontFamily: "monospace" }}>{p.finish || "-"}</td>
                <td style={{ padding: "8px" }}>
                  <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                    {p.status === STATUS.WAIT && (
                      <Btn small kind="amber" onClick={() => onUpdateParam(job.jobNo, p.id, "start")}><Play size={12} /> เริ่ม</Btn>
                    )}
                    {p.status === STATUS.RUN && (
                      <Btn small kind="green" onClick={() => onUpdateParam(job.jobNo, p.id, "complete")}><CheckCircle2 size={12} /> เสร็จ</Btn>
                    )}
                    {p.status === STATUS.DONE && (
                      <Btn small onClick={() => onUpdateParam(job.jobNo, p.id, "reset")}>ยกเลิก</Btn>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 18, display: "flex", justifyContent: "flex-end" }}>
        <Btn kind="danger" small onClick={() => onDeleteJob(job.jobNo)}><Trash2 size={13} /> ลบรหัสงานนี้</Btn>
      </div>
    </Panel>
  );
}

// ---------- Jobs List ----------
function JobsList({ jobs, onOpen }) {
  return (
    <Panel style={{ overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
              {["Job No", "Sample", "Params", "Complete", "Progress", "Status", ""].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "10px 12px", color: C.textMuted, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => {
              const stats = computeJobStats(job);
              return (
                <tr key={job.jobNo} onClick={() => onOpen(job.jobNo)} style={{ borderBottom: `1px solid ${C.borderSoft}`, cursor: "pointer" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = C.panel2)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <td style={{ padding: "10px 12px", fontFamily: "monospace", fontWeight: 700, color: C.cyan }}>{job.jobNo}</td>
                  <td style={{ padding: "10px 12px", color: C.text }}>{job.sample || "-"}</td>
                  <td style={{ padding: "10px 12px", color: C.textMuted, fontFamily: "monospace" }}>{stats.total}</td>
                  <td style={{ padding: "10px 12px", color: C.textMuted, fontFamily: "monospace" }}>{stats.complete}</td>
                  <td style={{ padding: "10px 12px", width: 140 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ flex: 1 }}><LedBar parameters={job.parameters} /></div>
                      <span style={{ fontFamily: "monospace", fontSize: 12, color: C.textMuted, minWidth: 32, textAlign: "right" }}>{stats.progress}%</span>
                    </div>
                  </td>
                  <td style={{ padding: "10px 12px" }}><StatusBadge status={stats.status} /></td>
                  <td style={{ padding: "10px 12px" }}><ChevronRight size={15} color={C.textFaint} /></td>
                </tr>
              );
            })}
            {jobs.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 30, textAlign: "center", color: C.textFaint }}>ยังไม่มีรหัสงาน</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

// ---------- Analysts Tab ----------
function AnalystsTable({ analysts }) {
  return (
    <Panel style={{ overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
              {["Analyst", "Current Job", "Current Parameter", "Started", "Last Update", "Queue"].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "10px 12px", color: C.textMuted, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {analysts.map((a) => (
              <tr key={a.name} style={{ borderBottom: `1px solid ${C.borderSoft}` }}>
                <td style={{ padding: "10px 12px", fontWeight: 700, color: C.text }}>{a.name}</td>
                <td style={{ padding: "10px 12px", fontFamily: "monospace", color: a.currentJob ? C.cyan : C.textFaint }}>{a.currentJob || "ว่าง"}</td>
                <td style={{ padding: "10px 12px", color: C.text }}>
                  {a.currentParam ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <CircleDot size={13} color={C.amber} /> {a.currentParam}
                    </span>
                  ) : "-"}
                </td>
                <td style={{ padding: "10px 12px", color: C.textMuted, fontFamily: "monospace" }}>{a.startedLabel || "-"}</td>
                <td style={{ padding: "10px 12px", color: C.textMuted, fontFamily: "monospace" }}>{a.lastUpdateLabel || "-"}</td>
                <td style={{ padding: "10px 12px" }}>
                  <Badge color={a.queue > 0 ? C.amber : C.textMuted} bg={a.queue > 0 ? C.amberDim : C.panel2}>{a.queue} เหลือ</Badge>
                </td>
              </tr>
            ))}
            {analysts.length === 0 && (
              <tr><td colSpan={6} style={{ padding: 30, textAlign: "center", color: C.textFaint }}>ยังไม่มีข้อมูลผู้วิเคราะห์</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

// ---------- Dashboard ----------
function Dashboard({ jobs, analysts, onOpen }) {
  const allParams = jobs.flatMap((j) => j.parameters);
  const running = allParams.filter((p) => p.status === STATUS.RUN).length;
  const complete = allParams.filter((p) => p.status === STATUS.DONE).length;
  const pending = allParams.filter((p) => p.status === STATUS.WAIT).length;
  const activeJobs = jobs.filter((j) => computeJobStats(j).status !== STATUS.DONE);

  const metric = (label, value, color) => (
    <div style={{ flex: 1, background: C.panel2, borderRadius: 6, padding: "14px 16px" }}>
      <div style={{ fontSize: 11, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, fontFamily: "monospace", color }}>{value}</div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", gap: 12 }}>
        {metric("Running Jobs", jobs.filter(j => computeJobStats(j).status === STATUS.RUN).length, C.amber)}
        {metric("Running Params", running, C.amber)}
        {metric("Completed Params", complete, C.green)}
        {metric("Pending Params", pending, C.textMuted)}
      </div>

      <Panel style={{ padding: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 }}>
          งานที่กำลังดำเนินการ
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {activeJobs.slice(0, 8).map((job) => {
            const stats = computeJobStats(job);
            return (
              <div key={job.jobNo} onClick={() => onOpen(job.jobNo)} style={{ cursor: "pointer", paddingBottom: 12, borderBottom: `1px solid ${C.borderSoft}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontFamily: "monospace", fontWeight: 700, color: C.cyan, fontSize: 14 }}>{job.jobNo}</span>
                  <span style={{ fontFamily: "monospace", fontSize: 13, color: C.textMuted }}>{stats.progress}%</span>
                </div>
                <LedBar parameters={job.parameters} />
                <div style={{ display: "flex", gap: 12, marginTop: 6, flexWrap: "wrap" }}>
                  {job.parameters.map((p) => (
                    <span key={p.id} style={{ fontSize: 11, color: statColor(p.status), display: "inline-flex", alignItems: "center", gap: 3 }}>
                      <StatusGlyph status={p.status} size={11} /> {p.name}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
          {activeJobs.length === 0 && <div style={{ color: C.textFaint, fontSize: 13 }}>ไม่มีงานที่กำลังดำเนินการ</div>}
        </div>
      </Panel>

      <Panel style={{ padding: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 }}>
          Current Analysts
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {analysts.map((a, i) => (
            <div key={a.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderTop: i > 0 ? `1px solid ${C.borderSoft}` : "none" }}>
              <div style={{ fontWeight: 600, color: C.text, fontSize: 13 }}>{a.name}</div>
              <div style={{ fontSize: 13, color: a.currentParam ? C.amber : C.textFaint, display: "flex", alignItems: "center", gap: 6 }}>
                {a.currentParam ? <><CircleDot size={12} /> {a.currentParam}</> : "ว่าง"}
              </div>
              <div style={{ fontSize: 12, color: C.textMuted, fontFamily: "monospace" }}>เหลือ {a.queue}</div>
            </div>
          ))}
          {analysts.length === 0 && <div style={{ color: C.textFaint, fontSize: 13 }}>ยังไม่มีข้อมูลผู้วิเคราะห์</div>}
        </div>
      </Panel>
    </div>
  );
}

// ---------- Main App ----------
export default function App() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("dashboard");
  const [selected, setSelected] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const unsubscribe = subscribeJobs(
      (data) => {
        setJobs(data);
        setLoading(false);
        setError(null);
      },
      () => {
        setError("เชื่อมต่อฐานข้อมูลไม่สำเร็จ ตรวจสอบ Firebase config และ Rules");
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, []);

  // Data is live via onValue, so "refresh" just re-affirms the connection —
  // kept mainly so the button still gives visible feedback.
  const refresh = useCallback(() => {
    setLoading(true);
    setTimeout(() => setLoading(false), 300);
  }, []);

  const analysts = useMemo(() => computeAnalysts(jobs), [jobs]);
  const knownAnalysts = useMemo(() => [...new Set(jobs.flatMap(j => j.parameters.map(p => p.analyst).filter(Boolean)))], [jobs]);

  // Note: we don't need to manually update local state after these calls —
  // the onValue subscription above fires as soon as Firebase confirms the
  // write, for every connected user (including this one).
  const handleCreate = async (job) => {
    setShowForm(false);
    try {
      await saveJob(job);
    } catch (e) {
      setError("บันทึกรหัสงานไม่สำเร็จ");
    }
  };

  const handleUpdateParam = async (jobNo, paramId, action) => {
    const job = jobs.find((j) => j.jobNo === jobNo);
    if (!job) return;
    const parameters = job.parameters.map((p) => {
      if (p.id !== paramId) return p;
      if (action === "start") return { ...p, status: STATUS.RUN, start: nowHM(), startTs: nowTS(), updatedTs: nowTS(), updatedLabel: nowHM() };
      if (action === "complete") return { ...p, status: STATUS.DONE, finish: nowHM(), updatedTs: nowTS(), updatedLabel: nowHM() };
      if (action === "reset") return { ...p, status: STATUS.WAIT, start: null, finish: null, startTs: null, updatedTs: nowTS(), updatedLabel: nowHM() };
      return p;
    });
    try {
      await saveJob({ ...job, parameters });
    } catch (e) {
      setError("อัปเดตสถานะไม่สำเร็จ");
    }
  };

  const handleDeleteJob = async (jobNo) => {
    setSelected(null);
    setTab("jobs");
    try {
      await deleteJobStorage(jobNo);
    } catch (e) {
      setError("ลบรหัสงานไม่สำเร็จ");
    }
  };

  const openJob = (jobNo) => { setSelected(jobNo); setTab("jobs"); };
  const selectedJob = jobs.find((j) => j.jobNo === selected);

  const tabBtn = (key, label, Icon) => (
    <button
      onClick={() => { setTab(key); setSelected(null); }}
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
    <div style={{ background: C.bg, minHeight: 500, borderRadius: 10, fontFamily: "system-ui, sans-serif", color: C.text, padding: 0, border: `1px solid ${C.borderSoft}` }}>
      <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.borderSoft}`, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <div style={{ width: 30, height: 30, borderRadius: 6, background: C.greenDim, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <FlaskConical size={17} color={C.cyan} />
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Lab Analysis Tracker</div>
            <div style={{ fontSize: 11, color: C.textFaint }}>ระบบติดตามความคืบหน้างานวิเคราะห์ · แชร์ร่วมกันทั้งทีม</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn small onClick={refresh}><RefreshCw size={13} /> รีเฟรช</Btn>
          <Btn kind="primary" small onClick={() => { setShowForm(true); setTab("jobs"); setSelected(null); }}><Plus size={13} /> สร้างรหัสงาน</Btn>
        </div>
      </div>

      <div style={{ display: "flex", borderBottom: `1px solid ${C.borderSoft}`, padding: "0 12px" }}>
        {tabBtn("dashboard", "Dashboard", LayoutGrid)}
        {tabBtn("jobs", "Jobs", ListChecks)}
        {tabBtn("analysts", "Analysts", Users)}
      </div>

      <div style={{ padding: 20 }}>
        {error && (
          <div style={{ marginBottom: 14, padding: "8px 12px", background: "#3A1E1E", border: `1px solid ${C.red}`, borderRadius: 6, color: "#F0B8B0", fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}>
            <AlertCircle size={14} /> {error}
          </div>
        )}
        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: C.textFaint }}>กำลังโหลดข้อมูล...</div>
        ) : (
          <>
            {tab === "dashboard" && <Dashboard jobs={jobs} analysts={analysts} onOpen={openJob} />}
            {tab === "jobs" && (
              <>
                {showForm && (
                  <NewJobForm
                    onCancel={() => setShowForm(false)}
                    onCreate={handleCreate}
                    suggestedNo={genJobNo(jobs.length)}
                    knownAnalysts={knownAnalysts}
                  />
                )}
                {selectedJob ? (
                  <JobDetail job={selectedJob} onBack={() => setSelected(null)} onUpdateParam={handleUpdateParam} onDeleteJob={handleDeleteJob} />
                ) : (
                  <JobsList jobs={jobs} onOpen={openJob} />
                )}
              </>
            )}
            {tab === "analysts" && <AnalystsTable analysts={analysts} />}
          </>
        )}
      </div>
    </div>
  );
}
