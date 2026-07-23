import React, { useState, useEffect, useMemo, useCallback } from "react";
import { FlaskConical, Plus, X, RefreshCw, LayoutGrid, ListChecks, Users, Layers, Trash2, Play, CheckCircle2, CircleDot, Circle, ChevronRight, ChevronDown, AlertCircle, ClipboardPaste, Sparkles } from "lucide-react";
import { db } from "./firebase";
import { ref, onValue, set, remove } from "firebase/database";

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

function nowHM() {
  return new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", hour12: false });
}
function nowTS() {
  return Date.now();
}
function uid() {
  return Math.random().toString(36).slice(2, 10);
}
const DAY_MS = 24 * 60 * 60 * 1000;
const WARN_DAYS = 10; // แจ้งเตือนเมื่อใกล้ครบกำหนด
const LATE_DAYS = 15; // ถือว่าล่าช้าเมื่อครบกำหนดนี้

function daysSince(ts) {
  if (!ts) return 0;
  return Math.floor((nowTS() - ts) / DAY_MS);
}
// Thai date, e.g. 23 ก.ค. 2569 (พ.ศ.)
function fmtDate(ts) {
  if (!ts) return "-";
  return new Date(ts).toLocaleDateString("th-TH", { day: "2-digit", month: "short", year: "numeric" });
}
// Deadline urgency for a job, based on days since creation.
// Only meaningful while the job isn't fully complete.
function deadlineInfo(job) {
  const days = daysSince(job.createdAt);
  const done = computeJobStats(job).status === STATUS.DONE;
  if (done) return { level: "done", days };
  if (days >= LATE_DAYS) return { level: "late", days };
  if (days >= WARN_DAYS) return { level: "warn", days };
  return { level: "ok", days };
}

// Converts a dd/mm/yyyy string (as printed on lab documents) to a timestamp.
function thaiDateToTs(str) {
  const m = str && str.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const ts = new Date(`${y}-${mo}-${d}T00:00:00`).getTime();
  return Number.isNaN(ts) ? null : ts;
}

// Parses text pasted from a "ใบแจกจ่ายงานวิเคราะห์ / ข้อมูลทะเบียนและรายชื่อ" document
// (or similar job-order sheet) and pulls out the job number, parameter list,
// and individual sample registration numbers/names it can recognize.
// Anything it can't find is just left blank for the user to fill in by hand.
function parseImportText(text) {
  const norm = (text || "").replace(/\r\n/g, "\n");

  const jobNoMatch = norm.match(/\b([A-Za-z]{1,5}\d{2}-\d{3,7})\b/);
  const jobNo = jobNoMatch ? jobNoMatch[1].toUpperCase() : "";

  const parameters = [...norm.matchAll(/^[•·][ \t]*(.+?)[ \t]*$/gm)]
    .map((m) => m[1].trim())
    .filter(Boolean);

  let sampleType = "";
  const typeMatch = norm.match(/ประเภทตัวอย[่]?าง[^\n]*\n[ \t]*([^\n]+)/);
  if (typeMatch) {
    // The matched line can sometimes be a full table row (e.g. "05486 05493
    // 8 น้าตาล") rather than a clean label value — strip pure-digit tokens
    // (registration numbers / counts) so only the descriptive type remains.
    sampleType = typeMatch[1]
      .split(/\s+/)
      .filter((t) => t && !/^\d+$/.test(t))
      .join(" ")
      .trim();
  }

  const rangeMatch = norm.match(/(\d{4,7})[ \t]*-[ \t]*(\d{4,7})/);
  const rangeStart = rangeMatch ? rangeMatch[1] : "";
  const rangeEnd = rangeMatch ? rangeMatch[2] : "";

  const countMatch = norm.match(/(\d+)[ \t]*ตัวอย[่]?าง[่]?/);
  const totalSamples = countMatch ? parseInt(countMatch[1], 10) : null;

  const dates = [...norm.matchAll(/(\d{2}\/\d{2}\/\d{4})/g)].map((m) => m[1]);
  const receivedDate = dates[0] || "";
  const dueDate = dates[1] || "";

  // Rows like "05486   ถุงบรรจุ 500 g D240" (registration number + sample name)
  const sampleMap = {};
  for (const m of norm.matchAll(/^(\d{5})[ \t]+([^\n\d][^\n]*)$/gm)) {
    sampleMap[m[1]] = m[2].trim();
  }
  // Standalone registration numbers with no name given
  for (const m of norm.matchAll(/^(\d{5})[ \t]*$/gm)) {
    if (!(m[1] in sampleMap)) sampleMap[m[1]] = "";
  }
  let samples = Object.entries(sampleMap).map(([code, name]) => ({ code, name }));
  if (samples.length === 0 && rangeStart && rangeEnd) {
    const start = parseInt(rangeStart, 10);
    const end = parseInt(rangeEnd, 10);
    const width = rangeStart.length;
    if (end >= start && end - start < 500) {
      for (let n = start; n <= end; n++) samples.push({ code: String(n).padStart(width, "0"), name: "" });
    }
  }
  samples.sort((a, b) => a.code.localeCompare(b.code));

  const sampleSummary = [sampleType, rangeStart && rangeEnd ? `${rangeStart}-${rangeEnd}` : "", totalSamples ? `${totalSamples} ตัวอย่าง` : ""]
    .filter(Boolean)
    .join(" · ");

  return { jobNo, parameters, samples, sampleSummary, receivedDate, dueDate };
}
// jobs are already sorted numerically descending (see subscribeJobs), so
// jobs[0] is the latest job number actually used. We bump its trailing
// number by 1, keeping the same prefix and zero-padding width.
// Falls back to the old LAB{yy}{mm}{seq} scheme if there are no jobs yet.
function genJobNo(jobs) {
  if (jobs.length > 0) {
    const latest = jobs[0].jobNo || "";
    const match = latest.match(/^(.*?)(\d+)$/);
    if (match) {
      const [, prefix, digits] = match;
      const next = String(parseInt(digits, 10) + 1).padStart(digits.length, "0");
      return `${prefix}${next}`;
    }
  }
  const d = new Date();
  const yy = String(d.getFullYear() + 543).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const seq = String(jobs.length + 1).padStart(3, "0");
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

function computeParamQueue(jobs) {
  const map = {};
  for (const job of jobs) {
    for (const p of job.parameters) {
      if (!p.name) continue;
      if (!map[p.name]) {
        map[p.name] = { name: p.name, total: 0, waiting: 0, running: 0, complete: 0, analysts: new Set() };
      }
      const g = map[p.name];
      g.total += 1;
      if (p.status === STATUS.WAIT) g.waiting += 1;
      if (p.status === STATUS.RUN) g.running += 1;
      if (p.status === STATUS.DONE) g.complete += 1;
      if (p.analyst) g.analysts.add(p.analyst);
    }
  }
  return Object.values(map)
    .map((g) => ({ ...g, analysts: [...g.analysts].sort((a, b) => a.localeCompare(b, "th")) }))
    .sort((x, y) => y.waiting + y.running - (x.waiting + x.running));
}

function paramJobs(jobs, name) {
  const rows = [];
  for (const job of jobs) {
    for (const p of job.parameters) {
      if (p.name === name) rows.push({ ...p, jobNo: job.jobNo, sample: job.sample });
    }
  }
  const order = { [STATUS.RUN]: 0, [STATUS.WAIT]: 1, [STATUS.DONE]: 2 };
  rows.sort((x, y) => (order[x.status] ?? 3) - (order[y.status] ?? 3));
  return rows;
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

// Shows how many days a job has been open, colored by deadline urgency:
// < 10 days = normal, 10-14 days = amber warning, 15+ days = red "late".
function DeadlineBadge({ job }) {
  const { level, days } = deadlineInfo(job);
  if (level === "done") return null;
  if (level === "late") return <Badge color={C.red} bg={C.redDim}>ล่าช้า {days} วัน</Badge>;
  if (level === "warn") return <Badge color={C.amber} bg={C.amberDim}>ใกล้ครบกำหนด {days} วัน</Badge>;
  return <span style={{ fontSize: 11, color: C.textFaint, fontFamily: "monospace" }}>{days} วัน</span>;
}

function Btn({ children, onClick, kind = "default", small, disabled, title }) {
  const styles = {
    default: { bg: "transparent", border: C.border, color: C.text },
    primary: { bg: C.cyan, border: C.cyan, color: "#FFFFFF" },
    danger: { bg: "transparent", border: C.red, color: C.red },
    amber: { bg: C.amber, border: C.amber, color: "#FFFFFF" },
    green: { bg: C.green, border: C.green, color: "#FFFFFF" },
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
      jobs.sort((a, b) => (b.jobNo || "").localeCompare(a.jobNo || "", undefined, { numeric: true }));
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

// ---------- New / Edit Job Form ----------
function NewJobForm({ onCancel, onCreate, onSaveEdit, suggestedNo, knownAnalysts, knownParams, knownSamples, editingJob, existingJobNos = [] }) {
  const isEdit = !!editingJob;
  const [jobNo, setJobNo] = useState(isEdit ? editingJob.jobNo : suggestedNo);
  const [sample, setSample] = useState(isEdit ? editingJob.sample || "" : "");
  const [rows, setRows] = useState(
    isEdit
      ? editingJob.parameters.map((p) => ({ id: p.id, name: p.name, analyst: p.analyst || "" }))
      : [
          { id: uid(), name: "", analyst: "" },
          { id: uid(), name: "", analyst: "" },
        ]
  );

  const updateRow = (id, field, val) => {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, [field]: val } : r)));
  };
  const addRow = () => setRows((rs) => [...rs, { id: uid(), name: "", analyst: "" }]);
  const removeRow = (id) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.id !== id) : rs));

  // Individual sample registration numbers under this job (optional — only
  // shown/used when the job actually has sub-samples, e.g. imported from a
  // lab job-order document).
  const [subsamples, setSubsamples] = useState(
    isEdit && editingJob.samples ? editingJob.samples.map((s) => ({ id: uid(), code: s.code, name: s.name || "" })) : []
  );
  const updateSubsample = (id, field, val) => setSubsamples((ss) => ss.map((s) => (s.id === id ? { ...s, [field]: val } : s)));
  const addSubsample = () => setSubsamples((ss) => [...ss, { id: uid(), code: "", name: "" }]);
  const removeSubsample = (id) => setSubsamples((ss) => ss.filter((s) => s.id !== id));

  // "Import from document" panel: paste raw text copied from a job-order
  // sheet (PDF/Word) and auto-fill job no / parameters / samples from it.
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [importInfo, setImportInfo] = useState(null);
  const [receivedTs, setReceivedTs] = useState(null);

  const handleParseImport = () => {
    const parsed = parseImportText(importText);
    const foundAnything = parsed.jobNo || parsed.parameters.length > 0 || parsed.samples.length > 0;
    if (!foundAnything) {
      setImportInfo({ ok: false, msg: "ไม่พบรหัสงาน/พารามิเตอร์/ตัวอย่างในข้อความนี้ ลองวางข้อความทั้งหมดจากเอกสารอีกครั้ง" });
      return;
    }
    if (!isEdit && parsed.jobNo) setJobNo(parsed.jobNo);
    if (parsed.sampleSummary) setSample(parsed.sampleSummary);
    if (parsed.parameters.length > 0) {
      setRows(parsed.parameters.map((name) => ({ id: uid(), name, analyst: "" })));
    }
    if (parsed.samples.length > 0) {
      setSubsamples(parsed.samples.map((s) => ({ id: uid(), code: s.code, name: s.name })));
    }
    if (!isEdit && parsed.receivedDate) setReceivedTs(thaiDateToTs(parsed.receivedDate));
    setImportInfo({
      ok: true,
      msg: `นำเข้าแล้ว — พารามิเตอร์ ${parsed.parameters.length} รายการ, ตัวอย่าง ${parsed.samples.length} รายการ ตรวจสอบและแก้ไขเพิ่มเติมได้ตามต้องการ`,
    });
  };

  const isDuplicate = !isEdit && existingJobNos.includes(jobNo.trim());
  const canSubmit = jobNo.trim() && rows.some((r) => r.name.trim()) && !isDuplicate;

  const submit = () => {
    if (isEdit) {
      const existingById = Object.fromEntries(editingJob.parameters.map((p) => [p.id, p]));
      const parameters = rows
        .filter((r) => r.name.trim())
        .map((r) => {
          const prev = existingById[r.id];
          if (prev) {
            // keep status/timestamps of parameters that already existed; just update name/analyst
            return { ...prev, name: r.name.trim(), analyst: r.analyst.trim() };
          }
          // brand-new row added during edit
          return {
            id: r.id,
            name: r.name.trim(),
            analyst: r.analyst.trim(),
            status: STATUS.WAIT,
            start: null,
            finish: null,
            startTs: null,
            updatedTs: nowTS(),
            updatedLabel: nowHM(),
          };
        });
      onSaveEdit({
        ...editingJob,
        sample: sample.trim(),
        parameters,
        samples: subsamples.filter((s) => s.code.trim()).map((s) => ({ code: s.code.trim(), name: s.name.trim() })),
      });
    } else {
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
      onCreate({
        jobNo: jobNo.trim(),
        sample: sample.trim(),
        createdAt: receivedTs || nowTS(),
        parameters,
        samples: subsamples.filter((s) => s.code.trim()).map((s) => ({ code: s.code.trim(), name: s.name.trim() })),
      });
    }
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
          {isEdit ? `แก้ไขรหัสงาน ${editingJob.jobNo}` : "สร้างรหัสงานใหม่"}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Btn small onClick={() => setShowImport((v) => !v)}>
            <ClipboardPaste size={13} /> วางข้อความจากเอกสาร
          </Btn>
          <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", color: C.textMuted }}>
            <X size={18} />
          </button>
        </div>
      </div>

      {showImport && (
        <div style={{ background: C.bg2, border: `1px dashed ${C.border}`, borderRadius: 6, padding: 12, marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 6 }}>
            วางข้อความที่คัดลอกจากใบแจกจ่ายงานวิเคราะห์ / ข้อมูลทะเบียนและรายชื่อ ระบบจะพยายามดึงรหัสงาน พารามิเตอร์ และเลขทะเบียนตัวอย่างให้อัตโนมัติ — ตรวจสอบและแก้ไขเพิ่มลดเองได้ก่อนบันทึก
          </div>
          <textarea
            value={importText}
            onChange={(e) => { setImportText(e.target.value); setImportInfo(null); }}
            placeholder="วางข้อความทั้งหมดจากเอกสารตรงนี้..."
            rows={6}
            style={{ ...inputStyle, fontFamily: "monospace", fontSize: 12, resize: "vertical", marginBottom: 8 }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Btn small kind="primary" onClick={handleParseImport} disabled={!importText.trim()}>
              <Sparkles size={13} /> แยกข้อมูลอัตโนมัติ
            </Btn>
            {importInfo && (
              <div style={{ fontSize: 12, color: importInfo.ok ? C.green : C.red, maxWidth: 420, textAlign: "right" }}>
                {importInfo.msg}
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
        <div>
          <label style={{ fontSize: 11, color: C.textMuted, display: "block", marginBottom: 4 }}>รหัสงาน (Job No)</label>
          <input
            style={{ ...inputStyle, fontFamily: "monospace", opacity: isEdit ? 0.6 : 1 }}
            value={jobNo}
            onChange={(e) => setJobNo(e.target.value)}
            disabled={isEdit}
            readOnly={isEdit}
          />
          {isDuplicate && (
            <div style={{ fontSize: 11, color: C.red, marginTop: 4 }}>รหัสงานนี้มีอยู่แล้ว กรุณาใช้เลขอื่น</div>
          )}
        </div>
        <div>
          <label style={{ fontSize: 11, color: C.textMuted, display: "block", marginBottom: 4 }}>ตัวอย่าง (Sample)</label>
          <input
            style={inputStyle}
            list="sample-list"
            value={sample}
            onChange={(e) => setSample(e.target.value)}
            placeholder="พิมพ์หรือเลือกตัวอย่าง เช่น Soil-01"
          />
          <datalist id="sample-list">
            {knownSamples.map((s) => <option key={s} value={s} />)}
          </datalist>
        </div>
      </div>


      <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
        พารามิเตอร์ ({rows.filter((r) => r.name.trim()).length})
      </div>
      <datalist id="analyst-list">
        {knownAnalysts.map((a) => <option key={a} value={a} />)}
      </datalist>
      <datalist id="param-list">
        {knownParams.map((p) => <option key={p} value={p} />)}
      </datalist>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
        {rows.map((r, i) => (
          <div key={r.id} style={{ display: "grid", gridTemplateColumns: "20px 1.5fr 1fr 26px", gap: 8, alignItems: "center" }}>
            <div style={{ fontSize: 11, color: C.textFaint, fontFamily: "monospace" }}>{i + 1}</div>
            <input style={inputStyle} placeholder="พารามิเตอร์ เช่น pH" list="param-list" value={r.name} onChange={(e) => updateRow(r.id, "name", e.target.value)} />
            <input style={inputStyle} placeholder="ผู้วิเคราะห์" list="analyst-list" value={r.analyst} onChange={(e) => updateRow(r.id, "analyst", e.target.value)} />
            <button onClick={() => removeRow(r.id)} style={{ background: "none", border: "none", cursor: "pointer", color: C.textFaint }}>
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <Btn small onClick={addRow}><Plus size={14} /> เพิ่มพารามิเตอร์</Btn>
      </div>

      <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
        ตัวอย่างย่อย / เลขทะเบียน ({subsamples.length})
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
        {subsamples.map((s, i) => (
          <div key={s.id} style={{ display: "grid", gridTemplateColumns: "20px 1fr 2fr 26px", gap: 8, alignItems: "center" }}>
            <div style={{ fontSize: 11, color: C.textFaint, fontFamily: "monospace" }}>{i + 1}</div>
            <input style={{ ...inputStyle, fontFamily: "monospace" }} placeholder="เลขทะเบียน เช่น 05486" value={s.code} onChange={(e) => updateSubsample(s.id, "code", e.target.value)} />
            <input style={inputStyle} placeholder="ชื่อตัวอย่าง (ถ้ามี)" value={s.name} onChange={(e) => updateSubsample(s.id, "name", e.target.value)} />
            <button onClick={() => removeSubsample(s.id)} style={{ background: "none", border: "none", cursor: "pointer", color: C.textFaint }}>
              <Trash2 size={15} />
            </button>
          </div>
        ))}
        {subsamples.length === 0 && (
          <div style={{ fontSize: 12, color: C.textFaint }}>ไม่มีตัวอย่างย่อย (ไม่จำเป็นถ้างานนี้มีตัวอย่างเดียว)</div>
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Btn small onClick={addSubsample}><Plus size={14} /> เพิ่มตัวอย่างย่อย</Btn>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn onClick={onCancel}>ยกเลิก</Btn>
          <Btn kind="primary" onClick={submit} disabled={!canSubmit}>{isEdit ? "บันทึกการแก้ไข" : "บันทึกรหัสงาน"}</Btn>
        </div>
      </div>
    </Panel>
  );
}

// ---------- Job Detail ----------
function JobDetail({ job, onBack, onUpdateParam, onDeleteJob, onEditJob }) {
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
          <div style={{ fontSize: 12, color: C.textFaint, marginTop: 4 }}>
            สร้างเมื่อ {fmtDate(job.createdAt)}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginBottom: 6 }}>
            <StatusBadge status={stats.status} />
            <DeadlineBadge job={job} />
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: C.text, marginTop: 6, fontFamily: "monospace" }}>{stats.progress}%</div>
          <div style={{ fontSize: 11, color: C.textMuted }}>{stats.complete} / {stats.total} parameters</div>
        </div>
      </div>

      <div style={{ margin: "14px 0 18px" }}>
        <LedBar parameters={job.parameters} />
      </div>

      {job.samples && job.samples.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
            ตัวอย่างย่อย ({job.samples.length})
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {job.samples.map((s) => (
              <div key={s.code} style={{ background: C.panel2, border: `1px solid ${C.borderSoft}`, borderRadius: 5, padding: "5px 10px", fontSize: 12 }}>
                <span style={{ fontFamily: "monospace", fontWeight: 700, color: C.cyan }}>{s.code}</span>
                {s.name && <span style={{ color: C.textMuted }}> · {s.name}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

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

      <div style={{ marginTop: 18, display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Btn small onClick={() => onEditJob(job)}>แก้ไขรหัสงานนี้</Btn>
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
              {["Job No", "Sample", "Created", "Params", "Complete", "Progress", "Status", "Deadline", ""].map((h) => (
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
                  <td style={{ padding: "10px 12px", color: C.textMuted, fontFamily: "monospace", whiteSpace: "nowrap" }}>{fmtDate(job.createdAt)}</td>
                  <td style={{ padding: "10px 12px", color: C.textMuted, fontFamily: "monospace" }}>{stats.total}</td>
                  <td style={{ padding: "10px 12px", color: C.textMuted, fontFamily: "monospace" }}>{stats.complete}</td>
                  <td style={{ padding: "10px 12px", width: 140 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ flex: 1 }}><LedBar parameters={job.parameters} /></div>
                      <span style={{ fontFamily: "monospace", fontSize: 12, color: C.textMuted, minWidth: 32, textAlign: "right" }}>{stats.progress}%</span>
                    </div>
                  </td>
                  <td style={{ padding: "10px 12px" }}><StatusBadge status={stats.status} /></td>
                  <td style={{ padding: "10px 12px" }}><DeadlineBadge job={job} /></td>
                  <td style={{ padding: "10px 12px" }}><ChevronRight size={15} color={C.textFaint} /></td>
                </tr>
              );
            })}
            {jobs.length === 0 && (
              <tr><td colSpan={9} style={{ padding: 30, textAlign: "center", color: C.textFaint }}>ยังไม่มีรหัสงาน</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

// ---------- Analysts Tab ----------
function analystParams(jobs, name) {
  const rows = [];
  for (const job of jobs) {
    for (const p of job.parameters) {
      if (p.analyst === name) {
        rows.push({ ...p, jobNo: job.jobNo, sample: job.sample });
      }
    }
  }
  const order = { [STATUS.RUN]: 0, [STATUS.WAIT]: 1, [STATUS.DONE]: 2 };
  rows.sort((x, y) => (order[x.status] ?? 3) - (order[y.status] ?? 3));
  return rows;
}

function AnalystsTable({ analysts, jobs, onOpenJob }) {
  const [expanded, setExpanded] = useState(null);

  return (
    <Panel style={{ overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
              {["", "Analyst", "Current Job", "Current Parameter", "Started", "Last Update", "Queue"].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "10px 12px", color: C.textMuted, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {analysts.map((a) => {
              const isOpen = expanded === a.name;
              const params = isOpen ? analystParams(jobs, a.name) : [];
              return (
                <React.Fragment key={a.name}>
                  <tr
                    onClick={() => setExpanded(isOpen ? null : a.name)}
                    style={{ borderBottom: `1px solid ${C.borderSoft}`, cursor: "pointer" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = C.panel2)}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <td style={{ padding: "10px 12px", width: 20 }}>
                      {isOpen ? <ChevronDown size={15} color={C.textFaint} /> : <ChevronRight size={15} color={C.textFaint} />}
                    </td>
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
                  {isOpen && (
                    <tr>
                      <td colSpan={7} style={{ padding: 0, background: C.bg2 }}>
                        <div style={{ padding: "10px 16px 16px 42px" }}>
                          <div style={{ fontSize: 11, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
                            งานทั้งหมดของ {a.name} ({params.length})
                          </div>
                          {params.length === 0 ? (
                            <div style={{ color: C.textFaint, fontSize: 13 }}>ไม่มีงานที่รับผิดชอบ</div>
                          ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                              {params.map((p) => (
                                <div
                                  key={`${p.jobNo}-${p.id}`}
                                  onClick={(e) => { e.stopPropagation(); onOpenJob(p.jobNo); }}
                                  style={{
                                    display: "grid",
                                    gridTemplateColumns: "110px 1fr 1fr 90px 70px 70px",
                                    gap: 10,
                                    alignItems: "center",
                                    padding: "8px 10px",
                                    background: C.panel,
                                    border: `1px solid ${C.borderSoft}`,
                                    borderRadius: 6,
                                    cursor: "pointer",
                                  }}
                                >
                                  <span style={{ fontFamily: "monospace", fontWeight: 700, color: C.cyan, fontSize: 12 }}>{p.jobNo}</span>
                                  <span style={{ color: C.textMuted, fontSize: 12 }}>{p.sample || "-"}</span>
                                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: C.text, fontSize: 13, fontWeight: 600 }}>
                                    <StatusGlyph status={p.status} size={12} /> {p.name}
                                  </span>
                                  <span><StatusBadge status={p.status} /></span>
                                  <span style={{ fontFamily: "monospace", fontSize: 12, color: C.textMuted }}>{p.start || "-"}</span>
                                  <span style={{ fontFamily: "monospace", fontSize: 12, color: C.textMuted }}>{p.finish || "-"}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
            {analysts.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 30, textAlign: "center", color: C.textFaint }}>ยังไม่มีข้อมูลผู้วิเคราะห์</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

// ---------- Parameters Tab (queue grouped by parameter) ----------
function ParametersTable({ jobs, onOpenJob }) {
  const groups = useMemo(() => computeParamQueue(jobs), [jobs]);
  const [expanded, setExpanded] = useState(null);

  return (
    <Panel style={{ overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
              {["", "Parameter", "Waiting", "Running", "Complete", "Total", "Analysts"].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "10px 12px", color: C.textMuted, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const isOpen = expanded === g.name;
              const rows = isOpen ? paramJobs(jobs, g.name) : [];
              return (
                <React.Fragment key={g.name}>
                  <tr
                    onClick={() => setExpanded(isOpen ? null : g.name)}
                    style={{ borderBottom: `1px solid ${C.borderSoft}`, cursor: "pointer" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = C.panel2)}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <td style={{ padding: "10px 12px", width: 20 }}>
                      {isOpen ? <ChevronDown size={15} color={C.textFaint} /> : <ChevronRight size={15} color={C.textFaint} />}
                    </td>
                    <td style={{ padding: "10px 12px", fontWeight: 700, color: C.text }}>{g.name}</td>
                    <td style={{ padding: "10px 12px" }}>
                      {g.waiting > 0 ? <Badge color={C.textMuted} bg={C.panel2}>{g.waiting}</Badge> : <span style={{ color: C.textFaint }}>0</span>}
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      {g.running > 0 ? <Badge color={C.amber} bg={C.amberDim}>{g.running}</Badge> : <span style={{ color: C.textFaint }}>0</span>}
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      {g.complete > 0 ? <Badge color={C.green} bg={C.greenDim}>{g.complete}</Badge> : <span style={{ color: C.textFaint }}>0</span>}
                    </td>
                    <td style={{ padding: "10px 12px", fontFamily: "monospace", color: C.textMuted }}>{g.total}</td>
                    <td style={{ padding: "10px 12px", color: C.textMuted, fontSize: 12 }}>
                      {g.analysts.length > 0 ? g.analysts.join(", ") : "-"}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={7} style={{ padding: 0, background: C.bg2 }}>
                        <div style={{ padding: "10px 16px 16px 42px" }}>
                          <div style={{ fontSize: 11, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
                            คิวของ "{g.name}" ({rows.length})
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            {rows.map((p) => (
                              <div
                                key={`${p.jobNo}-${p.id}`}
                                onClick={(e) => { e.stopPropagation(); onOpenJob(p.jobNo); }}
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: "110px 1fr 1fr 90px 70px 70px",
                                  gap: 10,
                                  alignItems: "center",
                                  padding: "8px 10px",
                                  background: C.panel,
                                  border: `1px solid ${C.borderSoft}`,
                                  borderRadius: 6,
                                  cursor: "pointer",
                                }}
                              >
                                <span style={{ fontFamily: "monospace", fontWeight: 700, color: C.cyan, fontSize: 12 }}>{p.jobNo}</span>
                                <span style={{ color: C.textMuted, fontSize: 12 }}>{p.sample || "-"}</span>
                                <span style={{ color: C.text, fontSize: 13 }}>{p.analyst || "-"}</span>
                                <span><StatusBadge status={p.status} /></span>
                                <span style={{ fontFamily: "monospace", fontSize: 12, color: C.textMuted }}>{p.start || "-"}</span>
                                <span style={{ fontFamily: "monospace", fontSize: 12, color: C.textMuted }}>{p.finish || "-"}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
            {groups.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 30, textAlign: "center", color: C.textFaint }}>ยังไม่มีพารามิเตอร์ในระบบ</td></tr>
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
  const lateJobs = activeJobs.filter((j) => deadlineInfo(j).level === "late").length;

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
        {metric("ล่าช้า (15+ วัน)", lateJobs, C.red)}
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
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontFamily: "monospace", fontWeight: 700, color: C.cyan, fontSize: 14 }}>{job.jobNo}</span>
                    <span style={{ fontSize: 11, color: C.textFaint }}>สร้าง {fmtDate(job.createdAt)}</span>
                    <DeadlineBadge job={job} />
                  </span>
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
  const [editingJob, setEditingJob] = useState(null);
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
  const knownParams = useMemo(() => [...new Set(jobs.flatMap(j => j.parameters.map(p => p.name).filter(Boolean)))].sort((a, b) => a.localeCompare(b, "th")), [jobs]);
  const knownSamples = useMemo(
    () => [...new Set(jobs.map((j) => j.sample).filter(Boolean))].sort((a, b) => a.localeCompare(b, "th")),
    [jobs]
  );

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

  const handleSaveEdit = async (updatedJob) => {
    setEditingJob(null);
    try {
      await saveJob(updatedJob);
    } catch (e) {
      setError("บันทึกการแก้ไขไม่สำเร็จ");
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
    <div style={{ background: C.bg, minHeight: 500, borderRadius: 10, fontFamily: "'Prompt', system-ui, sans-serif", color: C.text, padding: 0, border: `1px solid ${C.border}`, boxShadow: "0 2px 18px rgba(14, 111, 186, 0.08)" }}>
      <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.borderSoft}`, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <div style={{ width: 30, height: 30, borderRadius: 6, background: C.cyanDim, display: "flex", alignItems: "center", justifyContent: "center" }}>
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
        {tabBtn("parameters", "Parameters", Layers)}
      </div>

      <div style={{ padding: 20 }}>
        {error && (
          <div style={{ marginBottom: 14, padding: "8px 12px", background: C.redDim, border: `1px solid ${C.red}`, borderRadius: 6, color: "#7A2D22", fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}>
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
                    suggestedNo={genJobNo(jobs)}
                    knownAnalysts={knownAnalysts}
                    knownParams={knownParams}
                    knownSamples={knownSamples}
                    existingJobNos={jobs.map((j) => j.jobNo)}
                  />
                )}
                {editingJob && (
                  <NewJobForm
                    editingJob={editingJob}
                    onCancel={() => setEditingJob(null)}
                    onSaveEdit={handleSaveEdit}
                    knownAnalysts={knownAnalysts}
                    knownParams={knownParams}
                    knownSamples={knownSamples}
                  />
                )}
                {selectedJob && !editingJob ? (
                  <JobDetail job={selectedJob} onBack={() => setSelected(null)} onUpdateParam={handleUpdateParam} onDeleteJob={handleDeleteJob} onEditJob={setEditingJob} />
                ) : (
                  !editingJob && <JobsList jobs={jobs} onOpen={openJob} />
                )}
              </>
            )}
            {tab === "analysts" && <AnalystsTable analysts={analysts} jobs={jobs} onOpenJob={openJob} />}
            {tab === "parameters" && <ParametersTable jobs={jobs} onOpenJob={openJob} />}
          </>
        )}
      </div>
    </div>
  );
}
