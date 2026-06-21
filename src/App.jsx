import { useState, useRef, useEffect, Fragment } from "react";

const SUPA_URL = "https://izgfywbyaqjngziiiyls.supabase.co";
// Transliteration uses Google's free Input Tools (no API key / no Cloud project needed)
// Translate text to target language (hi/gu). Brackets () and Hinglish handled by Google's transliteration.
// Transliterate a single romanized word to target script (hi/gu) using Google Input Tools (free, no key)
async function transliterateWord(word, target) {
  const itc = target==="gu" ? "gu-t-i0-und" : "hi-t-i0-und";
  const r = await fetch(`https://inputtools.google.com/request?text=${encodeURIComponent(word)}&itc=${itc}&num=1&cp=0&cs=1&ie=utf-8&oe=utf-8`);
  const data = await r.json();
  if (data && data[0]==="SUCCESS" && data[1] && data[1][0] && data[1][0][1] && data[1][0][1][0]) {
    return data[1][0][1][0];
  }
  return word; // fallback: keep original word if no suggestion
}
// Transliterate a whole instruction text to target script, word by word, preserving numbers/punctuation/brackets
async function googleTranslate(text, target) {
  try {
    const tokens = text.split(/([^A-Za-z]+)/); // letters vs non-letters
    const out = [];
    for (const tok of tokens) {
      if (/^[A-Za-z]+$/.test(tok)) {
        out.push(await transliterateWord(tok, target));
      } else {
        out.push(tok); // numbers, spaces, brackets, dots stay as-is
      }
    }
    return { ok:true, text: out.join("") };
  } catch(e) {
    return { ok:false, error: "Translation service is temporarily unreachable. Please check your internet and try again." };
  }
}
const SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml6Z2Z5d2J5YXFqbmd6aWlpeWxzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0MTc2NDcsImV4cCI6MjA5Njk5MzY0N30.JSEBtFqJPhl7Rd-gqwvM79nLOb0z6q9wcJpXZmWyNi4";
const HDR = { "apikey": SUPA_KEY, "Authorization": `Bearer ${SUPA_KEY}`, "Content-Type": "application/json", "Prefer": "return=representation" };

async function dbSelect(table) {
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/${table}?select=*`, { headers: HDR });
    if (!r.ok) return [];
    return r.json();
  } catch(e) { return []; }
}
async function dbUpsert(table, data, silent) {
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/${table}`, {
      method: "POST",
      headers: { ...HDR, "Prefer": "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(Array.isArray(data) ? data : [data]),
    });
    if (!r.ok) {
      let msg = "";
      try { msg = await r.text(); } catch(e) {}
      console.error(`SAVE FAILED [${table}] ${r.status}:`, msg);
      if (!silent && typeof window !== "undefined" && window.__erpSaveError) window.__erpSaveError(`Save failed (${table}): ${r.status} ${msg.slice(0,180)}`);
      return { ok:false, status:r.status, msg };
    }
    return { ok:true };
  } catch(e) {
    console.error(`SAVE ERROR [${table}]:`, e);
    if (!silent && typeof window !== "undefined" && window.__erpSaveError) window.__erpSaveError(`Save error (${table}): ${e?.message||e}`);
    return { ok:false, error:e };
  }
}
async function dbDelete(table, id) {
  try { await fetch(`${SUPA_URL}/rest/v1/${table}?id=eq.${id}`, { method: "DELETE", headers: HDR }); }
  catch(e) { console.error(e); }
}

const T = {
  bg: "#0F1923", surface: "#162030", card: "#1C2B3A", border: "#243447",
  gold: "#C8A028", steel: "#5A7A94", steelLt: "#8AAFC8",
  white: "#FFFFFF", red: "#C84040", green: "#2E8B57", orange: "#C87820",
  text: "#D8E8F0", textDim: "#6A8A9A",
  mono: "'Courier New',monospace", sans: "'Segoe UI',Arial,sans-serif"
};

const SIZES = ["S","M","L","XL","XXL","3XL","4XL","5XL","6XL","7XL","8XL","9XL"];
// Sort sizes into standard order (S first ... custom/large last), regardless of selection order
function sortSizes(arr, customSizes = []) {
  const order = [...SIZES, ...customSizes];
  return [...(arr||[])].sort((a,b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia===-1?999:ia) - (ib===-1?999:ib);
  });
}
// Process map: barcode digit -> process name
const PROC_MAP = [
  { digit: "1", name: "Stitch" },
  { digit: "2", name: "Creation" },
  { digit: "3", name: "Gaaj-Button" },
  { digit: "4", name: "Washing" },
  { digit: "5", name: "Press" },
  { digit: "6", name: "Fabric" },
  { digit: "7", name: "Cut to Pack" },
  { digit: "8", name: "Printing" },
  { digit: "9", name: "Embroidery" },
  { digit: "A", name: "Vinyl" },
  { digit: "B", name: "Other" },
];
const PROCESSES = PROC_MAP.map(p => p.name);
const FITS = ["Regular Fit","Slim Fit","Loose Fit","Oversized"];
const COLLARS = ["Round Collar","V Collar","Cuban Collar","Any Other"];
const PLACKETS = ["Inside","Outside"];
const WASHES = ["Normal","Stone Wash","Acid Wash","Enzyme Wash","Sand Blast","None"];
const SPEC_KEYS = ["Label","Button","Embroidery","Print","Vinyl","Other Details 1","Other Details 2"];
const RATIO_SIZES = ["S","M","L","XL","XXL","3XL","4XL","5XL","6XL","7XL","8XL","9XL","10XL"];

// Month color for entries — cycles by month index
const MONTH_COLORS = ["#C8A028","#5A7A94","#2E8B57","#C87820","#8AAFC8","#A0698A","#7A9A4A","#C84040","#4A8AA0","#9A7A4A","#6A8A9A","#B0A030"];
function monthColor(dateStr) {
  if (!dateStr) return T.steel;
  const d = new Date(dateStr);
  if (isNaN(d)) return T.steel;
  return MONTH_COLORS[d.getMonth()];
}
function monthKey(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d)) return "";
  return d.toLocaleString("default",{month:"short"}) + " " + d.getFullYear();
}
function yearOf(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  return d.getFullYear();
}
// total pieces helper
function totalPieces(d) {
  return (d.colors||[]).reduce((a,c) => a+Object.values(c.sizes||{}).reduce((x,v)=>x+(+v||0),0), 0);
}
// total sample meters across all colours
function sampleMeters(d) {
  return (d.colors||[]).reduce((a,c) => a + (c.sampleFabric||[]).reduce((x,sf)=>x+(+sf.meters||0),0), 0);
}
// total meters (gross, includes sample fabric)
function totalMeters(d) {
  return (d.colors||[]).reduce((a,c) => a+(+c.meters||0), 0);
}
// COST average = (total meters + trims) / pieces  (sample fabric included — it's a cost)
function fabricAverage(d) {
  const meters = totalMeters(d);
  const trims = +d.trims||0;
  const pcs = totalPieces(d);
  if (!pcs) return "";
  return ((meters + trims) / pcs).toFixed(2);
}
// NET average = (total meters - sample meters + trims) / pieces  (actual production consumption)
function fabricAverageNet(d) {
  const meters = totalMeters(d) - sampleMeters(d);
  const trims = +d.trims||0;
  const pcs = totalPieces(d);
  if (!pcs) return "";
  return ((meters + trims) / pcs).toFixed(2);
}
// total sample pieces across colours
function totalSamplePcs(d) {
  return (d.colors||[]).reduce((a,c) => a + Object.values(c.samples||{}).reduce((x,v)=>x+(+v||0),0), 0);
}
// days between two date strings
function daysBetween(a, b) {
  if (!a||!b) return null;
  const da=new Date(a), db=new Date(b);
  if (isNaN(da)||isNaN(db)) return null;
  return Math.round((db-da)/(1000*60*60*24));
}
// age in days from a date
function ageDays(dateStr) {
  if (!dateStr) return null;
  const d=new Date(dateStr);
  if (isNaN(d)) return null;
  return Math.round((Date.now()-d)/(1000*60*60*24));
}

// Build a jobber's barcode code: prefix (process+number) + rate padded to >=2 digits
function buildCode(prefix, rate) {
  if (!prefix || rate === "" || rate == null) return "";
  let r = String(Math.round(+rate));
  if (r.length < 2) r = "0" + r;
  return prefix + r;
}


// Date -> DDMMYY (e.g. 2026-06-16 -> "160626")
function ddmmyy(dateStr) {
  let d = dateStr ? new Date(dateStr) : new Date();
  if (isNaN(d)) d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  return dd + mm + yy;
}
// Auto initials from a name: "Surat Textiles" -> "ST"
function initialsOf(name) {
  if (!name) return "";
  return name.trim().split(/\s+/).map(w => w[0]||"").join("").toUpperCase().slice(0, 4);
}
// Build the ABOVE-barcode line: pieces, process codes in DATE order, production date
function buildBarcodeTop(design, jobbers, productionDate) {
  const totalPcs = (design.colors||[]).reduce((a,c) => a+Object.values(c.sizes||{}).reduce((x,v) => x+(+v||0), 0), 0);
  const procEntries = [];
  PROC_MAP.forEach(pm => {
    const proc = (design.processes||{})[pm.name];
    if (proc && proc.jobber && proc.rate) {
      const j = jobbers.find(x => x.id === proc.jobber);
      const prefix = proc.prefix || codeForProcess(j, pm.name);
      const code = buildCode(prefix, proc.rate);
      if (code) procEntries.push({ code, date: proc.recdDate || proc.date || "" });
    }
    (proc?.splits||[]).forEach(sp => {
      if (sp.jobber && sp.rate) {
        const sj = jobbers.find(x => x.id === sp.jobber);
        const sprefix = sp.prefix || codeForProcess(sj, pm.name);
        const scode = buildCode(sprefix, sp.rate);
        if (scode) procEntries.push({ code: scode, date: sp.recdDate || "" });
      }
    });
  });
  // sort by date ascending; entries with no date go last
  procEntries.sort((a,b) => {
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date.localeCompare(b.date);
  });
  const codes = procEntries.map(e => e.code).join(" ");
  const prodDate = ddmmyy(productionDate);
  return [String(totalPcs), codes, prodDate].filter(Boolean).join("  ");
}
// Build the BELOW-barcode fabric block: meters(ceil) rate supplierInitials billNo billDate
function buildFabricBlock(block) {
  if (!block) return "";
  const meters = block.meters !== "" && block.meters != null ? Math.ceil(+block.meters) : "";
  return [meters, block.rate, block.initials, block.billNo, block.billDate].filter(v => v !== "" && v != null).join("  ");
}

function dToRow(d) {
  return {
    id: d.id, design_no: d.designNo||"", lot_no: d.lotNo||"", sleeve_type: d.sleeveType||"Full", brand: d.brand||"", style: d.style||"",
    fabric: d.fabric||"", supplier: d.supplier||"", p1_code: d.p1Code||"",
    p1_mrp: d.p1MRP||"", p2_code: d.p2Code||"", p2_mrp: d.p2MRP||"",
    fit: d.fit||"", collar_type: d.collarType||"",
    shrinkage_len: d.shrinkageLen||"", shrinkage_wid: d.shrinkageWid||"",
    placket: d.placket||"", wash_type: d.washType||"",
    has_embroidery: !!d.hasEmbroidery, has_print: !!d.hasPrint, has_vinyl: !!d.hasVinyl,
    has_pocket: !!d.hasPocket, has_buttons: !!d.hasButtons, has_label: !!d.hasLabel,
    specs: (d.specs||[]).map(sp => ({ key:sp.key, text:sp.text||"", thumb:"" })),
    ratio: d.ratio||{}, trims: d.trims||"", drawing_avg: d.drawingAvg||"", main_thumb: "", manual_avg: { ...(d.manualAvg||{ smxxl:"", x3to5:"", bigLabel:"6XL+", big:"" }), _formOrder: d.formOrder||[] },
    date_program: d.dateProgram||"", date_cut: d.dateCut||"",
    notes: d.notes||"", keywords: d.keywords||"", instructions: d.instructions||"", custom_sizes: d.customSizes||[], active_colors: d.activeColors||[],
    colors: (d.colors||[]).map(c => ({ ...c, swatch: "" })),
    processes: d.processes||{},
    photos: (d.photos||[]).map(p => ({ id: p.id, note: p.note, date: p.date, src: "" })),
    supplier_bills: d.supplierBills||[], customer_orders: d.customerOrders||[],
    status: d.status||"New", mrp_finalized: !!d.mrpFinalized,
    locked: !!d.locked, locked_by: d.lockedBy||"", locked_at_str: d.lockedAtStr||"",
    barcode_block: d.barcodeBlock||null, production_date: d.productionDate||"",
    created_by: d.createdBy||"", created_at_str: d.createdAtStr||"",
    edited_by: d.editedBy||"", edited_at_str: d.editedAtStr||"", edit_count: d.editCount||0
  };
}
function rowToD(r) {
  return {
    id: r.id, designNo: r.design_no||"", lotNo: r.lot_no||"", sleeveType: r.sleeve_type||"Full", brand: r.brand||"", style: r.style||"",
    fabric: r.fabric||"", supplier: r.supplier||"", p1Code: r.p1_code||"",
    p1MRP: r.p1_mrp||"", p2Code: r.p2_code||"", p2MRP: r.p2_mrp||"",
    fit: r.fit||"", collarType: r.collar_type||"",
    shrinkageLen: r.shrinkage_len||"", shrinkageWid: r.shrinkage_wid||"",
    placket: r.placket||"", washType: r.wash_type||"",
    hasEmbroidery: !!r.has_embroidery, hasPrint: !!r.has_print, hasVinyl: !!r.has_vinyl,
    hasPocket: !!r.has_pocket, hasButtons: !!r.has_buttons, hasLabel: !!r.has_label,
    specs: r.specs||[], ratio: r.ratio||{}, trims: r.trims||"", drawingAvg: r.drawing_avg||"", mainThumb: r.main_thumb||"", manualAvg: r.manual_avg||{ smxxl:"", x3to5:"", bigLabel:"6XL+", big:"" }, formOrder: (r.manual_avg&&r.manual_avg._formOrder)||[],
    dateProgram: r.date_program||"", dateCut: r.date_cut||"",
    notes: r.notes||"", keywords: r.keywords||"", instructions: r.instructions||"", customSizes: r.custom_sizes||[], activeColors: r.active_colors||[], colors: r.colors||[],
    processes: r.processes||{}, photos: r.photos||[],
    supplierBills: r.supplier_bills||[], customerOrders: r.customer_orders||[],
    movements: [], jobberEntries: [], status: r.status||"New", mrpFinalized: !!r.mrp_finalized,
    locked: !!r.locked, lockedBy: r.locked_by||"", lockedAtStr: r.locked_at_str||"",
    barcodeBlock: r.barcode_block||null, productionDate: r.production_date||"",
    createdBy: r.created_by||"", createdAtStr: r.created_at_str||"",
    editedBy: r.edited_by||"", editedAtStr: r.edited_at_str||"", editCount: r.edit_count||0
  };
}
function jToRow(j) {
  return { id: j.id, name: j.name||"", pin: j.pin||"", process: j.process||"", prefix: j.prefix||"", process_codes: j.processCodes||[], phone: j.phone||"", gst: j.gst||"", email: j.email||"", address: j.address||"", role: j.role||"jobber", contacts: j.contacts||[], size_filler: !!j.sizeFiller, can_create_design: !!j.canCreateDesign };
}
function rowToJ(r) {
  let pc = r.process_codes||[];
  if ((!pc || pc.length===0) && (r.process||r.prefix)) pc = [{ process: r.process||"", code: r.prefix||"" }];
  return { id: r.id, name: r.name||"", pin: r.pin||"", process: r.process||"", prefix: r.prefix||"", processCodes: pc, phone: r.phone||"", gst: r.gst||"", email: r.email||"", address: r.address||"", role: r.role||"jobber", contacts: r.contacts||[], sizeFiller: !!r.size_filler, canCreateDesign: !!r.can_create_design };
}
// helper: get a jobber's code for a given process (falls back to prefix)
function codeForProcess(jobber, processName) {
  if (!jobber) return "";
  const pc = (jobber.processCodes||[]).find(x => x.process===processName);
  if (pc) return pc.code;
  return jobber.prefix || "";
}
// helper: can this jobber fill the size grid? (Stitch/Cut processes, tagged, or admin)
function canFillSizes(jobber) {
  if (!jobber) return false;
  if (jobber.role === "admin") return true;
  if (jobber.sizeFiller) return true;
  const fillerProcs = ["Stitch","Cut to Pack"];
  if ((jobber.processCodes||[]).some(x => fillerProcs.includes(x.process))) return true;
  return fillerProcs.includes(jobber.process);
}
// helper: does jobber do this process?
function jobberDoesProcess(jobber, processName) {
  if (!jobber) return false;
  if ((jobber.processCodes||[]).some(x => x.process===processName)) return true;
  return jobber.process===processName;
}
function mvToRow(mv, did) {
  return { id: mv.id, design_id: did, date: mv.date||"", jobber: mv.jobber||"", received_from: mv.receivedFrom||"", sent_to: mv.sentTo||"", sent_to_id: mv.sentToId||"", qty: mv.qty||0, remark: mv.remark||"", status: mv.status||"pending" };
}
function rowToMv(r) {
  return { id: r.id, date: r.date||"", jobber: r.jobber||"", receivedFrom: r.received_from||"", sentTo: r.sent_to||"", sentToId: r.sent_to_id||"", qty: r.qty||0, remark: r.remark||"", status: r.status||"pending" };
}
function entToRow(e, did) {
  return { id: e.id||`E${Date.now()}`, design_id: did, jobber_id: e.jobber||"", date: e.date||"", qty_received: e.qtyReceived||"", qty_delivered: e.qtyDelivered||"", damage: e.damage||"", time_taken: e.timeTaken||"", notes: e.notes||"", status: e.status||"pending" };
}
function rowToEnt(r) {
  return { id: r.id, jobber: r.jobber_id||"", date: r.date||"", qtyReceived: r.qty_received||"", qtyDelivered: r.qty_delivered||"", damage: r.damage||"", timeTaken: r.time_taken||"", notes: r.notes||"", status: r.status||"pending" };
}

// Compress + resize an image file to keep storage small. Returns a data URL (JPEG).
function compressImage(file, maxDim = 1000, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width >= height) { height = Math.round(height * maxDim / width); width = maxDim; }
          else { width = Math.round(width * maxDim / height); height = maxDim; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        try { resolve(canvas.toDataURL("image/jpeg", quality)); }
        catch(e) { resolve(ev.target.result); }
      };
      img.onerror = () => resolve(ev.target.result);
      img.src = ev.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Print a DOM element as a clean PDF (opens browser print dialog -> Save as PDF)
function printSection(elementId, title) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const w = window.open("", "_blank");
  if (!w) { alert("Allow popups to download PDF"); return; }
  w.document.write(`<html><head><title>${title||"Report"}</title>
  <style>
    body{font-family:Arial,sans-serif;padding:24px;color:#111}
    h1{font-size:18px;margin:0 0 4px} .sub{color:#666;font-size:12px;margin-bottom:16px}
    table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:14px}
    th,td{border:1px solid #ccc;padding:5px 7px;text-align:left}
    th{background:#f0f0f0}
    img{max-width:80px;max-height:80px}
  </style></head><body>
  <h1>AASHISH APPARELS</h1><div class="sub">${title||""} &middot; ${new Date().toLocaleDateString()}</div>
  ${el.innerHTML}
  <script>window.onload=()=>{window.print();}</script>
  </body></html>`);
  w.document.close();
}

// Display design as Lot(Main) e.g. 3290(2083); if no lot, just main
function designLabel(d) {
  if (!d) return "";
  if (d.lotNo && d.lotNo !== d.designNo) return `${d.lotNo}(${d.designNo})`;
  return d.designNo || "";
}

function nowStr() {
  const d = new Date();
  return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });
}

// ── UI Primitives ─────────────────────────────────────────────────────────────
function Toast({ msg, type }) {
  if (!msg) return null;
  return (
    <div style={{ position:"fixed", bottom:24, right:24, zIndex:9999, background:type==="error"?T.red:T.green, color:"#fff", padding:"12px 20px", borderRadius:8, fontFamily:T.sans, fontSize:13, fontWeight:600, boxShadow:"0 4px 20px #0008" }}>
      {msg}
    </div>
  );
}

function Loader() {
  return (
    <div style={{ minHeight:"100vh", background:T.bg, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:16 }}>
      <div style={{ width:48, height:48, border:`4px solid ${T.border}`, borderTop:`4px solid ${T.gold}`, borderRadius:"50%", animation:"spin 0.8s linear infinite" }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ fontFamily:T.mono, color:T.steelLt, fontSize:13 }}>Connecting to Supabase…</div>
    </div>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div style={{ position:"fixed", inset:0, background:"#000A", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }} onClick={onClose}>
      <div style={{ background:T.card, borderRadius:12, border:`1px solid ${T.border}`, width:"min(640px,98vw)", maxHeight:"92vh", overflow:"auto", boxShadow:"0 8px 40px #0009" }} onClick={e => e.stopPropagation()}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"18px 24px", borderBottom:`1px solid ${T.border}` }}>
          <span style={{ fontFamily:T.mono, fontSize:14, color:T.gold, fontWeight:700 }}>{title}</span>
          <button onClick={onClose} style={{ background:"none", border:"none", color:T.steelLt, fontSize:20, cursor:"pointer" }}>✕</button>
        </div>
        <div style={{ padding:24 }}>{children}</div>
      </div>
    </div>
  );
}

function Inp({ label, value, onChange, type="text", placeholder="", style={}, options, readOnly }) {
  const base = { background:readOnly?T.bg:T.surface, border:`1px solid ${T.border}`, borderRadius:6, color:T.text, fontFamily:T.sans, fontSize:13, padding:"8px 12px", width:"100%", outline:"none", boxSizing:"border-box" };
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:4, ...style }}>
      {label && <label style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, textTransform:"uppercase", letterSpacing:0.8 }}>{typeof label==="string" ? <BL text={label} /> : label}</label>}
      {options
        ? <select value={value} onChange={e => onChange(e.target.value)} style={base} disabled={readOnly}>
            <option value="">— select —</option>
            {options.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        : <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} readOnly={readOnly} style={base} />
      }
    </div>
  );
}

function Btn({ label, onClick, color=T.gold, textColor=T.bg, small, style={}, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{ background:disabled?T.border:color, color:disabled?T.textDim:textColor, border:"none", borderRadius:6, fontFamily:T.mono, fontWeight:700, fontSize:small?10:12, padding:small?"5px 12px":"9px 20px", cursor:disabled?"not-allowed":"pointer", ...style }}>
      {typeof label==="string" ? <BL text={label} /> : label}
    </button>
  );
}

function Badge({ label, color=T.steel }) {
  return <span style={{ background:color+"22", color, border:`1px solid ${color}44`, borderRadius:4, padding:"2px 8px", fontSize:10, fontFamily:T.mono, fontWeight:700, whiteSpace:"nowrap" }}>{label}</span>;
}

function Section({ title, children, action }) {
  return (
    <div style={{ background:T.card, borderRadius:10, border:`1px solid ${T.border}`, marginBottom:18 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"14px 20px", borderBottom:`1px solid ${T.border}` }}>
        <span style={{ fontFamily:T.mono, fontSize:11, color:T.steelLt, textTransform:"uppercase", letterSpacing:1 }}>{typeof title==="string" ? <BL text={title} /> : title}</span>
        {action}
      </div>
      <div style={{ padding:20 }}>{children}</div>
    </div>
  );
}

function PdfBtn({ targetId, title }) {
  return <Btn label="⤓ PDF" onClick={() => printSection(targetId, title)} small color={T.surface} textColor={T.gold} style={{ border:`1px solid ${T.gold}44` }} />;
}

function PhotoUpload({ label, value, onChange, size=60 }) {
  const ref = useRef();
  function handle(e) {
    const file = e.target.files[0];
    if (!file) return;
    compressImage(file).then(onChange).catch(() => {});
  }
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
      {label && <label style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, textTransform:"uppercase", letterSpacing:0.8 }}>{typeof label==="string" ? <BL text={label} /> : label}</label>}
      <div onClick={() => ref.current.click()} onContextMenu={e => e.preventDefault()} style={{ width:size, height:size, borderRadius:6, border:`2px dashed ${T.border}`, cursor:"pointer", overflow:"hidden", background:T.surface, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
        {value
          ? <img src={value} alt="" style={{ width:"100%", height:"100%", objectFit:"cover", pointerEvents:"none" }} draggable={false} />
          : <span style={{ fontSize:20, color:T.textDim }}>+</span>
        }
      </div>
      <input ref={ref} type="file" accept="image/*" style={{ display:"none" }} onChange={handle} />
    </div>
  );
}

// ── Combined Barcode display ──────────────────────────────────────────────────
function CombinedBarcode({ design, jobbers }) {
  const parts = [];
  PROC_MAP.forEach(pm => {
    const proc = (design.processes||{})[pm.name];
    if (proc && proc.jobber && proc.rate) {
      const j = jobbers.find(x => x.id === proc.jobber);
      const prefix = proc.prefix || codeForProcess(j, pm.name);
      const code = buildCode(prefix, proc.rate);
      if (code) parts.push(code);
    }
    (proc?.splits||[]).forEach(sp => {
      if (sp.jobber && sp.rate) {
        const sj = jobbers.find(x => x.id === sp.jobber);
        const sprefix = sp.prefix || codeForProcess(sj, pm.name);
        const scode = buildCode(sprefix, sp.rate);
        if (scode) parts.push(scode);
      }
    });
  });
  const full = parts.join(" ");
  return (
    <div style={{ background:T.bg, border:`1px solid ${T.gold}44`, borderRadius:8, padding:"14px 16px", marginTop:12 }}>
      <div style={{ fontFamily:T.mono, fontSize:9, color:T.steelLt, marginBottom:6, textTransform:"uppercase", letterSpacing:1 }}>Combined Cost Code (for barcode)</div>
      {full
        ? <div style={{ fontFamily:T.mono, fontSize:18, color:T.gold, fontWeight:700, letterSpacing:2 }}>{full}</div>
        : <div style={{ fontFamily:T.mono, fontSize:12, color:T.textDim }}>Assign jobbers & rates to generate the code</div>
      }
    </div>
  );
}

// ── Translations for jobber-facing labels (EN / Hindi / Gujarati) ─────────────
const TRANSLATIONS = {
  "Send To Next": { hi:"आगे भेजें", gu:"આગળ મોકલો" },
  "Who are you sending this lot to?": { hi:"यह लॉट किसको भेज रहे हैं?", gu:"આ લોટ કોને મોકલો છો?" },
  "Send To": { hi:"भेजें", gu:"મોકલો" },
  "select": { hi:"चुनें", gu:"પસંદ કરો" },
  "Office / Admin": { hi:"ऑफिस / एडमिन", gu:"ઓફિસ / એડમિન" },
  "Quantity (pieces)": { hi:"मात्रा (पीस)", gu:"જથ્થો (પીસ)" },
  "Note (optional)": { hi:"नोट (वैकल्पिक)", gu:"નોંધ (વૈકલ્પિક)" },
  "e.g. half stitched": { hi:"जैसे आधा सिला", gu:"દા.ત. અડધું સીવેલું" },
  "Cancel": { hi:"रद्द करें", gu:"રદ કરો" },
  "Send": { hi:"भेजें", gu:"મોકલો" },
  "Confirm & Lock": { hi:"पक्का करें और लॉक करें", gu:"કન્ફર્મ અને લોક કરો" },
  "Logout": { hi:"लॉग आउट", gu:"લોગ આઉટ" },
  // ── Common field labels ──
  "Design Number *": { hi:"डिज़ाइन नंबर *" },
  "Design Number": { hi:"डिज़ाइन नंबर" },
  "Design No *": { hi:"डिज़ाइन नंबर *" },
  "Design No": { hi:"डिज़ाइन नंबर" },
  "Lot No (this run)": { hi:"लॉट नंबर (इस बार)" },
  "Main Design No": { hi:"मुख्य डिज़ाइन नंबर" },
  "Brand": { hi:"ब्रांड" },
  "Style": { hi:"स्टाइल" },
  "Fabric": { hi:"कपड़ा" },
  "Supplier": { hi:"सप्लायर" },
  "Fit": { hi:"फिट" },
  "Sleeve Type": { hi:"आस्तीन प्रकार" },
  "Collar Type": { hi:"कॉलर प्रकार" },
  "Wash Type": { hi:"धुलाई प्रकार" },
  "Placket": { hi:"पट्टी" },
  "Quantity": { hi:"मात्रा" },
  "Quantity *": { hi:"मात्रा *" },
  "Quantity (m)": { hi:"मात्रा (मीटर)" },
  "Quantity (meters)": { hi:"मात्रा (मीटर)" },
  "Qty": { hi:"मात्रा" },
  "Qty (pieces)": { hi:"मात्रा (पीस)" },
  "Rate": { hi:"रेट" },
  "Rate (Rs.)": { hi:"रेट (रु.)" },
  "Rate/pc": { hi:"रेट/पीस" },
  "Amount": { hi:"रकम" },
  "Amount (Rs.)": { hi:"रकम (रु.)" },
  "Amount (auto)": { hi:"रकम (अपने आप)" },
  "Date": { hi:"तारीख" },
  "Bill Date": { hi:"बिल तारीख" },
  "Bill No": { hi:"बिल नंबर" },
  "Bill No *": { hi:"बिल नंबर *" },
  "Challan No": { hi:"चालान नंबर" },
  "LR No": { hi:"एलआर नंबर" },
  "LR Number": { hi:"एलआर नंबर" },
  "Process": { hi:"काम" },
  "Jobber": { hi:"जॉबर" },
  "Jobber *": { hi:"जॉबर *" },
  "Customer": { hi:"ग्राहक" },
  "Customer Name": { hi:"ग्राहक का नाम" },
  "Color": { hi:"रंग" },
  "Color No": { hi:"रंग नंबर" },
  "Meters": { hi:"मीटर" },
  "Booking Date": { hi:"बुकिंग तारीख" },
  "Delivery Date": { hi:"डिलीवरी तारीख" },
  "Notes": { hi:"नोट्स" },
  "Note": { hi:"नोट" },
  "Full Name *": { hi:"पूरा नाम *" },
  "Role": { hi:"भूमिका" },
  "Phone": { hi:"फ़ोन" },
  "GST Number": { hi:"जीएसटी नंबर" },
  "Address / Shop": { hi:"पता / दुकान" },
  "Name": { hi:"नाम" },
  "Mode": { hi:"तरीका" },
  "Particulars (Supplier)": { hi:"विवरण (सप्लायर)" },
  "Type": { hi:"प्रकार" },
  "Trims (meters, added on top)": { hi:"ट्रिम्स (मीटर, ऊपर से)" },
  "Date Program Given": { hi:"प्रोग्राम देने की तारीख" },
  "Date Cut": { hi:"कटिंग तारीख" },
  "Shrinkage Length": { hi:"सिकुड़न लंबाई" },
  "Shrinkage Width": { hi:"सिकुड़न चौड़ाई" },
  // ── Buttons ──
  "Save": { hi:"सेव करें" },
  "Save Changes": { hi:"बदलाव सेव करें" },
  "Save Bill": { hi:"बिल सेव करें" },
  "Save Payment": { hi:"पेमेंट सेव करें" },
  "Save Challan": { hi:"चालान सेव करें" },
  "Add": { hi:"जोड़ें" },
  "Create Design": { hi:"डिज़ाइन बनाएं" },
  "Edit": { hi:"बदलें" },
  "Edit Design": { hi:"डिज़ाइन बदलें" },
  "Delete": { hi:"मिटाएं" },
  "Yes, Delete": { hi:"हाँ, मिटाएं" },
  "Login": { hi:"लॉगिन" },
  "Back": { hi:"वापस" },
  "Admin Login": { hi:"एडमिन लॉगिन" },
  "Team Member Login": { hi:"टीम सदस्य लॉगिन" },
  "Jobber Login": { hi:"जॉबर लॉगिन" },
  "+ New Design": { hi:"+ नया डिज़ाइन" },
  "+ New Bill": { hi:"+ नया बिल" },
  "+ New Challan": { hi:"+ नया चालान" },
  "+ Add Color": { hi:"+ रंग जोड़ें" },
  "+ Add Order": { hi:"+ ऑर्डर जोड़ें" },
  "+ Add Bill": { hi:"+ बिल जोड़ें" },
  "+ Add Booking": { hi:"+ बुकिंग जोड़ें" },
  "+ Record Payment": { hi:"+ पेमेंट दर्ज करें" },
  "Export PDF": { hi:"पीडीएफ निकालें" },
  "Mark Completed": { hi:"पूरा हुआ चिह्नित करें" },
  "Reopen": { hi:"फिर खोलें" },
  "Approve": { hi:"मंज़ूर करें" },
  "Reject": { hi:"नामंज़ूर करें" },
  // ── Section / tab titles ──
  "Design Identity": { hi:"डिज़ाइन पहचान" },
  "Color Swatches": { hi:"रंग के नमूने" },
  "Shirt Making Instructions": { hi:"शर्ट बनाने के निर्देश" },
  "Customer Orders": { hi:"ग्राहक ऑर्डर" },
  "Movement Log": { hi:"मूवमेंट लॉग" },
  "Job Sheet": { hi:"जॉब शीट" },
  "Fill Sizes": { hi:"साइज़ भरें" },
  "Flow": { hi:"प्रवाह" },
  "Photos": { hi:"फ़ोटो" },
  "Bookings": { hi:"बुकिंग" },
  "Challans": { hi:"चालान" },
  "People": { hi:"लोग" },
  "Search": { hi:"खोजें" },
  "Designs": { hi:"डिज़ाइन" },
  "Home": { hi:"होम" },
};
function makeL(lang) {
  return (txt) => {
    if (lang === "en" || !TRANSLATIONS[txt]) return txt;
    return TRANSLATIONS[txt][lang] || txt;
  };
}
// Hindi for a label, if we have it
function hindiOf(txt) {
  const t = TRANSLATIONS[txt];
  return (t && t.hi) ? t.hi : "";
}
// Bilingual stacked label: English on top, Hindi smaller below
function BL({ text, color }) {
  const hi = hindiOf(text);
  if (!hi) return <>{text}</>;
  return (
    <span style={{ display:"inline-flex", flexDirection:"column", lineHeight:1.15 }}>
      <span>{text}</span>
      <span style={{ fontSize:"0.82em", opacity:0.78, fontWeight:400 }}>{hi}</span>
    </span>
  );
}
function LangToggle({ lang, setLang }) {
  const opts = [["en","EN"],["hi","हिं"],["gu","ગુ"]];
  return (
    <div style={{ display:"flex", gap:2, background:T.surface, borderRadius:6, padding:2 }}>
      {opts.map(([code,label]) => (
        <button key={code} onClick={() => setLang(code)} style={{ background:lang===code?T.gold:"none", color:lang===code?T.bg:T.steelLt, border:"none", borderRadius:4, padding:"4px 8px", fontFamily:T.mono, fontSize:11, fontWeight:700, cursor:"pointer" }}>{label}</button>
      ))}
    </div>
  );
}
// ── Send-To modal (jobber passes lot to next jobber or office) ────────────────
function SendToModal({ design, people, fromJobber, onClose, onSend, L = (x)=>x, fixedQty }) {
  const jobbers = people.filter(p => p.role==="jobber" && p.id!==(fromJobber&&fromJobber.id));
  const [toId, setToId] = useState("");
  const [qty, setQty] = useState(fixedQty!=null ? String(fixedQty) : "");
  const [remark, setRemark] = useState("");
  const isOffice = toId === "__office__";
  function send() {
    if (!toId || !qty) return;
    const toName = isOffice ? "Office / Admin" : ((people.find(p=>p.id===toId)||{}).name || "");
    onSend({ id:`MV${Date.now()}`, date:new Date().toISOString().slice(0,10), jobber:(fromJobber&&fromJobber.name)||"", sentTo:toName, sentToId:isOffice?"":toId, receivedFrom:(fromJobber&&fromJobber.name)||"", qty:+qty, remark, status:"sent" });
  }
  return (
    <Modal title={L("Send To Next")} onClose={onClose}>
      <div style={{ fontFamily:T.mono, fontSize:11, color:T.steelLt, marginBottom:12 }}>{L("Who are you sending this lot to?")}</div>
      <div style={{ marginBottom:12 }}>
        <div style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, marginBottom:4, textTransform:"uppercase" }}>{L("Send To")}</div>
        <select value={toId} onChange={e=>setToId(e.target.value)} style={{ background:T.surface, border:`1px solid ${T.border}`, color:T.text, borderRadius:6, padding:"10px 12px", fontSize:14, width:"100%" }}>
          <option value="">— {L("select")} —</option>
          <option value="__office__">🏢 {L("Office / Admin")}</option>
          {jobbers.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
        </select>
      </div>
      <div style={{ marginBottom:12 }}>
        <div style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, marginBottom:4, textTransform:"uppercase" }}>{L("Quantity (pieces)")}</div>
        <input type="number" value={qty} onChange={e=>setQty(e.target.value)} placeholder="0" style={{ background:T.surface, border:`1px solid ${T.border}`, color:T.text, borderRadius:6, padding:"10px 12px", fontSize:16, width:"100%", boxSizing:"border-box" }} />
      </div>
      <div style={{ marginBottom:16 }}>
        <div style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, marginBottom:4, textTransform:"uppercase" }}>{L("Note (optional)")}</div>
        <input value={remark} onChange={e=>setRemark(e.target.value)} placeholder={L("e.g. half stitched")} style={{ background:T.surface, border:`1px solid ${T.border}`, color:T.text, borderRadius:6, padding:"10px 12px", fontSize:14, width:"100%", boxSizing:"border-box" }} />
      </div>
      <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
        <Btn label={L("Cancel")} onClick={onClose} color={T.surface} textColor={T.steelLt} />
        <Btn label={L("Send")} onClick={send} disabled={!toId||!qty} />
      </div>
    </Modal>
  );
}

// ── Averages display block (Cost + Net + manual) ─────────────────────────────
function AveragesBlock({ design }) {
  const ma = design.manualAvg || {};
  // dynamic group averages matching the design form (only selected sizes)
  const ALL = [...SIZES, ...((design.customSizes)||[])];
  const baseGroup = ["S","M","L","XL","XXL"];
  const rest = ALL.filter(s => !baseGroup.includes(s));
  const groups = [baseGroup];
  for (let i=0;i<rest.length;i+=3) groups.push(rest.slice(i,i+3));
  const active = design.activeColors||[];
  const visibleGroups = groups.map(g => g.filter(s => active.includes(s))).filter(g => g.length>0);
  const groupKey = g => "g_"+g.join("_");
  const groupLabel = g => g.length===1 ? g[0] : `${g[0]}–${g[g.length-1]}`;
  const items = [
    ["Cost Avg (total ÷ pcs)", fabricAverage(design)||"—", T.gold],
    ["Net Avg (less sample)", fabricAverageNet(design)||"—", T.green],
    ...visibleGroups.map(g => [`Avg ${groupLabel(g)}`, ma[groupKey(g)] || ma.smxxl || "—", T.steelLt]),
    ["Drawing Avg", design.drawingAvg||"—", T.steelLt],
  ];
  return (
    <div style={{ display:"flex", gap:12, flexWrap:"wrap", marginTop:6 }}>
      {items.map(([l,v,c]) => (
        <div key={l} style={{ background:T.surface, borderRadius:8, padding:"10px 14px", borderLeft:`3px solid ${c}` }}>
          <div style={{ fontFamily:T.mono, fontSize:9, color:T.steelLt, textTransform:"uppercase" }}>{l}</div>
          <div style={{ fontFamily:T.mono, fontSize:16, fontWeight:900, color:c }}>{v}</div>
        </div>
      ))}
    </div>
  );
}

// ── Job Sheet (read-only view, with audit info) ───────────────────────────────
function JobSheetInstructions({ text }) {
  const [hi, setHi] = useState(""); const [gu, setGu] = useState(""); const [busy, setBusy] = useState(""); const [err, setErr] = useState("");
  const points = (text||"").split(/\n|(?<=\.)\s+/).map(s=>s.trim()).filter(Boolean);
  const numbered = points.map((p,i)=>`${i+1}. ${p}`).join("\n");
  async function tr(lang) { setErr(""); setBusy(lang); const res = await googleTranslate(numbered, lang); setBusy(""); if(!res.ok){setErr(res.error);return;} if(lang==="hi")setHi(res.text);else setGu(res.text); }
  return (
    <div style={{ background:T.gold+"12", border:`1px solid ${T.gold}55`, borderRadius:8, padding:14, marginBottom:16 }}>
      <div style={{ fontFamily:T.mono, fontSize:10, color:T.gold, textTransform:"uppercase", marginBottom:8, letterSpacing:1 }}>Shirt Making Instructions</div>
      <ol style={{ margin:0, paddingLeft:22, color:T.text, fontSize:13, lineHeight:1.9 }}>
        {points.map((p,i) => <li key={i} style={{ marginBottom:3 }}>{p}</li>)}
      </ol>
      <div style={{ display:"flex", gap:8, marginTop:10, flexWrap:"wrap" }}>
        <Btn label={busy==="hi"?"…":"हिंदी"} onClick={()=>tr("hi")} disabled={!!busy} small color={T.surface} textColor={T.gold} style={{ border:`1px solid ${T.border}` }} />
        <Btn label={busy==="gu"?"…":"ગુજરાતી"} onClick={()=>tr("gu")} disabled={!!busy} small color={T.surface} textColor={T.gold} style={{ border:`1px solid ${T.border}` }} />
        {(hi||gu) && <Btn label="Hide" onClick={()=>{setHi("");setGu("");}} small color={T.surface} textColor={T.steelLt} style={{ border:`1px solid ${T.border}` }} />}
      </div>
      {err && <div style={{ color:T.red, fontFamily:T.mono, fontSize:10, marginTop:6 }}>⚠ {err}</div>}
      {hi && <div style={{ marginTop:10, background:T.surface, borderRadius:8, padding:12 }}><div style={{ fontFamily:T.mono, fontSize:9, color:T.gold, marginBottom:6 }}>हिंदी</div><div style={{ whiteSpace:"pre-line", fontSize:14, color:T.white, lineHeight:1.8 }}>{hi}</div></div>}
      {gu && <div style={{ marginTop:10, background:T.surface, borderRadius:8, padding:12 }}><div style={{ fontFamily:T.mono, fontSize:9, color:T.gold, marginBottom:6 }}>ગુજરાતી</div><div style={{ whiteSpace:"pre-line", fontSize:14, color:T.white, lineHeight:1.8 }}>{gu}</div></div>}
    </div>
  );
}

function JobSheetView({ design }) {
  const sizes = sortSizes(design.activeColors && design.activeColors.length ? design.activeColors : ["S","M","L","XL","XXL"], design.customSizes);
  const hasSizes = (design.colors||[]).some(c => Object.keys(c.sizes||{}).length > 0);
  const totalPcs = (design.colors||[]).reduce((a,c) => a + sizes.reduce((x,s) => x + (+(c.sizes||{})[s]||0), 0), 0);
  return (
    <div style={{ fontFamily:T.sans, fontSize:12 }}>
      <div style={{ background:T.surface, borderRadius:8, padding:14, marginBottom:16, display:"grid", gridTemplateColumns:"1fr 1fr", gap:"6px 24px" }}>
        <div><span style={{ color:T.steelLt }}>Design No: </span><span style={{ color:T.gold, fontWeight:700, fontFamily:T.mono, fontSize:16 }}>{designLabel(design)}</span></div>
        <div><span style={{ color:T.steelLt }}>Brand: </span><span style={{ color:T.white }}>{design.brand}</span></div>
        <div><span style={{ color:T.steelLt }}>Style: </span><span style={{ color:T.white }}>{design.style}</span></div>
        <div><span style={{ color:T.steelLt }}>Fit: </span><span style={{ color:T.white }}>{design.fit}</span></div>
        <div><span style={{ color:T.steelLt }}>Collar: </span><span style={{ color:T.white }}>{design.collarType}</span></div>
        <div><span style={{ color:T.steelLt }}>Wash: </span><span style={{ color:T.white }}>{design.washType}</span></div>
        <div><span style={{ color:T.steelLt }}>Placket: </span><span style={{ color:T.white }}>{design.placket}</span></div>
        <div><span style={{ color:T.steelLt }}>Shrinkage: </span><span style={{ color:T.white }}>Length {design.shrinkageLen} · Width {design.shrinkageWid}</span></div>
        <div><span style={{ color:T.steelLt }}>Supplier: </span><span style={{ color:T.white }}>{design.supplier}</span></div>
      </div>
      {(design.instructions||"").trim() && <JobSheetInstructions text={design.instructions} />}
      {(design.specs||[]).some(sp => sp.text || sp.thumb) && (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))", gap:10, marginBottom:14 }}>
          {(design.specs||[]).filter(sp => sp.text || sp.thumb).map(sp => (
            <div key={sp.key} style={{ background:T.surface, borderRadius:8, padding:10, display:"flex", gap:8, alignItems:"center" }}>
              {sp.thumb && <img src={sp.thumb} alt="" onContextMenu={e=>e.preventDefault()} style={{ width:40, height:40, borderRadius:4, objectFit:"cover" }} draggable={false} />}
              <div><div style={{ fontFamily:T.mono, fontSize:9, color:T.steelLt, textTransform:"uppercase" }}>{sp.key}</div><div style={{ color:T.white, fontSize:12 }}>{sp.text||"—"}</div></div>
            </div>
          ))}
        </div>
      )}
      <div style={{ display:"flex", gap:"6px 24px", flexWrap:"wrap", marginBottom:14, fontSize:12 }}>
        {design.ratio && typeof design.ratio==="object" && Object.values(design.ratio).some(v=>v) && <div><span style={{ color:T.steelLt }}>Ratio: </span><span style={{ color:T.gold, fontFamily:T.mono }}>{sortSizes(design.activeColors, design.customSizes).filter(sz=>(design.ratio||{})[sz]).map(sz=>`${sz}:${design.ratio[sz]}`).join("  ")}</span></div>}
        {design.dateProgram && <div><span style={{ color:T.steelLt }}>Program given: </span><span style={{ color:T.white }}>{design.dateProgram}</span></div>}
        {design.dateCut && <div><span style={{ color:T.steelLt }}>Cut: </span><span style={{ color:T.white }}>{design.dateCut}</span></div>}
      </div>
      <AveragesBlock design={design} />
      <div style={{ height:14 }} />
      {!hasSizes && (
        <div style={{ background:T.orange+"22", border:`1px solid ${T.orange}`, borderRadius:8, padding:12, marginBottom:14, fontFamily:T.mono, fontSize:11, color:T.orange }}>
          ⚠ Sizes not yet filled — the cutting jobber will enter cut quantities per size.
        </div>
      )}
      <div style={{ overflowX:"auto", marginBottom:16 }}>
        <table style={{ borderCollapse:"collapse", fontSize:11, minWidth:"100%" }}>
          <thead>
            <tr style={{ background:T.surface }}>
              <th style={{ padding:"8px 6px", fontFamily:T.mono, fontSize:9, color:T.steelLt, textAlign:"left", border:`1px solid ${T.border}` }}>SWATCH</th>
              <th style={{ padding:"8px 10px", fontFamily:T.mono, fontSize:9, color:T.steelLt, textAlign:"left", border:`1px solid ${T.border}` }}>COLOR</th>
              <th style={{ padding:"8px", fontFamily:T.mono, fontSize:9, color:T.steelLt, border:`1px solid ${T.border}` }}>MTR</th>
              {sizes.map(s => <th key={s} style={{ padding:"8px 6px", fontFamily:T.mono, fontSize:9, color:T.gold, border:`1px solid ${T.border}`, minWidth:36 }}>{s}</th>)}
              <th style={{ padding:"8px", fontFamily:T.mono, fontSize:9, color:T.steelLt, border:`1px solid ${T.border}` }}>TOTAL</th>
              <th style={{ padding:"8px", fontFamily:T.mono, fontSize:9, color:T.steelLt, border:`1px solid ${T.border}` }}>REMARK</th>
            </tr>
          </thead>
          <tbody>
            {(design.colors||[]).map((c,i) => {
              const rt = sizes.reduce((a,s) => a+(+(c.sizes||{})[s]||0), 0);
              return (
                <tr key={c.id||i} style={{ background:i%2===0?T.card:T.surface }}>
                  <td style={{ padding:"4px 6px", border:`1px solid ${T.border}` }}>
                    <div onContextMenu={e=>e.preventDefault()} style={{ width:36, height:36, borderRadius:4, overflow:"hidden", background:T.bg, border:`1px solid ${T.border}` }}>
                      {c.swatch ? <img src={c.swatch} alt="" style={{ width:"100%", height:"100%", objectFit:"cover", pointerEvents:"none" }} draggable={false} /> : <div style={{ width:"100%", height:"100%", display:"flex", alignItems:"center", justifyContent:"center", color:T.textDim, fontSize:7, fontFamily:T.mono }}>—</div>}
                    </div>
                  </td>
                  <td style={{ padding:"6px 8px", color:T.white, fontWeight:600, border:`1px solid ${T.border}`, whiteSpace:"nowrap" }}>{c.colorName}{c.colorNo?` (${c.colorNo})`:""}</td>
                  <td style={{ padding:"6px", color:T.gold, fontFamily:T.mono, border:`1px solid ${T.border}`, textAlign:"center" }}>{c.meters}</td>
                  {sizes.map(s => <td key={s} style={{ padding:"6px", color:T.text, fontFamily:T.mono, border:`1px solid ${T.border}`, textAlign:"center" }}>{(c.sizes||{})[s]||0}</td>)}
                  <td style={{ padding:"6px", color:T.gold, fontFamily:T.mono, fontWeight:700, border:`1px solid ${T.border}`, textAlign:"center" }}>{rt}</td>
                  <td style={{ padding:"6px 8px", color:T.steelLt, border:`1px solid ${T.border}` }}>{c.balance||""}</td>
                </tr>
              );
            })}
            <tr style={{ background:T.bg }}>
              <td colSpan={2} style={{ padding:"8px", fontFamily:T.mono, fontWeight:700, color:T.gold, border:`1px solid ${T.border}` }}>TOTAL</td>
              <td style={{ padding:"8px", color:T.gold, fontFamily:T.mono, border:`1px solid ${T.border}`, textAlign:"center" }}>{totalMeters(design)}</td>
              {sizes.map(s => <td key={s} style={{ padding:"8px", fontFamily:T.mono, fontWeight:700, color:T.white, border:`1px solid ${T.border}`, textAlign:"center" }}>{(design.colors||[]).reduce((a,c)=>a+(+(c.sizes||{})[s]||0),0)}</td>)}
              <td style={{ padding:"8px", fontFamily:T.mono, fontWeight:900, color:T.gold, border:`1px solid ${T.border}`, textAlign:"center" }}>{totalPcs}</td>
              <td style={{ border:`1px solid ${T.border}` }} />
            </tr>
          </tbody>
        </table>
      </div>
      {design.notes && <div style={{ background:T.surface, borderRadius:8, padding:12, fontSize:12, color:T.text }}><span style={{ color:T.steelLt, fontFamily:T.mono, fontSize:10 }}>COMMON REMARK: </span>{design.notes}</div>}
    </div>
  );
}

// ── Size Editor (Job Register — fill cut sizes, samples, dispatch) ────────────
function SizeEditor({ design, onUpdate, role, onConfirmLock, L = (x)=>x, onSendLot, people = [], currentJobber }) {
  const [showSend, setShowSend] = useState(false);
  const [detailed, setDetailed] = useState(false);
  const sizes = sortSizes(design.activeColors && design.activeColors.length ? design.activeColors : ["S","M","L","XL","XXL"], design.customSizes);
  const isAdmin = role === "admin";
  const locked = !!design.locked;
  const canEdit = !locked;
  function updColor(id, k, v) { if (!canEdit) return; onUpdate({ ...design, colors: design.colors.map(c => c.id===id ? {...c,[k]:v} : c) }); }
  function setNotes(v) { if (!canEdit) return; onUpdate({ ...design, notes: v }); }
  function addSampleFabric(id) { if (!canEdit) return; onUpdate({ ...design, colors: design.colors.map(c => c.id===id ? {...c, sampleFabric:[...(c.sampleFabric||[]), {meters:"", date:new Date().toISOString().slice(0,10)}]} : c) }); }
  function updSampleFabric(id, idx, k, v) { if (!canEdit) return; onUpdate({ ...design, colors: design.colors.map(c => c.id===id ? {...c, sampleFabric:(c.sampleFabric||[]).map((sf,j)=>j===idx?{...sf,[k]:v}:sf)} : c) }); }
  function delSampleFabric(id, idx) { if (!canEdit) return; onUpdate({ ...design, colors: design.colors.map(c => c.id===id ? {...c, sampleFabric:(c.sampleFabric||[]).filter((_,j)=>j!==idx)} : c) }); }
  const totalPcs = (design.colors||[]).reduce((a,c) => a+sizes.reduce((x,s)=>x+(+(c.sizes||{})[s]||0),0), 0);
  const totalSample = totalSamplePcs(design);
  return (
    <div style={{ fontFamily:T.sans, fontSize:12 }}>
      {locked
        ? <div style={{ background:T.green+"22", border:`1px solid ${T.green}`, borderRadius:8, padding:12, marginBottom:14, fontFamily:T.mono, fontSize:11, color:T.green }}>🔒 Confirmed & locked by {design.lockedBy||"jobber"} · {design.lockedAtStr||""}. {isAdmin?"Tap Unlock below to edit.":"Only admin can unlock & change now."}</div>
        : <div style={{ background:T.surface, borderRadius:8, padding:12, marginBottom:14, fontFamily:T.mono, fontSize:11, color:T.steelLt }}>Fill TOTAL quantities per size for each colour. Tap Show Detailed Report to enter Samples (auto-calculates Dispatch). When done, tap <b style={{color:T.gold}}>Confirm & Lock</b>.</div>
      }
      <div style={{ background:T.surface, borderRadius:8, padding:14, marginBottom:14, display:"grid", gridTemplateColumns:"1fr 1fr", gap:"6px 24px" }}>
        <div><span style={{ color:T.steelLt }}>Design No: </span><span style={{ color:T.gold, fontWeight:700, fontFamily:T.mono, fontSize:16 }}>{designLabel(design)}</span></div>
        <div><span style={{ color:T.steelLt }}>Brand: </span><span style={{ color:T.white }}>{design.brand}</span></div>
        <div><span style={{ color:T.steelLt }}>Fit: </span><span style={{ color:T.white }}>{design.fit}</span></div>
        <div><span style={{ color:T.steelLt }}>Sleeve: </span><span style={{ color:T.white }}>{design.sleeveType||"Full"}</span></div>
        <div><span style={{ color:T.steelLt }}>Collar: </span><span style={{ color:T.white }}>{design.collarType}</span></div>
        <div><span style={{ color:T.steelLt }}>Wash: </span><span style={{ color:T.white }}>{design.washType}</span></div>
      </div>
      <div style={{ display:"flex", gap:8, marginBottom:14, flexWrap:"wrap" }}>
        {[["Embroidery",design.hasEmbroidery],["Print",design.hasPrint],["Vinyl",design.hasVinyl],["Pocket",design.hasPocket],["Buttons",design.hasButtons],["Label",design.hasLabel]].map(([l,v]) => (
          <Badge key={l} label={l} color={v ? T.green : T.steel} />
        ))}
      </div>
      <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:10 }}>
        <Btn label={detailed ? "Hide Detailed Report" : "Show Detailed Report"} onClick={() => setDetailed(d=>!d)} small color={T.surface} textColor={T.gold} style={{ border:`1px solid ${T.gold}44` }} />
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
        {(design.colors||[]).map((c,i) => {
          const sfMeters = (c.sampleFabric||[]).reduce((a,sf)=>a+(+sf.meters||0),0);
          const st = design.sleeveType || "Full";
          const variants = st==="Both" ? [["Full","sizes","samples"],["Half","sizesHalf","samplesHalf"]] : [[st, "sizes", "samples"]];
          return (
            <div key={c.id||i} style={{ display:"flex", gap:12, background:T.card, borderRadius:10, border:`1px solid ${T.border}`, padding:12 }}>
              <div onContextMenu={e=>e.preventDefault()} style={{ width:90, height:90, borderRadius:8, overflow:"hidden", background:T.bg, border:`1px solid ${T.border}`, flexShrink:0 }}>
                {c.swatch ? <img src={c.swatch} alt="" style={{ width:"100%", height:"100%", objectFit:"cover", pointerEvents:"none" }} draggable={false} /> : <div style={{ width:"100%", height:"100%", display:"flex", alignItems:"center", justifyContent:"center", color:T.textDim, fontSize:9, fontFamily:T.mono }}>No img</div>}
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:"flex", gap:10, alignItems:"center", flexWrap:"wrap", marginBottom:8 }}>
                  <span style={{ color:T.white, fontWeight:700, fontSize:14 }}>{c.colorName}</span>
                  <span style={{ fontFamily:T.mono, fontSize:11, color:T.steelLt }}>No:
                    <input disabled={!canEdit} value={c.colorNo||""} onChange={e=>updColor(c.id,"colorNo",e.target.value)} placeholder="—" style={{ background:canEdit?T.bg:T.card, border:`1px solid ${T.border}`, color:T.gold, fontFamily:T.mono, fontSize:11, width:50, padding:"2px 6px", marginLeft:4, borderRadius:4 }} />
                  </span>
                  <span style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt }}>Sleeve: {st}</span>
                </div>
                {variants.map(([vlabel, vsizes, vsamples]) => {
                  const total = sizes.reduce((a,s) => a+(+(c[vsizes]||{})[s]||0), 0);
                  const samp = sizes.reduce((a,s) => a+(+(c[vsamples]||{})[s]||0), 0);
                  const disp = total - samp;
                  return (
                    <div key={vlabel} style={{ marginBottom:10 }}>
                      {st==="Both" && <div style={{ fontFamily:T.mono, fontSize:10, color:T.gold, marginBottom:3, textTransform:"uppercase" }}>{vlabel} Sleeve</div>}
                      <div style={{ overflowX:"auto" }}>
                        <table style={{ borderCollapse:"collapse", fontSize:11 }}>
                          <thead>
                            <tr style={{ background:T.surface }}>
                              <th style={{ padding:"5px 8px", fontFamily:T.mono, fontSize:9, color:T.steelLt, border:`1px solid ${T.border}`, textAlign:"left" }}></th>
                              {sizes.map(sz => <th key={sz} style={{ padding:"5px 6px", fontFamily:T.mono, fontSize:9, color:T.gold, border:`1px solid ${T.border}`, minWidth:44 }}>{sz}</th>)}
                              <th style={{ padding:"5px 8px", fontFamily:T.mono, fontSize:9, color:T.steelLt, border:`1px solid ${T.border}` }}>TOTAL</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td style={{ padding:"4px 8px", fontFamily:T.mono, fontSize:9, color:T.white, border:`1px solid ${T.border}`, fontWeight:700 }}>TOTAL</td>
                              {sizes.map(sz => (
                                <td key={sz} style={{ padding:"3px", border:`1px solid ${T.border}` }}>
                                  <input type="number" disabled={!canEdit} value={(c[vsizes]||{})[sz]||""} onChange={e=>updColor(c.id, vsizes, {...(c[vsizes]||{}), [sz]:e.target.value})} placeholder="0" style={{ background:canEdit?T.bg:T.card, border:"none", color:T.text, fontFamily:T.mono, fontSize:13, width:40, padding:"6px 2px", textAlign:"center", opacity:canEdit?1:0.6 }} />
                                </td>
                              ))}
                              <td style={{ padding:"4px", color:T.gold, fontFamily:T.mono, fontWeight:700, border:`1px solid ${T.border}`, textAlign:"center" }}>{total}</td>
                            </tr>
                            {detailed && <>
                              <tr>
                                <td style={{ padding:"4px 8px", fontFamily:T.mono, fontSize:9, color:T.orange, border:`1px solid ${T.border}` }}>SAMPLE</td>
                                {sizes.map(sz => (
                                  <td key={sz} style={{ padding:"3px", border:`1px solid ${T.border}` }}>
                                    <input type="number" disabled={!canEdit} value={(c[vsamples]||{})[sz]||""} onChange={e=>updColor(c.id, vsamples, {...(c[vsamples]||{}), [sz]:e.target.value})} placeholder="0" style={{ background:canEdit?T.bg:T.card, border:"none", color:T.orange, fontFamily:T.mono, fontSize:11, width:40, padding:"4px 2px", textAlign:"center", opacity:canEdit?1:0.6 }} />
                                  </td>
                                ))}
                                <td style={{ padding:"4px", color:T.orange, fontFamily:T.mono, border:`1px solid ${T.border}`, textAlign:"center" }}>{samp}</td>
                              </tr>
                              <tr>
                                <td style={{ padding:"4px 8px", fontFamily:T.mono, fontSize:9, color:T.green, border:`1px solid ${T.border}` }}>DISPATCH</td>
                                {sizes.map(sz => { const t=+(c[vsizes]||{})[sz]||0, sm=+(c[vsamples]||{})[sz]||0; return <td key={sz} style={{ padding:"4px", color:T.green, fontFamily:T.mono, fontSize:11, border:`1px solid ${T.border}`, textAlign:"center" }}>{t-sm}</td>; })}
                                <td style={{ padding:"4px", color:T.green, fontFamily:T.mono, fontWeight:700, border:`1px solid ${T.border}`, textAlign:"center" }}>{disp}</td>
                              </tr>
                            </>}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
                <input disabled={!canEdit} value={c.balance||""} onChange={e=>updColor(c.id,"balance",e.target.value)} placeholder="remark / balance fabric" style={{ background:canEdit?T.bg:T.card, border:`1px solid ${T.border}`, borderRadius:4, color:T.text, fontFamily:T.sans, fontSize:11, width:"100%", padding:"5px 8px", marginTop:4, boxSizing:"border-box", opacity:canEdit?1:0.6 }} />
                <div style={{ display:"flex", gap:12, alignItems:"center", marginTop:8, flexWrap:"wrap" }}>
                  <span style={{ fontFamily:T.mono, fontSize:11, color:T.steelLt }}>Fabric:
                    <input type="number" disabled={!canEdit} value={c.meters||""} onChange={e=>updColor(c.id,"meters",e.target.value)} placeholder="0" style={{ background:canEdit?T.bg:T.card, border:`1px solid ${T.border}`, color:T.gold, fontFamily:T.mono, fontSize:11, width:60, padding:"2px 6px", marginLeft:4, borderRadius:4 }} /> m
                  </span>
                  {sfMeters>0 && <span style={{ fontFamily:T.mono, fontSize:11, color:T.steelLt }}>{(+c.meters||0)} − {sfMeters} sample = <b style={{color:T.white}}>{((+c.meters||0)-sfMeters).toFixed(1)}</b> net</span>}
                  {detailed && canEdit && <button onClick={()=>addSampleFabric(c.id)} style={{ background:"none", border:`1px solid ${T.gold}55`, color:T.gold, borderRadius:4, fontSize:10, fontFamily:T.mono, padding:"3px 8px", cursor:"pointer" }}>+ sample fabric</button>}
                </div>
                {detailed && (c.sampleFabric||[]).length>0 && (
                  <div style={{ marginTop:6, display:"flex", flexDirection:"column", gap:4 }}>
                    {(c.sampleFabric||[]).map((sf,idx) => (
                      <div key={idx} style={{ display:"flex", gap:8, alignItems:"center", fontSize:11 }}>
                        <input type="number" disabled={!canEdit} value={sf.meters} onChange={e=>updSampleFabric(c.id,idx,"meters",e.target.value)} placeholder="m" style={{ background:T.bg, border:`1px solid ${T.border}`, color:T.gold, fontFamily:T.mono, fontSize:11, width:55, padding:"3px 6px", borderRadius:4 }} />
                        <span style={{ color:T.steelLt }}>m on</span>
                        <input type="date" disabled={!canEdit} value={sf.date} onChange={e=>updSampleFabric(c.id,idx,"date",e.target.value)} style={{ background:T.bg, border:`1px solid ${T.border}`, color:T.text, fontFamily:T.mono, fontSize:10, padding:"3px 6px", borderRadius:4 }} />
                        {canEdit && <button onClick={()=>delSampleFabric(c.id,idx)} style={{ background:"none", border:"none", color:T.red, cursor:"pointer", fontSize:13 }}>✕</button>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <datalist id="sleeveopts"><option value="Full" /><option value="Half" /></datalist>
      <div style={{ marginTop:14, background:T.bg, borderRadius:8, padding:"12px 16px", border:`1px solid ${T.border}` }}>
        {!detailed
          ? <div style={{ fontFamily:T.mono, fontSize:13, color:T.gold, fontWeight:700 }}>GRAND TOTAL: {totalPcs} pcs &nbsp;·&nbsp; Fabric: {totalMeters(design)} m</div>
          : <div style={{ fontFamily:T.mono, fontSize:13, color:T.gold, fontWeight:700, lineHeight:1.7 }}>
              Total {totalPcs} = Sample {totalSample} + Dispatch {totalPcs-totalSample}<br/>
              Fabric: {(totalMeters(design)-sampleMeters(design)).toFixed(1)} net + {sampleMeters(design).toFixed(1)} sample = {totalMeters(design)} m
            </div>
        }
      </div>
      <div style={{ marginTop:14 }}>
        <div style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, marginBottom:6, textTransform:"uppercase" }}>Common Remark (end)</div>
        <textarea disabled={!canEdit} value={design.notes||""} onChange={e => setNotes(e.target.value)} placeholder="Common remark for the whole design..." style={{ width:"100%", minHeight:60, background:canEdit?T.surface:T.card, border:`1px solid ${T.border}`, borderRadius:6, color:T.text, fontFamily:T.sans, fontSize:13, padding:10, boxSizing:"border-box", resize:"vertical", opacity:canEdit?1:0.7 }} />
      </div>
      <div style={{ marginTop:14 }}>
        <div style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, marginBottom:4, textTransform:"uppercase" }}>Fabric Averages</div>
        <AveragesBlock design={design} />
      </div>
      {!locked && onConfirmLock && (
        <div style={{ marginTop:16, display:"flex", justifyContent:"flex-end", gap:10, flexWrap:"wrap" }}>
          {onSendLot && <Btn label={"📤 "+L("Send To Next")} onClick={() => setShowSend(true)} color={T.gold} textColor={T.bg} />}
          <Btn label={"✓ "+L("Confirm & Lock")} onClick={onConfirmLock} color={T.green} textColor="#fff" />
        </div>
      )}
      {locked && onSendLot && (
        <div style={{ marginTop:16, display:"flex", justifyContent:"flex-end" }}>
          <Btn label={"📤 "+L("Send To Next")} onClick={() => setShowSend(true)} color={T.gold} textColor={T.bg} />
        </div>
      )}
      {showSend && onSendLot && <SendToModal design={design} people={people} fromJobber={currentJobber} L={L} onClose={() => setShowSend(false)} onSend={(mv) => { onSendLot(mv); setShowSend(false); }} />}
      {locked && isAdmin && onConfirmLock && (
        <div style={{ marginTop:16, display:"flex", justifyContent:"flex-end", gap:10 }}>
          <Btn label="🔓 Unlock for editing" onClick={onConfirmLock} color={T.orange} textColor="#fff" />
        </div>
      )}
    </div>
  );
}

// ── Reference Photos ──────────────────────────────────────────────────────────
function ReferencePhotos({ design, onUpdate, role }) {
  const fileRef = useRef();
  const [lightbox, setLightbox] = useState(null);
  const [note, setNote] = useState("");
  const [editNote, setEditNote] = useState(null);
  const canEdit = role === "admin" || role === "team";
  function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    compressImage(file).then(src => {
      onUpdate({ ...design, photos: [...(design.photos||[]), { id:`P${Date.now()}`, src, note, date:new Date().toISOString().slice(0,10) }] });
      setNote("");
    }).catch(() => {});
  }
  function removePhoto(id) { onUpdate({ ...design, photos:(design.photos||[]).filter(p => p.id!==id) }); }
  function saveNote(id, n) { onUpdate({ ...design, photos:(design.photos||[]).map(p => p.id===id ? {...p,note:n} : p) }); setEditNote(null); }
  return (
    <div>
      {canEdit && (
        <div style={{ display:"flex", gap:10, marginBottom:16, alignItems:"flex-end", background:T.surface, borderRadius:8, padding:14 }}>
          <Inp label="Comment / Spec Note" value={note} onChange={setNote} placeholder="e.g. Front view — collar stitching detail" style={{ flex:1 }} />
          <Btn label="+ Add Photo" onClick={() => fileRef.current.click()} />
          <input ref={fileRef} type="file" accept="image/*" style={{ display:"none" }} onChange={handleFile} />
        </div>
      )}
      {(!design.photos || design.photos.length===0) && <div style={{ textAlign:"center", color:T.textDim, padding:40, fontFamily:T.mono, fontSize:12 }}>No reference photos yet.</div>}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))", gap:14 }}>
        {(design.photos||[]).map((p,i) => (
          <div key={p.id||i} style={{ borderRadius:8, overflow:"hidden", border:`1px solid ${T.border}`, background:T.surface }}>
            <div style={{ position:"relative", paddingBottom:"75%", backgroundImage:`url(${p.src})`, backgroundSize:"cover", backgroundPosition:"center", cursor:"pointer" }} onClick={() => setLightbox(p)} onContextMenu={e => e.preventDefault()}>
              <span style={{ position:"absolute", bottom:4, right:4, fontFamily:T.mono, fontSize:8, color:"#ffffff88", transform:"rotate(-30deg)", whiteSpace:"nowrap", pointerEvents:"none" }}>AASHISH·{design.designNo}</span>
              {canEdit && <button onClick={e => { e.stopPropagation(); removePhoto(p.id); }} style={{ position:"absolute", top:6, right:6, background:T.red, border:"none", color:"#fff", borderRadius:4, width:20, height:20, cursor:"pointer", fontSize:11, lineHeight:"20px", textAlign:"center" }}>✕</button>}
            </div>
            <div style={{ padding:"8px 10px" }}>
              {editNote === p.id
                ? <div style={{ display:"flex", gap:6 }}>
                    <input defaultValue={p.note} id={`n_${p.id}`} style={{ flex:1, background:T.bg, border:`1px solid ${T.border}`, borderRadius:4, color:T.text, fontSize:11, padding:"4px 6px" }} />
                    <Btn label="Save" onClick={() => saveNote(p.id, document.getElementById(`n_${p.id}`).value)} small />
                  </div>
                : <div style={{ display:"flex", justifyContent:"space-between", alignItems:"start", gap:6 }}>
                    <div style={{ fontSize:11, color:T.steelLt, flex:1 }}>{p.note || <span style={{ color:T.textDim, fontStyle:"italic" }}>No comment</span>}</div>
                    {canEdit && <button onClick={() => setEditNote(p.id)} style={{ background:"none", border:"none", color:T.gold, fontSize:11, cursor:"pointer", padding:0 }}>Edit</button>}
                  </div>
              }
              <div style={{ fontSize:9, color:T.textDim, marginTop:4, fontFamily:T.mono }}>{p.date}</div>
            </div>
          </div>
        ))}
      </div>
      {lightbox && (
        <div style={{ position:"fixed", inset:0, background:"#000D", zIndex:2000, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }} onClick={() => setLightbox(null)} onContextMenu={e => e.preventDefault()}>
          <div style={{ position:"relative", maxWidth:"90vw", maxHeight:"85vh" }} onClick={e => e.stopPropagation()}>
            <img src={lightbox.src} alt="" style={{ maxWidth:"90vw", maxHeight:"80vh", borderRadius:8, pointerEvents:"none", userSelect:"none", display:"block" }} draggable={false} onContextMenu={e => e.preventDefault()} />
            <div style={{ position:"absolute", inset:0, overflow:"hidden", pointerEvents:"none" }}>
              {[...Array(5)].map((_,i) => <span key={i} style={{ position:"absolute", top:`${15+i*18}%`, left:`${5+i*8}%`, fontFamily:T.mono, fontSize:13, color:"#ffffff25", transform:"rotate(-30deg)", whiteSpace:"nowrap" }}>AASHISH APPARELS · {design.designNo}</span>)}
            </div>
          </div>
          {lightbox.note && <div style={{ marginTop:8, color:T.text, fontSize:13, background:T.card, padding:"8px 16px", borderRadius:6 }}>{lightbox.note}</div>}
          <button onClick={() => setLightbox(null)} style={{ marginTop:16, background:T.red, color:"#fff", border:"none", borderRadius:6, padding:"8px 24px", cursor:"pointer", fontFamily:T.mono }}>CLOSE</button>
        </div>
      )}
    </div>
  );
}

// ── Supplier Bills ────────────────────────────────────────────────────────────
function SupplierBills({ design, onUpdate, role }) {
  const canEdit = role === "admin" || role === "team";
  const [form, setForm] = useState({ supplier:"", billNo:"", billDate:"", lrNo:"", qty:"", rate:"", amount:"", photo:"" });
  const [lightbox, setLightbox] = useState(null);
  const bills = design.supplierBills || [];
  const upd = k => v => setForm(f => ({ ...f, [k]:v }));
  function setQtyRate(k,v){ setForm(f => { const nf={...f,[k]:v}; nf.amount = ((+nf.qty||0)*(+nf.rate||0))?String(((+nf.qty||0)*(+nf.rate||0))):nf.amount; return nf; }); }
  function addBill() {
    if (!form.supplier) return;
    onUpdate({ ...design, supplierBills:[...bills, { ...form, designNo: design.designNo, id:`B${Date.now()}` }] });
    setForm({ supplier:"", billNo:"", billDate:"", lrNo:"", qty:"", rate:"", amount:"", photo:"" });
  }
  function removeBill(id) { onUpdate({ ...design, supplierBills:bills.filter(b => b.id!==id) }); }
  const totalAmt = bills.reduce((a,b) => a+(+b.amount||0), 0);
  const totalQty = bills.reduce((a,b) => a+(+b.qty||0), 0);
  return (
    <div>
      {canEdit && (
        <div style={{ background:T.surface, borderRadius:8, padding:14, marginBottom:16 }}>
          <div style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, marginBottom:10, textTransform:"uppercase" }}>Add Fabric Supplier Bill — Design {design.designNo}</div>
          <div style={{ display:"flex", gap:12, marginBottom:10, alignItems:"flex-start", flexWrap:"wrap" }}>
            <PhotoUpload label="Bill Photo" value={form.photo} onChange={upd("photo")} size={56} />
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))", gap:10, flex:1 }}>
              <Inp label="Bill Date" type="date" value={form.billDate} onChange={upd("billDate")} />
              <Inp label="Particulars (Supplier)" value={form.supplier} onChange={upd("supplier")} placeholder="Supplier name" />
              <Inp label="Quantity (meters)" type="number" value={form.qty} onChange={v => setQtyRate("qty",v)} />
              <Inp label="Rate (Rs.)" type="number" value={form.rate} onChange={v => setQtyRate("rate",v)} />
              <Inp label="Amount (Rs.)" type="number" value={form.amount} onChange={upd("amount")} />
              <Inp label="LR Number" value={form.lrNo} onChange={upd("lrNo")} />
              <Inp label="Bill No" value={form.billNo} onChange={upd("billNo")} />
            </div>
          </div>
          <Btn label="+ Add Bill" onClick={addBill} />
        </div>
      )}
      <div style={{ overflowX:"auto" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
          <thead>
            <tr style={{ background:T.surface }}>
              {["Sr","Bill Date","Particulars","Design","Qty","Rate","Amount","LR No","Bill","",].map(h => (
                <th key={h} style={{ padding:"8px 10px", fontFamily:T.mono, fontSize:9, color:T.steelLt, textAlign:"left", textTransform:"uppercase", borderBottom:`1px solid ${T.border}`, whiteSpace:"nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bills.map((b,i) => (
              <tr key={b.id||i} style={{ background:i%2===0?T.card:T.surface, borderBottom:`1px solid ${T.border}`, borderLeft:`4px solid ${monthColor(b.billDate)}` }}>
                <td style={{ padding:"8px 10px", fontFamily:T.mono, color:T.steelLt }}>{i+1}</td>
                <td style={{ padding:"8px 10px", color:T.steelLt }}>{b.billDate||"—"}</td>
                <td style={{ padding:"8px 10px", color:T.white, fontWeight:600 }}>{b.supplier}</td>
                <td style={{ padding:"8px 10px", color:T.gold, fontFamily:T.mono }}>{b.designNo||design.designNo}</td>
                <td style={{ padding:"8px 10px", color:T.text, fontFamily:T.mono }}>{b.qty||"—"}</td>
                <td style={{ padding:"8px 10px", color:T.gold, fontFamily:T.mono }}>Rs.{b.rate||"—"}</td>
                <td style={{ padding:"8px 10px", color:T.white, fontFamily:T.mono, fontWeight:700 }}>Rs.{b.amount||"—"}</td>
                <td style={{ padding:"8px 10px", color:T.steelLt, fontFamily:T.mono }}>{b.lrNo||"—"}</td>
                <td style={{ padding:"8px 10px" }}>{b.photo ? <img src={b.photo} alt="" onClick={() => setLightbox(b.photo)} onContextMenu={e=>e.preventDefault()} style={{ width:32, height:32, borderRadius:4, objectFit:"cover", cursor:"pointer" }} draggable={false} /> : <span style={{ color:T.textDim }}>—</span>}</td>
                <td style={{ padding:"8px 10px" }}>{canEdit && <Btn label="✕" onClick={() => removeBill(b.id)} color={T.red+"22"} textColor={T.red} small />}</td>
              </tr>
            ))}
          </tbody>
          {bills.length > 0 && (
            <tfoot>
              <tr style={{ background:T.surface }}>
                <td colSpan={4} style={{ padding:"10px", fontFamily:T.mono, fontWeight:700, color:T.gold }}>TOTAL</td>
                <td style={{ padding:"10px", fontFamily:T.mono, color:T.gold, fontWeight:700 }}>{totalQty}</td>
                <td />
                <td style={{ padding:"10px", fontFamily:T.mono, fontWeight:900, color:T.gold, fontSize:14 }}>Rs.{totalAmt.toFixed(2)}</td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {bills.length === 0 && <div style={{ textAlign:"center", color:T.textDim, padding:30, fontFamily:T.mono, fontSize:12 }}>No bills added yet.</div>}
      {lightbox && (
        <div style={{ position:"fixed", inset:0, background:"#000D", zIndex:2000, display:"flex", alignItems:"center", justifyContent:"center" }} onClick={() => setLightbox(null)} onContextMenu={e=>e.preventDefault()}>
          <img src={lightbox} alt="" style={{ maxWidth:"90vw", maxHeight:"85vh", borderRadius:8 }} draggable={false} />
        </div>
      )}
    </div>
  );
}
function CustomerOrders({ design, onUpdate, role }) {
  const canEdit = role === "admin" || role === "team";
  const sizes = sortSizes(design.activeColors && design.activeColors.length ? design.activeColors : ["S","M","L","XL","XXL"], design.customSizes);
  const [form, setForm] = useState({ customer:"", colorId:"", sizes:{} });
  const orders = design.customerOrders || [];
  function updSize(s, v) { setForm(f => ({ ...f, sizes:{ ...f.sizes, [s]:v } })); }
  function addOrder() {
    if (!form.customer || !form.colorId) return;
    const total = sizes.reduce((a,s) => a+(+(form.sizes[s]||0)), 0);
    if (!total) return;
    onUpdate({ ...design, customerOrders:[...orders, { ...form, id:`O${Date.now()}`, total }] });
    setForm({ customer:"", colorId:"", sizes:{} });
  }
  function removeOrder(id) { onUpdate({ ...design, customerOrders:orders.filter(o => o.id!==id) }); }
  const summary = (design.colors||[]).map(c => {
    const co = orders.filter(o => o.colorId===c.id);
    const ord = {};
    sizes.forEach(s => { ord[s] = co.reduce((a,o) => a+(+(o.sizes||{})[s]||0), 0); });
    const totalOrd = sizes.reduce((a,s) => a+(ord[s]||0), 0);
    const totalCut = sizes.reduce((a,s) => a+(+(c.sizes||{})[s]||0), 0);
    return { ...c, ord, totalOrd, totalCut, bal:totalCut-totalOrd };
  });
  return (
    <div>
      {canEdit && (
        <div style={{ background:T.surface, borderRadius:8, padding:14, marginBottom:16 }}>
          <div style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, marginBottom:10, textTransform:"uppercase" }}>Add Customer Order</div>
          <div style={{ display:"flex", gap:10, flexWrap:"wrap", marginBottom:10, alignItems:"flex-end" }}>
            <Inp label="Customer Name" value={form.customer} onChange={v => setForm(f => ({...f,customer:v}))} placeholder="Customer / buyer" style={{ minWidth:180 }} />
            <Inp label="Color" value={form.colorId} onChange={v => setForm(f => ({...f,colorId:v}))} options={(design.colors||[]).map(c => c.id)} style={{ minWidth:160 }} />
          </div>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"flex-end", marginBottom:10 }}>
            {sizes.map(s => (
              <div key={s} style={{ textAlign:"center" }}>
                <div style={{ fontFamily:T.mono, fontSize:9, color:T.gold, marginBottom:3 }}>{s}</div>
                <input type="number" value={form.sizes[s]||""} onChange={e => updSize(s,e.target.value)} placeholder="0" style={{ background:T.bg, border:`1px solid ${T.border}`, borderRadius:4, color:T.text, fontFamily:T.mono, fontSize:12, width:48, padding:"5px 4px", textAlign:"center" }} />
              </div>
            ))}
          </div>
          <Btn label="+ Add Order" onClick={addOrder} />
        </div>
      )}
      {orders.length > 0 && (
        <div style={{ marginBottom:16 }}>
          <div style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, textTransform:"uppercase", marginBottom:8 }}>All Orders</div>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11 }}>
            <thead>
              <tr style={{ background:T.surface }}>
                <th style={{ padding:"8px 10px", fontFamily:T.mono, fontSize:9, color:T.steelLt, textAlign:"left", borderBottom:`1px solid ${T.border}` }}>CUSTOMER</th>
                <th style={{ padding:"8px 10px", fontFamily:T.mono, fontSize:9, color:T.steelLt, textAlign:"left", borderBottom:`1px solid ${T.border}` }}>COLOR</th>
                {sizes.map(s => <th key={s} style={{ padding:"8px 6px", fontFamily:T.mono, fontSize:9, color:T.gold, borderBottom:`1px solid ${T.border}`, minWidth:36, textAlign:"center" }}>{s}</th>)}
                <th style={{ padding:"8px", fontFamily:T.mono, fontSize:9, color:T.steelLt, borderBottom:`1px solid ${T.border}`, textAlign:"center" }}>TOTAL</th>
                <th style={{ borderBottom:`1px solid ${T.border}` }} />
              </tr>
            </thead>
            <tbody>
              {orders.map((o,i) => {
                const cn = (design.colors||[]).find(c => c.id===o.colorId)?.colorName || o.colorId;
                return (
                  <tr key={o.id||i} style={{ background:i%2===0?T.card:T.surface, borderBottom:`1px solid ${T.border}` }}>
                    <td style={{ padding:"8px 10px", color:T.white, fontWeight:600 }}>{o.customer}</td>
                    <td style={{ padding:"8px 10px", color:T.steelLt }}>{cn}</td>
                    {sizes.map(s => <td key={s} style={{ padding:"8px 6px", color:T.text, fontFamily:T.mono, textAlign:"center" }}>{(o.sizes||{})[s]||0}</td>)}
                    <td style={{ padding:"8px", color:T.gold, fontFamily:T.mono, fontWeight:700, textAlign:"center" }}>{o.total||0}</td>
                    <td style={{ padding:"8px" }}>{canEdit && <Btn label="✕" onClick={() => removeOrder(o.id)} color={T.red+"22"} textColor={T.red} small />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, textTransform:"uppercase", marginBottom:8 }}>Order vs Cut Summary</div>
      <div style={{ overflowX:"auto" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11 }}>
          <thead>
            <tr style={{ background:T.surface }}>
              <th style={{ padding:"8px 10px", fontFamily:T.mono, fontSize:9, color:T.steelLt, textAlign:"left", border:`1px solid ${T.border}` }}>COLOR</th>
              <th style={{ padding:"8px 10px", fontFamily:T.mono, fontSize:9, color:T.steelLt, border:`1px solid ${T.border}`, textAlign:"center" }}>TYPE</th>
              {sizes.map(s => <th key={s} style={{ padding:"8px 6px", fontFamily:T.mono, fontSize:9, color:T.gold, border:`1px solid ${T.border}`, minWidth:36, textAlign:"center" }}>{s}</th>)}
              <th style={{ padding:"8px", fontFamily:T.mono, fontSize:9, color:T.steelLt, border:`1px solid ${T.border}`, textAlign:"center" }}>TOTAL</th>
            </tr>
          </thead>
          <tbody>
            {summary.map((c,i) => (
              <Fragment key={c.id||i}>
                <tr style={{ background:i%2===0?T.card:T.surface }}>
                  <td rowSpan={3} style={{ padding:"8px 10px", color:T.white, fontWeight:600, border:`1px solid ${T.border}`, verticalAlign:"middle" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      {c.swatch && <img src={c.swatch} alt="" style={{ width:28, height:28, borderRadius:3, objectFit:"cover" }} draggable={false} onContextMenu={e => e.preventDefault()} />}
                      {c.colorName}
                    </div>
                  </td>
                  <td style={{ padding:"6px 10px", fontFamily:T.mono, fontSize:10, color:T.steelLt, border:`1px solid ${T.border}`, textAlign:"center" }}>ORDERED</td>
                  {sizes.map(s => <td key={s} style={{ padding:"6px", fontFamily:T.mono, color:T.text, border:`1px solid ${T.border}`, textAlign:"center" }}>{c.ord[s]||0}</td>)}
                  <td style={{ padding:"6px", fontFamily:T.mono, color:T.text, border:`1px solid ${T.border}`, textAlign:"center", fontWeight:700 }}>{c.totalOrd}</td>
                </tr>
                <tr style={{ background:i%2===0?T.card:T.surface }}>
                  <td style={{ padding:"6px 10px", fontFamily:T.mono, fontSize:10, color:T.gold, border:`1px solid ${T.border}`, textAlign:"center" }}>CUT</td>
                  {sizes.map(s => <td key={s} style={{ padding:"6px", fontFamily:T.mono, color:T.gold, border:`1px solid ${T.border}`, textAlign:"center" }}>{(c.sizes||{})[s]||0}</td>)}
                  <td style={{ padding:"6px", fontFamily:T.mono, color:T.gold, border:`1px solid ${T.border}`, textAlign:"center", fontWeight:700 }}>{c.totalCut}</td>
                </tr>
                <tr style={{ background:i%2===0?T.card:T.surface }}>
                  <td style={{ padding:"6px 10px", fontFamily:T.mono, fontSize:10, color:c.bal>=0?T.green:T.red, border:`1px solid ${T.border}`, textAlign:"center" }}>BALANCE</td>
                  {sizes.map(s => {
                    const b = ((c.sizes||{})[s]||0) - (c.ord[s]||0);
                    return <td key={s} style={{ padding:"6px", fontFamily:T.mono, color:b>=0?T.green:T.red, border:`1px solid ${T.border}`, textAlign:"center", fontWeight:700 }}>{b}</td>;
                  })}
                  <td style={{ padding:"6px", fontFamily:T.mono, color:c.bal>=0?T.green:T.red, border:`1px solid ${T.border}`, textAlign:"center", fontWeight:700 }}>{c.bal}</td>
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Process Register (with code generation) ───────────────────────────────────
function ProcessRegister({ design, jobbers, onUpdate, role }) {
  const isAdmin = role === "admin";
  const [showRate, setShowRate] = useState(true);
  const totalPcs = (design.colors||[]).reduce((a,c) => a+Object.values(c.sizes||{}).reduce((x,v) => x+(+v||0), 0), 0);
  const procs = design.processes || {};
  const headers = ["Process","Jobber",...(isAdmin?["Rate/pc","Code","Recd Date","Dlvd Date","Days"]:[]),"Status"];
  return (
    <div style={{ overflowX:"auto" }}>
      <div style={{ marginBottom:10, fontFamily:T.mono, fontSize:11, color:T.steelLt }}>
        Total Pieces: <span style={{ color:T.gold, fontSize:14, fontWeight:700 }}>{totalPcs}</span>&nbsp;·&nbsp;Supplier: <span style={{ color:T.white }}>{design.supplier}</span>
        {(() => {
          let slow=null, max=-1;
          PROCESSES.forEach(p => { const pr=procs[p]; const dys=daysBetween(pr?.recdDate, pr?.dlvdDate); if (dys!=null && dys>max) { max=dys; slow=p; } });
          return slow!=null ? <span>&nbsp;·&nbsp;Slowest: <span style={{ color:T.orange, fontWeight:700 }}>{slow} ({max} days)</span></span> : null;
        })()}
        {isAdmin && <button onClick={() => setShowRate(v=>!v)} style={{ marginLeft:12, background:T.surface, border:`1px solid ${T.border}`, color:T.steelLt, borderRadius:6, padding:"4px 12px", fontFamily:T.mono, fontSize:10, cursor:"pointer" }}>{showRate?"Hide rates":"Show rates"}</button>}
      </div>
      <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11 }}>
        <thead>
          <tr style={{ background:T.surface }}>
            {headers.map(h => <th key={h} style={{ padding:"8px 10px", fontFamily:T.mono, fontSize:9, color:T.steelLt, textAlign:"left", textTransform:"uppercase", borderBottom:`1px solid ${T.border}`, whiteSpace:"nowrap" }}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {PROCESSES.map((p,i) => {
            const proc = procs[p] || {};
            const splits = proc.splits || [];
            const jobber = jobbers.find(j => j.id===proc.jobber);
            const jName = jobber?.name || "—";
            const prefix = proc.prefix || codeForProcess(jobber, p);
            const code = buildCode(prefix, proc.rate);
            return (
              <Fragment key={p}>
                <tr style={{ background:i%2===0?T.card:T.surface, borderBottom: splits.length?`none`:`1px solid ${T.border}` }}>
                  <td style={{ padding:"8px 10px", color:T.white, fontWeight:700, whiteSpace:"nowrap" }}>
                    {p}
                    {isAdmin && <button onClick={() => onUpdate(p,"__addsplit__","")} title="Split this process (e.g. Cutting + Stitching)" style={{ marginLeft:6, background:T.gold, color:T.bg, border:"none", borderRadius:4, width:18, height:18, cursor:"pointer", fontSize:12, fontWeight:900, lineHeight:"16px" }}>+</button>}
                    {splits.length>0 && <div style={{ fontFamily:T.mono, fontSize:8, color:T.gold, marginTop:2 }}>{proc.label||"Main"}</div>}
                  </td>
                  <td style={{ padding:"4px 6px", minWidth:160 }}>
                    {isAdmin
                      ? <select value={proc.jobber||""} onChange={e => onUpdate(p,"jobber",e.target.value)} style={{ background:T.bg, border:`1px solid ${T.border}`, color:T.text, borderRadius:4, padding:"4px 6px", fontSize:11, width:"100%" }}>
                          <option value="">— select —</option>
                          <optgroup label={`Does ${p}`}>
                            {jobbers.filter(j => jobberDoesProcess(j,p)).map(j => <option key={j.id} value={j.id}>{j.name} ({codeForProcess(j,p)})</option>)}
                          </optgroup>
                          <optgroup label="All others">
                            {jobbers.filter(j => !jobberDoesProcess(j,p)).map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
                          </optgroup>
                        </select>
                      : <span style={{ color:T.text, padding:"8px 10px", display:"block" }}>{jName}</span>
                    }
                  </td>
                  {isAdmin && (
                    <>
                      <td style={{ padding:"4px 6px" }}>{showRate ? <input type="number" value={proc.rate||""} onChange={e => onUpdate(p,"rate",e.target.value)} placeholder="0" style={{ background:T.bg, border:`1px solid ${T.border}`, color:T.gold, borderRadius:4, padding:"4px 6px", fontSize:11, width:60, fontFamily:T.mono }} /> : <span style={{ color:T.textDim, fontFamily:T.mono }}>••••</span>}</td>
                      <td style={{ padding:"8px 10px", fontFamily:T.mono, color:T.gold, fontWeight:700 }}>{showRate ? (code||"—") : "••••"}</td>
                      <td style={{ padding:"4px 6px" }}><input type="date" value={proc.recdDate||""} onChange={e => onUpdate(p,"recdDate",e.target.value)} style={{ background:T.bg, border:`1px solid ${T.border}`, color:T.text, borderRadius:4, padding:"4px 6px", fontSize:11 }} /></td>
                      <td style={{ padding:"4px 6px" }}><input type="date" value={proc.dlvdDate||""} onChange={e => onUpdate(p,"dlvdDate",e.target.value)} style={{ background:T.bg, border:`1px solid ${T.border}`, color:T.text, borderRadius:4, padding:"4px 6px", fontSize:11 }} /></td>
                      <td style={{ padding:"8px 10px", fontFamily:T.mono, color:T.steelLt }}>{daysBetween(proc.recdDate, proc.dlvdDate) ?? "—"}</td>
                    </>
                  )}
                  <td style={{ padding:"8px 10px" }}>{proc.jobber ? <Badge label="Assigned" color={T.gold} /> : <Badge label="Pending" color={T.steel} />}</td>
                </tr>
                {splits.map((sp, si) => {
                  const sjob = jobbers.find(j => j.id===sp.jobber);
                  const sprefix = sp.prefix || codeForProcess(sjob, p);
                  const scode = buildCode(sprefix, sp.rate);
                  return (
                    <tr key={p+"_s"+si} style={{ background:i%2===0?T.card:T.surface, borderBottom: si===splits.length-1?`1px solid ${T.border}`:"none" }}>
                      <td style={{ padding:"4px 10px 4px 24px", whiteSpace:"nowrap" }}>
                        {isAdmin
                          ? <input value={sp.label||""} onChange={e => onUpdate(p,"__splitfield__",{ idx:si, field:"label", value:e.target.value })} placeholder="label e.g. Cutting" style={{ background:T.bg, border:`1px solid ${T.border}`, color:T.gold, borderRadius:4, padding:"4px 6px", fontSize:10, width:100 }} />
                          : <span style={{ color:T.gold, fontSize:10 }}>{sp.label}</span>}
                        {isAdmin && <button onClick={() => onUpdate(p,"__delsplit__",si)} style={{ marginLeft:4, background:T.red+"33", color:T.red, border:"none", borderRadius:4, width:18, height:18, cursor:"pointer", fontSize:11 }}>✕</button>}
                      </td>
                      <td style={{ padding:"4px 6px" }}>
                        {isAdmin
                          ? <select value={sp.jobber||""} onChange={e => onUpdate(p,"__splitfield__",{ idx:si, field:"jobber", value:e.target.value })} style={{ background:T.bg, border:`1px solid ${T.border}`, color:T.text, borderRadius:4, padding:"4px 6px", fontSize:11, width:"100%" }}>
                              <option value="">— select —</option>
                              {jobbers.map(j => <option key={j.id} value={j.id}>{j.name}{j.prefix?` (${j.prefix})`:""}</option>)}
                            </select>
                          : <span style={{ color:T.text }}>{sjob?.name||"—"}</span>}
                      </td>
                      {isAdmin && (
                        <>
                          <td style={{ padding:"4px 6px" }}>{showRate ? <input type="number" value={sp.rate||""} onChange={e => onUpdate(p,"__splitfield__",{ idx:si, field:"rate", value:e.target.value })} placeholder="0" style={{ background:T.bg, border:`1px solid ${T.border}`, color:T.gold, borderRadius:4, padding:"4px 6px", fontSize:11, width:60, fontFamily:T.mono }} /> : <span style={{ color:T.textDim, fontFamily:T.mono }}>••••</span>}</td>
                          <td style={{ padding:"8px 10px", fontFamily:T.mono, color:T.gold, fontWeight:700 }}>{showRate ? (scode||"—") : "••••"}</td>
                          <td style={{ padding:"4px 6px" }}><input type="date" value={sp.recdDate||""} onChange={e => onUpdate(p,"__splitfield__",{ idx:si, field:"recdDate", value:e.target.value })} style={{ background:T.bg, border:`1px solid ${T.border}`, color:T.text, borderRadius:4, padding:"4px 6px", fontSize:11 }} /></td>
                          <td style={{ padding:"4px 6px" }}><input type="date" value={sp.dlvdDate||""} onChange={e => onUpdate(p,"__splitfield__",{ idx:si, field:"dlvdDate", value:e.target.value })} style={{ background:T.bg, border:`1px solid ${T.border}`, color:T.text, borderRadius:4, padding:"4px 6px", fontSize:11 }} /></td>
                          <td style={{ padding:"8px 10px", fontFamily:T.mono, color:T.steelLt }}>{daysBetween(sp.recdDate, sp.dlvdDate) ?? "—"}</td>
                        </>
                      )}
                      <td style={{ padding:"8px 10px" }}>{sp.jobber ? <Badge label="Split" color={T.steelLt} /> : <Badge label="—" color={T.steel} />}</td>
                    </tr>
                  );
                })}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {isAdmin && <CombinedBarcode design={design} jobbers={jobbers} />}
    </div>
  );
}

// ── Cost Sheet ────────────────────────────────────────────────────────────────
function DesignCostSheet({ design, jobbers, challans = [] }) {
  const totalPcs = (design.colors||[]).reduce((a,c) => a+Object.values(c.sizes||{}).reduce((x,v) => x+(+v||0), 0), 0);
  // actual logged work for this design (from challans, not rejected)
  // gather every challan LINE that belongs to this design (challans can hold multiple designs)
  const myCh = [];
  challans.filter(c => c.status!=="rejected" && challanDesigns(c).includes(String(design.designNo))).forEach(c => {
    const dLines = (c.lines||[]).filter(l => String(l.designNo)===String(design.designNo));
    if (dLines.length) dLines.forEach(l => myCh.push({ ...l, date:c.date, challanNo:c.challanNo, jobberId:c.jobberId, status:c.status }));
    else myCh.push({ designNo:c.designNo, process:c.process, qty:c.qty, rate:c.rate, amount:c.amount, date:c.date, challanNo:c.challanNo, jobberId:c.jobberId, status:c.status });
  });
  const chTotal = myCh.reduce((a,c)=>a+(+c.amount||0),0);
  const jn = id => (jobbers.find(j=>j.id===id)||{}).name || id || "—";
  let grand = 0;
  const fabricTotal = (design.supplierBills||[]).reduce((a,b) => a+(+b.amount||0), 0);
  grand += fabricTotal;
  return (
    <div>
      <div style={{ display:"flex", gap:14, marginBottom:16, flexWrap:"wrap" }}>
        {[["Design",design.designNo,T.gold],["Brand",design.brand,T.white],["Total Pieces",totalPcs,T.white],["MRP",design.p1MRP?`Rs.${design.p1MRP}`:"Not set",design.p1MRP?T.green:T.red]].map(([l,v,c]) => (
          <div key={l} style={{ background:T.surface, borderRadius:8, padding:"12px 18px" }}>
            <div style={{ fontSize:10, color:T.steelLt }}>{l}</div>
            <div style={{ fontSize:18, fontWeight:900, color:c, fontFamily:T.mono }}>{v}</div>
          </div>
        ))}
      </div>
      <div style={{ marginBottom:16 }}><AveragesBlock design={design} /></div>
      {/* ACTUAL logged work from challans (each jobber's real entries) */}
      <div style={{ fontFamily:T.mono, fontSize:10, color:T.gold, textTransform:"uppercase", marginBottom:8, letterSpacing:1 }}>Actual Work Logged (from challans)</div>
      {myCh.length===0
        ? <div style={{ background:T.surface, borderRadius:8, padding:14, marginBottom:16, fontFamily:T.mono, fontSize:11, color:T.textDim }}>No work logged yet. Jobber challans for this design will appear here automatically.</div>
        : <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12, marginBottom:16 }}>
            <thead><tr style={{ background:T.surface }}>{["Date","Challan No","Design","Jobber","Task","Qty","Rate","Amount","Status"].map(h => <th key={h} style={{ padding:"8px 10px", fontFamily:T.mono, fontSize:9, color:T.steelLt, textAlign:"left", textTransform:"uppercase", borderBottom:`1px solid ${T.border}`, border:`1px solid ${T.border}` }}>{h}</th>)}</tr></thead>
            <tbody>
              {myCh.map((c,i) => (
                <tr key={c.id||i} style={{ background:i%2===0?T.card:T.surface }}>
                  <td style={{ padding:"8px 10px", color:T.steelLt, fontFamily:T.mono, border:`1px solid ${T.border}` }}>{c.date}</td>
                  <td style={{ padding:"8px 10px", color:T.gold, fontFamily:T.mono, border:`1px solid ${T.border}` }}>{c.challanNo||"—"}</td>
                  <td style={{ padding:"8px 10px", color:T.gold, fontFamily:T.mono, fontWeight:700, border:`1px solid ${T.border}` }}>{c.designNo}</td>
                  <td style={{ padding:"8px 10px", color:T.white, fontWeight:600, border:`1px solid ${T.border}` }}>{jn(c.jobberId)}{c.isSplit && <Badge label="split" color={T.steelLt} />}</td>
                  <td style={{ padding:"8px 10px", color:T.gold, border:`1px solid ${T.border}` }}>{c.process||"—"}</td>
                  <td style={{ padding:"8px 10px", color:T.text, fontFamily:T.mono, border:`1px solid ${T.border}` }}>{c.qty}</td>
                  <td style={{ padding:"8px 10px", color:T.gold, fontFamily:T.mono, border:`1px solid ${T.border}` }}>Rs.{c.rate}</td>
                  <td style={{ padding:"8px 10px", color:T.white, fontFamily:T.mono, fontWeight:700, border:`1px solid ${T.border}` }}>Rs.{c.amount}</td>
                  <td style={{ padding:"8px 10px", border:`1px solid ${T.border}` }}><Badge label={c.status} color={c.status==="approved"?T.green:c.status==="rejected"?T.red:T.orange} /></td>
                </tr>
              ))}
              <tr style={{ background:T.bg }}>
                <td colSpan={7} style={{ padding:"10px", fontFamily:T.mono, fontWeight:700, color:T.gold, border:`1px solid ${T.border}` }}>TOTAL LABOUR (logged)</td>
                <td colSpan={2} style={{ padding:"10px", fontFamily:T.mono, fontWeight:900, color:T.gold, fontSize:14, border:`1px solid ${T.border}` }}>Rs.{chTotal.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
      }
      <div style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, textTransform:"uppercase", marginBottom:8, letterSpacing:1 }}>Planned Rates (from process register)</div>
      <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
        <thead>
          <tr style={{ background:T.surface }}>
            {["Process","Jobber","Bill Date","Bill No","Rate/pc","Pieces","Amount","Paid","Balance"].map(h => (
              <th key={h} style={{ padding:"8px 10px", fontFamily:T.mono, fontSize:9, color:T.steelLt, textAlign:"left", textTransform:"uppercase", borderBottom:`1px solid ${T.border}` }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr style={{ borderBottom:`1px solid ${T.border}` }}>
            <td style={{ padding:"10px", color:T.text, fontWeight:600 }}>Fabric (Bills)</td>
            <td style={{ padding:"10px", color:T.steelLt }}>{design.supplier||"—"}</td>
            <td style={{ padding:"10px", color:T.steelLt }}>{(design.supplierBills||[])[0]?.billDate||"—"}</td>
            <td style={{ padding:"10px", color:T.steelLt }}>{(design.supplierBills||[])[0]?.billNo||"—"}</td>
            <td colSpan={2} style={{ padding:"10px", color:T.steelLt }}>—</td>
            <td style={{ padding:"10px", color:T.white, fontFamily:T.mono }}>Rs.{fabricTotal.toFixed(2)}</td>
            <td colSpan={2} style={{ padding:"10px", color:T.steelLt, fontFamily:T.mono }}>Fabric/pc: Rs.{totalPcs>0?Math.ceil(fabricTotal/totalPcs):0}</td>
          </tr>
          {PROCESSES.filter(p => p!=="Fabric").map(p => {
            const proc = (design.processes||{})[p];
            if (!proc || !proc.rate) return null;
            const jName = jobbers.find(j => j.id===proc.jobber)?.name || "—";
            const amt = +(proc.billAmt||(totalPcs*(+proc.rate||0)));
            const paid = +(proc.paid||0);
            const bal = amt - paid;
            grand += amt;
            const splitRows = (proc.splits||[]).filter(sp => sp.rate).map((sp, si) => {
              const sjName = jobbers.find(j => j.id===sp.jobber)?.name || "—";
              const samt = totalPcs * (+sp.rate||0);
              grand += samt;
              return (
                <tr key={p+"_cs"+si} style={{ borderBottom:`1px solid ${T.border}` }}>
                  <td style={{ padding:"10px 10px 10px 24px", color:T.steelLt, fontSize:11 }}>↳ {sp.label||p}</td>
                  <td style={{ padding:"10px", color:T.steelLt }}>{sjName}</td>
                  <td style={{ padding:"10px", color:T.steelLt }}>{sp.recdDate||"—"}</td>
                  <td style={{ padding:"10px", color:T.steelLt }}>—</td>
                  <td style={{ padding:"10px", color:T.gold, fontFamily:T.mono }}>Rs.{sp.rate}</td>
                  <td style={{ padding:"10px", color:T.text, fontFamily:T.mono }}>{totalPcs}</td>
                  <td style={{ padding:"10px", color:T.white, fontFamily:T.mono }}>Rs.{samt}</td>
                  <td style={{ padding:"10px", color:T.steelLt }}>—</td>
                  <td style={{ padding:"10px", color:T.steelLt }}>—</td>
                </tr>
              );
            });
            return (
              <Fragment key={p}>
              <tr style={{ borderBottom:`1px solid ${T.border}` }}>
                <td style={{ padding:"10px", color:T.text, fontWeight:600 }}>{p}</td>
                <td style={{ padding:"10px", color:T.steelLt }}>{jName}</td>
                <td style={{ padding:"10px", color:T.steelLt }}>{proc.recdDate||"—"}</td>
                <td style={{ padding:"10px", color:T.steelLt }}>{proc.billNo||"—"}</td>
                <td style={{ padding:"10px", color:T.gold, fontFamily:T.mono }}>Rs.{proc.rate}</td>
                <td style={{ padding:"10px", color:T.text, fontFamily:T.mono }}>{totalPcs}</td>
                <td style={{ padding:"10px", color:T.white, fontFamily:T.mono }}>Rs.{amt}</td>
                <td style={{ padding:"10px", color:T.green, fontFamily:T.mono }}>Rs.{paid}</td>
                <td style={{ padding:"10px", color:bal>0?T.red:T.green, fontFamily:T.mono, fontWeight:700 }}>Rs.{bal}</td>
              </tr>
              {splitRows}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr style={{ background:T.surface }}>
            <td colSpan={6} style={{ padding:"12px 10px", fontFamily:T.mono, fontWeight:700, color:T.gold }}>TOTAL COST</td>
            <td style={{ padding:"12px 10px", fontFamily:T.mono, fontWeight:900, color:T.gold, fontSize:15 }}>Rs.{grand.toFixed(2)}</td>
            <td colSpan={2} style={{ padding:"12px 10px", fontFamily:T.mono, fontSize:11, color:T.steelLt }}>Per Piece: Rs.{totalPcs>0?(grand/totalPcs).toFixed(2):0}</td>
          </tr>
          {design.p1MRP && (
            <tr style={{ background:T.surface }}>
              <td colSpan={6} style={{ padding:"8px 10px", fontFamily:T.mono, color:T.green }}>MARGIN (MRP - Cost/pc)</td>
              <td colSpan={3} style={{ padding:"8px 10px", fontFamily:T.mono, fontWeight:700, color:T.green, fontSize:14 }}>Rs.{(+design.p1MRP - (grand/(totalPcs||1))).toFixed(2)} / pc</td>
            </tr>
          )}
        </tfoot>
      </table>
    </div>
  );
}

// ── Movement Log ──────────────────────────────────────────────────────────────
function MovementLog({ design, jobbers, onAdd, role }) {
  const canEdit = role === "admin" || role === "team";
  const [form, setForm] = useState({ date:"", jobber:"", receivedFrom:"", sentTo:"", qty:"", remark:"" });
  const [saving, setSaving] = useState(false);
  async function submit() {
    if (!form.date || !form.qty || !form.sentTo) return;
    setSaving(true);
    await onAdd({ ...form, id:`MV${Date.now()}`, status:"pending" });
    setForm({ date:"", jobber:"", receivedFrom:"", sentTo:"", qty:"", remark:"" });
    setSaving(false);
  }
  return (
    <div>
      {canEdit && (
        <div style={{ background:T.surface, borderRadius:8, padding:14, marginBottom:14 }}>
          <div style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, marginBottom:10, textTransform:"uppercase" }}>Log Movement</div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))", gap:10, marginBottom:10 }}>
            <Inp label="Date" type="date" value={form.date} onChange={v => setForm(f => ({...f,date:v}))} />
            <Inp label="Jobber" value={form.jobber} onChange={v => setForm(f => ({...f,jobber:v}))} options={jobbers.map(j => j.name)} />
            <Inp label="Received From" value={form.receivedFrom} onChange={v => setForm(f => ({...f,receivedFrom:v}))} placeholder="Supplier / Jobber" />
            <Inp label="Sent To" value={form.sentTo} onChange={v => setForm(f => ({...f,sentTo:v}))} placeholder="Jobber name" />
            <Inp label="Qty (pieces)" type="number" value={form.qty} onChange={v => setForm(f => ({...f,qty:v}))} />
            <Inp label="Remark" value={form.remark} onChange={v => setForm(f => ({...f,remark:v}))} placeholder="optional" />
          </div>
          <Btn label={saving?"Saving…":"Log Movement"} onClick={submit} disabled={saving} />
        </div>
      )}
      <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
        <thead>
          <tr style={{ background:T.surface }}>
            {["SR","Date","Jobber","From","To","Qty","Remark","Status"].map(h => (
              <th key={h} style={{ padding:"8px 10px", fontFamily:T.mono, fontSize:9, color:T.steelLt, textAlign:"left", textTransform:"uppercase", borderBottom:`1px solid ${T.border}` }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(design.movements||[]).map((m,i) => (
            <tr key={m.id||i} style={{ borderBottom:`1px solid ${T.border}`, background:i%2===0?T.card:T.surface }}>
              <td style={{ padding:"8px 10px", fontFamily:T.mono, color:T.steelLt }}>{i+1}</td>
              <td style={{ padding:"8px 10px", color:T.text }}>{m.date}</td>
              <td style={{ padding:"8px 10px", color:T.white }}>{m.jobber}</td>
              <td style={{ padding:"8px 10px", color:T.steelLt }}>{m.receivedFrom}</td>
              <td style={{ padding:"8px 10px", color:T.steelLt }}>{m.sentTo}</td>
              <td style={{ padding:"8px 10px", fontFamily:T.mono, color:T.gold, fontWeight:700 }}>{m.qty}</td>
              <td style={{ padding:"8px 10px", color:T.textDim }}>{m.remark}</td>
              <td style={{ padding:"8px 10px" }}><Badge label={m.status==="approved"?"Approved":"Pending"} color={m.status==="approved"?T.green:T.orange} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {(design.movements||[]).length===0 && <div style={{ textAlign:"center", color:T.textDim, padding:30, fontFamily:T.mono, fontSize:12 }}>No movements logged yet.</div>}
    </div>
  );
}

// ── MRP Panel ─────────────────────────────────────────────────────────────────
function MRPPanel({ design, onUpdate }) {
  const [p1, setP1] = useState(design.p1MRP||"");
  const [p2, setP2] = useState(design.p2MRP||"");
  const [p1c, setP1c] = useState(design.p1Code||"");
  const [p2c, setP2c] = useState(design.p2Code||"");
  function save() { onUpdate({ ...design, p1MRP:p1, p2MRP:p2, p1Code:p1c, p2Code:p2c, mrpFinalized:true }); }
  return (
    <div>
      <div style={{ background:design.mrpFinalized?T.green+"22":T.orange+"22", border:`1px solid ${design.mrpFinalized?T.green:T.orange}`, borderRadius:8, padding:12, marginBottom:16, fontFamily:T.mono, fontSize:12, color:design.mrpFinalized?T.green:T.orange }}>
        {design.mrpFinalized ? "✓ MRP is set — Barcodes can be generated" : "⚠ MRP not finalized — set it when product is complete"}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, maxWidth:400 }}>
        <Inp label="P1 Code" value={p1c} onChange={setP1c} />
        <Inp label="P1 MRP (Rs.)" type="number" value={p1} onChange={setP1} />
        <Inp label="P2 Code" value={p2c} onChange={setP2c} />
        <Inp label="P2 MRP (Rs.)" type="number" value={p2} onChange={setP2} />
      </div>
      <div style={{ marginTop:16 }}><Btn label="Save & Finalize MRP" onClick={save} /></div>
    </div>
  );
}

// ── Pending Approvals ─────────────────────────────────────────────────────────
function PendingApprovals({ design, jobbers, onApprove, onReject }) {
  const entries = design.jobberEntries || [];
  if (entries.length === 0) {
    return <div style={{ color:T.textDim, fontFamily:T.mono, fontSize:12, textAlign:"center", padding:30 }}>No entries yet.</div>;
  }
  return (
    <div>
      {entries.map((e,i) => {
        const j = jobbers.find(x => x.id===e.jobber);
        return (
          <div key={i} style={{ background:T.surface, borderRadius:8, padding:16, marginBottom:10, border:`1px solid ${e.status==="pending"?T.orange:e.status==="approved"?T.green:T.red}` }}>
            <div style={{ display:"flex", justifyContent:"space-between", flexWrap:"wrap", gap:8 }}>
              <div>
                <div style={{ fontWeight:700, color:T.white }}>{j?.name||e.jobber}</div>
                <div style={{ color:T.steelLt, fontSize:11, marginTop:4 }}>{e.date} · Received: {e.qtyReceived} · Delivered: {e.qtyDelivered} · Damage: {e.damage||0} · Time: {e.timeTaken}</div>
                {e.notes && <div style={{ color:T.text, fontSize:12, marginTop:4 }}>{e.notes}</div>}
              </div>
              <Badge label={e.status} color={e.status==="pending"?T.orange:e.status==="approved"?T.green:T.red} />
            </div>
            {e.status==="pending" && (
              <div style={{ display:"flex", gap:10, marginTop:12 }}>
                <Btn label="Approve" onClick={() => onApprove(i)} color={T.green} textColor={T.white} small />
                <Btn label="Reject" onClick={() => onReject(i)} color={T.red} textColor={T.white} small />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Bookings (standalone, independent of designs) ─────────────────────────────
function bToRow(b) {
  return { id:b.id, customer:b.customer||"", design_no:b.designNo||"", color:b.color||"", sizes:b.sizes||{}, booking_date:b.bookingDate||"", delivery_date:b.deliveryDate||"", notes:b.notes||"", total:b.total||0, created_by:b.createdBy||"", created_at_str:b.createdAtStr||"" };
}
function rowToB(r) {
  return { id:r.id, customer:r.customer||"", designNo:r.design_no||"", color:r.color||"", sizes:r.sizes||{}, bookingDate:r.booking_date||"", deliveryDate:r.delivery_date||"", notes:r.notes||"", total:r.total||0, createdBy:r.created_by||"", createdAtStr:r.created_at_str||"" };
}

// ── Bills + Payments converters ───────────────────────────────────────────────
function billToRow(b) {
  return { id:b.id, jobber_id:b.jobberId||"", bill_no:b.billNo||"", bill_date:b.billDate||"", lines:b.lines||[], gross:b.gross||0, gst_pct:b.gstPct??5, gst_amt:b.gstAmt||0, round_off:b.roundOff||0, total:b.total||0, has_gst:!!b.hasGst, created_by:b.createdBy||"", created_at_str:b.createdAtStr||"" };
}
function rowToBill(r) {
  return { id:r.id, jobberId:r.jobber_id||"", billNo:r.bill_no||"", billDate:r.bill_date||"", lines:r.lines||[], gross:r.gross||0, gstPct:r.gst_pct??5, gstAmt:r.gst_amt||0, roundOff:r.round_off||0, total:r.total||0, hasGst:!!r.has_gst, createdBy:r.created_by||"", createdAtStr:r.created_at_str||"" };
}
// Credit note: party_type "jobber" or "supplier"; party = jobberId or supplier name
function cnToRow(c) {
  return { id:c.id, party_type:c.partyType||"jobber", party:c.party||"", cn_no:c.cnNo||"", cn_date:c.cnDate||"", reason:c.reason||"", lines:c.lines||[], total:c.total||0, created_by:c.createdBy||"", created_at_str:c.createdAtStr||"" };
}
function rowToCn(r) {
  return { id:r.id, partyType:r.party_type||"jobber", party:r.party||"", cnNo:r.cn_no||"", cnDate:r.cn_date||"", reason:r.reason||"", lines:r.lines||[], total:r.total||0, createdBy:r.created_by||"", createdAtStr:r.created_at_str||"" };
}
function cnDesignNos(c) { return [...new Set((c.lines||[]).map(l=>String(l.designNo)).filter(Boolean))]; }
function payToRow(p) {
  return { id:p.id, jobber_id:p.jobberId||"", date:p.date||"", amount:p.amount||0, mode:p.mode||"", channel:p.channel||"bank", note:p.note||"", created_by:p.createdBy||"", created_at_str:p.createdAtStr||"" };
}
function rowToPay(r) {
  return { id:r.id, jobberId:r.jobber_id||"", date:r.date||"", amount:r.amount||0, mode:r.mode||"", channel:r.channel||"bank", note:r.note||"", createdBy:r.created_by||"", createdAtStr:r.created_at_str||"" };
}

function logToRow(l) {
  return { id:l.id, ts:l.ts||"", who:l.who||"", action:l.action||"", target:l.target||"", detail:l.detail||"" };
}
function rowToLog(r) {
  return { id:r.id, ts:r.ts||"", who:r.who||"", action:r.action||"", target:r.target||"", detail:r.detail||"" };
}
// global logger — set by App so any component can record activity
let _logSink = null;
function recordActivity(who, action, target, detail) {
  const entry = { id:`LOG${Date.now()}${Math.floor(Math.random()*1000)}`, ts:nowStr(), who:who||"", action:action||"", target:target||"", detail:detail||"" };
  if (_logSink) _logSink(entry);
  dbUpsert("activity_log", logToRow(entry), true);
}

function notifToRow(n) {
  return { id:n.id, ts:n.ts||"", who:n.who||"", message:n.message||"", design_id:n.designId||"", read_by:n.readBy||[] };
}
function rowToNotif(r) {
  return { id:r.id, ts:r.ts||"", who:r.who||"", message:r.message||"", designId:r.design_id||"", readBy:r.read_by||[] };
}

// Build a minimal placeholder design from a challan (admin completes details later)
function makePlaceholderDesign(challan, currentUser) {
  return {
    id:`D${Date.now()}`, designNo: challan.designNo||"", lotNo:"", sleeveType:"Full",
    brand:"RUDE INC", style:"", fabric:"", supplier:"Aashish Apparels",
    p1Code:"", p1MRP:"", p2Code:"", p2MRP:"", fit:"", collarType:"",
    shrinkageLen:"", shrinkageWid:"", placket:"", washType:"",
    hasEmbroidery:false, hasPrint:false, hasVinyl:false, hasPocket:false, hasButtons:false, hasLabel:false,
    specs:[], ratio:{}, trims:"", drawingAvg:"", manualAvg:{ smxxl:"", x3to5:"", bigLabel:"6XL+", big:"" }, formOrder:[],
    dateProgram:"", dateCut:"", notes:`Auto-created from challan by ${challan.createdBy||currentUser||""}. Please complete details.`,
    activeColors:["S","M","L","XL","XXL"], colors:[], processes:{}, photos:[],
    supplierBills:[], customerOrders:[], movements:[], jobberEntries:[],
    status:"New", mrpFinalized:false, locked:false, lockedBy:"", lockedAtStr:"",
    barcodeBlock:null, productionDate:"", createdBy: currentUser||challan.createdBy||"", createdAtStr: nowStr(),
    editedBy:"", editedAtStr:"", editCount:0, fromChallan:true
  };
}

function challanToRow(c) {
  return { id:c.id, jobber_id:c.jobberId||"", design_no:c.designNo||"", process:c.process||"", qty:c.qty||0, rate:c.rate||0, amount:c.amount||0, lines:c.lines||[], date:c.date||"", challan_no:c.challanNo||"", photo:c.photo||"", status:c.status||"pending", billed:!!c.billed, bill_id:c.billId||"", send_to_id:c.sendToId||"", is_split:!!c.isSplit, created_by:c.createdBy||"", created_at_str:c.createdAtStr||"" };
}
function rowToChallan(r) {
  const c = { id:r.id, jobberId:r.jobber_id||"", designNo:r.design_no||"", process:r.process||"", qty:r.qty||0, rate:r.rate||0, amount:r.amount||0, lines:r.lines||[], date:r.date||"", challanNo:r.challan_no||"", photo:r.photo||"", status:r.status||"pending", billed:!!r.billed, billId:r.bill_id||"", sendToId:r.send_to_id||"", isSplit:!!r.is_split, createdBy:r.created_by||"", createdAtStr:r.created_at_str||"" };
  // back-compat: if no lines array but has single design, synthesize one line
  if ((!c.lines || c.lines.length===0) && c.designNo) c.lines = [{ designNo:c.designNo, process:c.process, qty:c.qty, rate:c.rate, amount:c.amount }];
  return c;
}
// helpers for multi-design challans
function challanDesigns(c) { return (c.lines && c.lines.length) ? [...new Set(c.lines.map(l=>String(l.designNo)).filter(Boolean))] : (c.designNo?[String(c.designNo)]:[]); }
function challanTotal(c) { return (c.lines && c.lines.length) ? c.lines.reduce((a,l)=>a+(+l.amount||0),0) : (+c.amount||0); }
function challanQty(c) { return (c.lines && c.lines.length) ? c.lines.reduce((a,l)=>a+(+l.qty||0),0) : (+c.qty||0); }
// link helpers: bill <-> challan matched by shared design numbers (same jobber)
function billDesignNos(b) { return [...new Set((b.lines||[]).map(l=>String(l.designNo)).filter(Boolean))]; }
function challansForBill(b, challans) {
  const dns = billDesignNos(b);
  return (challans||[]).filter(c => c.jobberId===b.jobberId && c.status!=="rejected" && challanDesigns(c).some(dn => dns.includes(dn)));
}
function billsForChallan(c, bills) {
  const dns = challanDesigns(c);
  return (bills||[]).filter(b => b.jobberId===c.jobberId && billDesignNos(b).some(dn => dns.includes(dn)));
}
let _notifSink = null;
function recordNotification(who, message, designId) {
  const entry = { id:`NOT${Date.now()}${Math.floor(Math.random()*1000)}`, ts:nowStr(), who:who||"", message:message||"", designId:designId||"", readBy:[] };
  if (_notifSink) _notifSink(entry);
  dbUpsert("notifications", notifToRow(entry), true);
}

function BookingsPanel({ bookings, setBookings, showToast, currentUser }) {
  const [form, setForm] = useState({ customer:"", designNo:"", color:"", sizes:{}, bookingDate:"", deliveryDate:"", notes:"" });
  const [view, setView] = useState("list");
  const upd = k => v => setForm(f => ({ ...f, [k]:v }));
  function updSize(s, v) { setForm(f => ({ ...f, sizes:{ ...f.sizes, [s]:v } })); }

  async function add() {
    if (!form.customer || !form.designNo) { showToast("Customer and Design No required","error"); return; }
    const total = SIZES.reduce((a,s) => a+(+(form.sizes[s]||0)), 0);
    const b = { ...form, id:`BK${Date.now()}`, total, createdBy:currentUser, createdAtStr:nowStr() };
    await dbUpsert("bookings", bToRow(b));
    setBookings(p => [b, ...p]);
    recordActivity(currentUser, "Added booking", `Design ${b.designNo}`, `${b.customer} · ${b.total} pcs`);
    setForm({ customer:"", designNo:"", color:"", sizes:{}, bookingDate:"", deliveryDate:"", notes:"" });
    showToast("Booking added ✓");
  }
  async function remove(id) {
    await dbDelete("bookings", id);
    setBookings(p => p.filter(b => b.id!==id));
    showToast("Booking deleted");
  }

  const byDesign = {};
  bookings.forEach(b => {
    if (!byDesign[b.designNo]) byDesign[b.designNo] = {};
    const key = b.color || "—";
    if (!byDesign[b.designNo][key]) byDesign[b.designNo][key] = {};
    SIZES.forEach(s => {
      const q = +(b.sizes||{})[s]||0;
      if (q) byDesign[b.designNo][key][s] = (byDesign[b.designNo][key][s]||0) + q;
    });
  });

  return (
    <div>
      <div style={{ display:"flex", gap:8, marginBottom:16 }}>
        <button onClick={() => setView("list")} style={{ background:view==="list"?T.gold:T.surface, color:view==="list"?T.bg:T.steelLt, border:"none", borderRadius:20, padding:"6px 20px", fontFamily:T.mono, fontSize:11, fontWeight:700, cursor:"pointer" }}>All Bookings</button>
        <button onClick={() => setView("summary")} style={{ background:view==="summary"?T.gold:T.surface, color:view==="summary"?T.bg:T.steelLt, border:"none", borderRadius:20, padding:"6px 20px", fontFamily:T.mono, fontSize:11, fontWeight:700, cursor:"pointer" }}>Demand Summary</button>
      </div>

      <div style={{ background:T.surface, borderRadius:8, padding:14, marginBottom:16 }}>
        <div style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, marginBottom:10, textTransform:"uppercase" }}>New Booking</div>
        <div style={{ display:"flex", gap:10, flexWrap:"wrap", marginBottom:10, alignItems:"flex-end" }}>
          <Inp label="Customer" value={form.customer} onChange={upd("customer")} placeholder="Customer name" style={{ minWidth:160 }} />
          <Inp label="Main Design No" value={form.designNo} onChange={upd("designNo")} placeholder="e.g. 2083 (pattern)" style={{ minWidth:110 }} />
          <Inp label="Lot No (this run)" value={form.lotNo} onChange={upd("lotNo")} placeholder="e.g. 3290" style={{ minWidth:110 }} />
          <Inp label="Color" value={form.color} onChange={upd("color")} placeholder="e.g. Navy" style={{ minWidth:120 }} />
          <Inp label="Booking Date" type="date" value={form.bookingDate} onChange={upd("bookingDate")} />
          <Inp label="Delivery Date" type="date" value={form.deliveryDate} onChange={upd("deliveryDate")} />
        </div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"flex-end", marginBottom:10 }}>
          {SIZES.map(s => (
            <div key={s} style={{ textAlign:"center" }}>
              <div style={{ fontFamily:T.mono, fontSize:9, color:T.gold, marginBottom:3 }}>{s}</div>
              <input type="number" value={form.sizes[s]||""} onChange={e => updSize(s,e.target.value)} placeholder="0" style={{ background:T.bg, border:`1px solid ${T.border}`, borderRadius:4, color:T.text, fontFamily:T.mono, fontSize:12, width:44, padding:"5px 3px", textAlign:"center" }} />
            </div>
          ))}
        </div>
        <div style={{ display:"flex", gap:10, alignItems:"flex-end" }}>
          <Inp label="Notes" value={form.notes} onChange={upd("notes")} placeholder="optional" style={{ flex:1 }} />
          <Btn label="+ Add Booking" onClick={add} />
        </div>
      </div>

      {view === "list" ? (
        <div style={{ overflowX:"auto" }}>
          {bookings.length===0 && <div style={{ textAlign:"center", color:T.textDim, padding:40, fontFamily:T.mono, fontSize:12 }}>No bookings yet.</div>}
          {bookings.length > 0 && (
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11 }}>
              <thead>
                <tr style={{ background:T.surface }}>
                  {["Customer","Design","Color",...SIZES,"Total","Delivery",""].map(h => (
                    <th key={h} style={{ padding:"8px 6px", fontFamily:T.mono, fontSize:9, color:h===("Total")?T.gold:T.steelLt, textAlign:"left", textTransform:"uppercase", borderBottom:`1px solid ${T.border}`, whiteSpace:"nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bookings.map((b,i) => (
                  <tr key={b.id||i} style={{ background:i%2===0?T.card:T.surface, borderBottom:`1px solid ${T.border}` }}>
                    <td style={{ padding:"8px 6px", color:T.white, fontWeight:600 }}>{b.customer}</td>
                    <td style={{ padding:"8px 6px", color:T.gold, fontFamily:T.mono, fontWeight:700 }}>{b.designNo}</td>
                    <td style={{ padding:"8px 6px", color:T.steelLt }}>{b.color}</td>
                    {SIZES.map(s => <td key={s} style={{ padding:"8px 4px", color:T.text, fontFamily:T.mono, textAlign:"center" }}>{(b.sizes||{})[s]||""}</td>)}
                    <td style={{ padding:"8px 6px", color:T.gold, fontFamily:T.mono, fontWeight:700, textAlign:"center" }}>{b.total}</td>
                    <td style={{ padding:"8px 6px", color:T.steelLt, fontFamily:T.mono }}>{b.deliveryDate||"—"}</td>
                    <td style={{ padding:"8px 6px" }}><Btn label="✕" onClick={() => remove(b.id)} color={T.red+"22"} textColor={T.red} small /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        <div>
          {Object.keys(byDesign).length===0 && <div style={{ textAlign:"center", color:T.textDim, padding:40, fontFamily:T.mono, fontSize:12 }}>No bookings to summarize.</div>}
          {Object.entries(byDesign).map(([dno, colors]) => (
            <div key={dno} style={{ background:T.card, borderRadius:10, border:`1px solid ${T.border}`, marginBottom:14, overflow:"hidden" }}>
              <div style={{ background:T.surface, padding:"10px 16px", borderBottom:`1px solid ${T.border}` }}>
                <span style={{ fontFamily:T.mono, fontSize:16, fontWeight:900, color:T.gold }}>Design {dno}</span>
              </div>
              <div style={{ padding:14, overflowX:"auto" }}>
                <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11 }}>
                  <thead>
                    <tr style={{ background:T.surface }}>
                      <th style={{ padding:"6px 10px", fontFamily:T.mono, fontSize:9, color:T.steelLt, textAlign:"left", border:`1px solid ${T.border}` }}>COLOR</th>
                      {SIZES.map(s => <th key={s} style={{ padding:"6px", fontFamily:T.mono, fontSize:9, color:T.gold, border:`1px solid ${T.border}`, minWidth:36, textAlign:"center" }}>{s}</th>)}
                      <th style={{ padding:"6px", fontFamily:T.mono, fontSize:9, color:T.steelLt, border:`1px solid ${T.border}`, textAlign:"center" }}>TOTAL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(colors).map(([color, szs]) => {
                      const rt = SIZES.reduce((a,s) => a+(szs[s]||0), 0);
                      return (
                        <tr key={color}>
                          <td style={{ padding:"6px 10px", color:T.white, fontWeight:600, border:`1px solid ${T.border}` }}>{color}</td>
                          {SIZES.map(s => <td key={s} style={{ padding:"6px", color:szs[s]?T.text:T.textDim, fontFamily:T.mono, border:`1px solid ${T.border}`, textAlign:"center" }}>{szs[s]||0}</td>)}
                          <td style={{ padding:"6px", color:T.gold, fontFamily:T.mono, fontWeight:700, border:`1px solid ${T.border}`, textAlign:"center" }}>{rt}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Barcode Panel ─────────────────────────────────────────────────────────────
function BarcodePanel({ design, jobbers, onUpdate }) {
  const bills = design.supplierBills || [];
  const existing = design.barcodeBlock || {};
  const firstBill = bills[0] || {};
  const [billId, setBillId] = useState(existing.billId || (firstBill.id || ""));
  const pickedBill = bills.find(b => b.id === billId) || firstBill;

  const [block, setBlock] = useState({
    meters: existing.meters ?? (pickedBill.meters || ""),
    rate: existing.rate ?? (pickedBill.rate || ""),
    initials: existing.initials ?? initialsOf(pickedBill.supplier || design.supplier),
    billNo: existing.billNo ?? (pickedBill.billNo || ""),
    billDate: existing.billDate ?? (pickedBill.billDate || ""),
  });
  const upd = k => v => setBlock(b => ({ ...b, [k]: v }));

  function loadFromBill(id) {
    setBillId(id);
    const b = bills.find(x => x.id === id);
    if (b) setBlock({ meters:b.meters||"", rate:b.rate||"", initials:initialsOf(b.supplier||design.supplier), billNo:b.billNo||"", billDate:b.billDate||"" });
  }

  function save() {
    onUpdate({ ...design, barcodeBlock:{ ...block, billId }, productionDate: design.productionDate || new Date().toISOString().slice(0,10) });
  }

  if (!design.mrpFinalized) {
    return <div style={{ background:T.orange+"22", border:`1px solid ${T.orange}`, borderRadius:8, padding:16, fontFamily:T.mono, fontSize:12, color:T.orange }}>⚠ Barcode is locked until MRP is finalized. Set the MRP first.</div>;
  }

  const topLine = buildBarcodeTop(design, jobbers, design.productionDate);
  const fabricLine = buildFabricBlock({ ...block });

  return (
    <div>
      <div style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, marginBottom:8, textTransform:"uppercase" }}>Fabric Block (below barcode) — from supplier bill, editable</div>
      {bills.length > 1 && (
        <div style={{ marginBottom:12, maxWidth:320 }}>
          <div style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, marginBottom:4 }}>Pick supplier bill</div>
          <select value={billId} onChange={e => loadFromBill(e.target.value)} style={{ background:T.surface, border:`1px solid ${T.border}`, color:T.text, borderRadius:6, padding:"8px 12px", fontSize:13, width:"100%" }}>
            {bills.map(b => <option key={b.id} value={b.id}>{b.supplier} · Bill {b.billNo} · {b.meters}m</option>)}
          </select>
        </div>
      )}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))", gap:12, marginBottom:16 }}>
        <Inp label="Total Meters (rounds up)" type="number" value={block.meters} onChange={upd("meters")} />
        <Inp label="Rate" type="number" value={block.rate} onChange={upd("rate")} />
        <Inp label="Supplier Initials" value={block.initials} onChange={upd("initials")} />
        <Inp label="Bill No" value={block.billNo} onChange={upd("billNo")} />
        <Inp label="Bill Date" type="date" value={block.billDate} onChange={upd("billDate")} />
      </div>
      <div style={{ display:"flex", gap:10, marginBottom:20, alignItems:"flex-end" }}>
        <Inp label="Production Date (auto today, editable)" type="date" value={design.productionDate || new Date().toISOString().slice(0,10)} onChange={v => onUpdate({ ...design, productionDate:v })} style={{ maxWidth:220 }} />
        <Btn label="Save Barcode Data" onClick={save} />
      </div>

      <div style={{ background:"#fff", borderRadius:10, padding:"20px 24px", maxWidth:420, margin:"0 auto", boxShadow:"0 4px 20px #0006" }}>
        <div style={{ textAlign:"center", fontFamily:T.mono, fontSize:13, fontWeight:700, color:"#000", letterSpacing:1, marginBottom:6 }}>{topLine || "—"}</div>
        <div style={{ display:"flex", justifyContent:"center", gap:1.5, height:60, alignItems:"stretch", marginBottom:6 }}>
          {(topLine.replace(/\s/g,"") || "00000000").split("").map((ch,i) => {
            const w = (ch.charCodeAt(0) % 3) + 1;
            return <div key={i} style={{ width:w, background:"#000" }} />;
          })}
        </div>
        <div style={{ display:"flex", justifyContent:"center", gap:8, marginBottom:4 }}>
          <span style={{ fontFamily:T.mono, fontSize:12, fontWeight:700, color:"#000", border:"1px solid #000", borderRadius:3, padding:"1px 8px" }}>Design: {design.designNo}</span>
          {design.lotNo && design.lotNo!==design.designNo && <span style={{ fontFamily:T.mono, fontSize:12, color:"#000", border:"1px solid #000", borderRadius:3, padding:"1px 8px" }}>Lot: {design.lotNo}</span>}
        </div>
        <div style={{ textAlign:"center", fontFamily:T.mono, fontSize:11, color:"#000", marginBottom:4 }}>MRP Rs.{design.p1MRP}</div>
        <div style={{ textAlign:"center", fontFamily:T.mono, fontSize:11, fontWeight:700, color:"#000", letterSpacing:0.5 }}>{fabricLine || "—"}</div>
      </div>

      <div style={{ marginTop:18, background:T.surface, borderRadius:8, padding:14 }}>
        <div style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, marginBottom:8, textTransform:"uppercase" }}>Plain Text (for printing / copy)</div>
        <div style={{ fontFamily:T.mono, fontSize:13, color:T.gold, marginBottom:6 }}>ABOVE: {topLine||"—"}</div>
        <div style={{ fontFamily:T.mono, fontSize:13, color:T.steelLt }}>BELOW: {fabricLine||"—"}</div>
      </div>
    </div>
  );
}

// ── Production Flow (combined movement + process chain, date-ordered) ──────────
function ProductionFlow({ design, jobbers }) {
  const jname = id => jobbers.find(j => j.id===id)?.name || id || "—";
  const rows = [];
  PROCESSES.forEach(p => {
    const pr = (design.processes||{})[p];
    if (pr && pr.jobber) {
      rows.push({ kind:"process", date: pr.recdDate||pr.date||"", process:p, jobber:jname(pr.jobber), from:"", to:"", qty:"", recd:pr.recdDate||"", dlvd:pr.dlvdDate||"", days:daysBetween(pr.recdDate,pr.dlvdDate) });
    }
    (pr?.splits||[]).forEach(sp => {
      if (sp.jobber) rows.push({ kind:"process", date: sp.recdDate||"", process:`${p}${sp.label?(" · "+sp.label):""}`, jobber:jname(sp.jobber), from:"", to:"", qty:"", recd:sp.recdDate||"", dlvd:sp.dlvdDate||"", days:daysBetween(sp.recdDate,sp.dlvdDate) });
    });
  });
  (design.movements||[]).forEach(m => {
    rows.push({ kind:"move", date:m.date||"", process:"Movement", jobber:m.jobber||"", from:m.receivedFrom||"", to:m.sentTo||"", qty:m.qty||"", recd:"", dlvd:"", days:null, remark:m.remark||"" });
  });
  rows.sort((a,b) => { if(!a.date) return 1; if(!b.date) return -1; return a.date.localeCompare(b.date); });

  return (
    <div>
      <div style={{ fontFamily:T.mono, fontSize:11, color:T.steelLt, marginBottom:12 }}>
        Full journey of Design <span style={{ color:T.gold, fontWeight:700 }}>{design.designNo}</span> — who did each job, in order, with hand-offs.
      </div>
      {rows.length===0 && <div style={{ textAlign:"center", color:T.textDim, padding:40, fontFamily:T.mono, fontSize:12 }}>No flow data yet. Assign processes and log movements to build the journey.</div>}
      {rows.length>0 && (
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11, minWidth:"100%" }}>
            <thead>
              <tr style={{ background:T.surface }}>
                {["#","Date","Stage","Jobber","Received From","Sent To","Qty","Recd","Dlvd","Days"].map(h => (
                  <th key={h} style={{ padding:"8px 8px", fontFamily:T.mono, fontSize:9, color:T.steelLt, textAlign:"left", textTransform:"uppercase", border:`1px solid ${T.border}`, whiteSpace:"nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r,i) => (
                <tr key={i} style={{ background:i%2===0?T.card:T.surface, borderLeft:`3px solid ${r.kind==="move"?T.steelLt:T.gold}` }}>
                  <td style={{ padding:"8px", fontFamily:T.mono, color:T.steelLt, border:`1px solid ${T.border}` }}>{i+1}</td>
                  <td style={{ padding:"8px", color:T.steelLt, border:`1px solid ${T.border}`, whiteSpace:"nowrap" }}>{r.date||"—"}</td>
                  <td style={{ padding:"8px", color:T.white, fontWeight:600, border:`1px solid ${T.border}`, whiteSpace:"nowrap" }}>{r.process}</td>
                  <td style={{ padding:"8px", color:T.gold, border:`1px solid ${T.border}`, whiteSpace:"nowrap" }}>{r.jobber}</td>
                  <td style={{ padding:"8px", color:T.text, border:`1px solid ${T.border}`, whiteSpace:"nowrap" }}>{r.from||"—"}</td>
                  <td style={{ padding:"8px", color:T.text, border:`1px solid ${T.border}`, whiteSpace:"nowrap" }}>{r.to||"—"}</td>
                  <td style={{ padding:"8px", fontFamily:T.mono, color:T.text, border:`1px solid ${T.border}`, textAlign:"center" }}>{r.qty||"—"}</td>
                  <td style={{ padding:"8px", color:T.steelLt, border:`1px solid ${T.border}`, whiteSpace:"nowrap" }}>{r.recd||"—"}</td>
                  <td style={{ padding:"8px", color:T.steelLt, border:`1px solid ${T.border}`, whiteSpace:"nowrap" }}>{r.dlvd||"—"}</td>
                  <td style={{ padding:"8px", fontFamily:T.mono, color:r.days!=null?(r.days>7?T.orange:T.steelLt):T.textDim, border:`1px solid ${T.border}`, textAlign:"center" }}>{r.days!=null?r.days:"—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop:10, fontFamily:T.mono, fontSize:9, color:T.textDim }}>Gold = process step · Grey = movement/hand-off. Ordered by date.</div>
        </div>
      )}
    </div>
  );
}

// ── Design Detail (tabbed) ────────────────────────────────────────────────────
function DesignDetail({ design, jobbers, onBack, onUpdate, showToast, role, currentUser, currentJobber, onAddJobber, L = (x)=>x, onSendLot, people, challans = [] }) {
  const isAdmin = role === "admin";
  const isTeam = role === "team";
  const isJobber = role === "jobber";
  const DTABS = isJobber
    ? ["Fill Sizes","Job Sheet","Flow","Photos"]
    : ["Job Sheet","Fill Sizes","Flow","Customer Orders","Photos","Movement","Supplier Bills",...(isAdmin?["Process Register","Cost Sheet","MRP","Barcode","Pending Approvals"]:[])];
  const [dt, setDt] = useState(isJobber ? "Fill Sizes" : "Job Sheet");

  async function save(updated) {
    let stamped = { ...updated, editedBy: currentUser, editedAtStr: nowStr() };
    if (role === "jobber" && currentJobber) {
      const pn = currentJobber.process;
      if (pn && PROCESSES.includes(pn)) {
        const cur = stamped.processes?.[pn] || {};
        if (cur.jobber !== currentJobber.id) {
          stamped = { ...stamped, processes: { ...stamped.processes, [pn]: { ...cur, jobber: currentJobber.id, prefix: currentJobber.prefix||"", reassignedBy: currentUser, reassignedAtStr: nowStr() } } };
        }
      }
    }
    onUpdate(stamped);
    await dbUpsert("designs", dToRow(stamped));
    showToast("Saved ✓");
  }
  async function updProcess(proc, field, val) {
    const cur = design.processes?.[proc] || {};
    let newProc = { ...cur };
    if (field === "__addsplit__") {
      newProc.splits = [...(cur.splits||[]), { id:`SP${Date.now()}`, label:"", jobber:"", rate:"", recdDate:"", dlvdDate:"", prefix:"" }];
    } else if (field === "__delsplit__") {
      newProc.splits = (cur.splits||[]).filter((_, idx) => idx !== val);
    } else if (field === "__splitfield__") {
      const { idx, field: f2, value } = val;
      const splits = [...(cur.splits||[])];
      let extra = {};
      if (f2 === "jobber") { const j = jobbers.find(x => x.id === value); extra.prefix = codeForProcess(j, proc); }
      splits[idx] = { ...splits[idx], [f2]: value, ...extra };
      newProc.splits = splits;
    } else {
      let extra = {};
      if (field === "jobber") { const j = jobbers.find(x => x.id === val); extra.prefix = codeForProcess(j, proc); }
      newProc = { ...newProc, [field]: val, ...extra };
    }
    const updated = { ...design, processes:{ ...design.processes, [proc]: newProc }, editedBy:currentUser, editedAtStr:nowStr() };
    onUpdate(updated);
    await dbUpsert("designs", dToRow(updated));
    if (field==="jobber"||field==="rate") recordActivity(currentUser, `Changed ${proc} ${field}`, `Design ${design.designNo}`, "");
  }
  async function addMovement(mv) {
    const updated = { ...design, movements:[...(design.movements||[]),mv] };
    await dbUpsert("movements", mvToRow(mv, design.id));
    onUpdate(updated);
    recordNotification(currentUser, `${mv.sentTo?("Sent to "+mv.sentTo):"Movement"} — Design ${design.designNo} (${mv.qty} pcs)`, design.id);
    showToast("Movement logged ✓");
  }
  async function approveEntry(idx) {
    const entries = [...(design.jobberEntries||[])];
    entries[idx] = { ...entries[idx], status:"approved" };
    const updated = { ...design, jobberEntries:entries };
    await dbUpsert("jobber_entries", entToRow(entries[idx], design.id));
    onUpdate(updated);
    showToast("Entry approved ✓");
  }
  async function rejectEntry(idx) {
    const entries = [...(design.jobberEntries||[])];
    entries[idx] = { ...entries[idx], status:"rejected" };
    const updated = { ...design, jobberEntries:entries };
    await dbUpsert("jobber_entries", entToRow(entries[idx], design.id));
    onUpdate(updated);
    showToast("Entry rejected");
  }
  async function toggleCompleted() {
    const done = design.status !== "Completed";
    const updated = { ...design, status: done ? "Completed" : "In Progress", editedBy: currentUser, editedAtStr: nowStr() };
    onUpdate(updated);
    await dbUpsert("designs", dToRow(updated));
    recordActivity(currentUser, done?"Marked completed":"Reopened design", `Design ${design.designNo}`, "");
    showToast(done ? "Marked completed ✓" : "Reopened");
  }
  async function confirmLock() {
    const isLocking = !design.locked;
    const updated = { ...design, locked: isLocking, lockedBy: isLocking ? currentUser : "", lockedAtStr: isLocking ? nowStr() : "", status: isLocking && design.status==="New" ? "In Progress" : design.status, editedBy: currentUser, editedAtStr: nowStr() };
    onUpdate(updated);
    await dbUpsert("designs", dToRow(updated));
    recordActivity(currentUser, isLocking?"Confirmed & locked sizes":"Unlocked sizes", `Design ${design.designNo}`, "");
    if (isLocking) recordNotification(currentUser, `${currentUser} filled & locked sizes for Design ${design.designNo}`, design.id);
    showToast(isLocking ? "Sizes confirmed & locked ✓" : "Unlocked for editing");
  }
  const pending = (design.jobberEntries||[]).filter(e => e.status==="pending");
  return (
    <div>
      <div style={{ background:T.card, borderRadius:10, padding:"16px 20px", marginBottom:16, border:`1px solid ${T.border}` }}>
        <button onClick={onBack} style={{ background:"none", border:"none", color:T.gold, fontFamily:T.mono, fontSize:11, cursor:"pointer", marginBottom:6 }}>← Back</button>
        <div style={{ display:"flex", alignItems:"center", gap:16, flexWrap:"wrap" }}>
          <span style={{ fontFamily:T.mono, fontSize:28, fontWeight:900, color:T.gold }}>{designLabel(design)}</span>
          <span style={{ color:T.white, fontSize:16, fontWeight:600 }}>{design.brand}</span>
          <span style={{ color:T.steelLt }}>{design.fabric}</span>
          <Badge label={design.status} color={design.status==="New"?T.steel:design.status==="In Progress"?T.orange:T.green} />
          {design.mrpFinalized && <Badge label={`MRP Rs.${design.p1MRP}`} color={T.green} />}
          {pending.length > 0 && isAdmin && <Badge label={`${pending.length} Pending`} color={T.red} />}
          {isAdmin && design.editCount>0 && <Badge label={`edited ${design.editCount}x`} color={T.steelLt} />}
          {isAdmin && <button onClick={toggleCompleted} style={{ marginLeft:"auto", background:design.status==="Completed"?T.orange:T.green, color:"#fff", border:"none", borderRadius:6, fontFamily:T.mono, fontSize:11, fontWeight:700, padding:"6px 14px", cursor:"pointer" }}>{design.status==="Completed"?"Reopen":"Mark Completed"}</button>}
        </div>
      </div>
      <div style={{ display:"flex", gap:3, marginBottom:16, background:T.surface, borderRadius:8, padding:4, flexWrap:"wrap" }}>
        {DTABS.map(t => (
          <button key={t} onClick={() => setDt(t)} style={{ background:dt===t?T.card:"none", border:"none", borderRadius:6, color:dt===t?T.gold:T.steelLt, fontFamily:T.mono, fontSize:10, fontWeight:700, padding:"7px 12px", cursor:"pointer", textTransform:"uppercase", position:"relative" }}>
            <BL text={t} />
            {t==="Pending Approvals" && pending.length > 0 && <span style={{ background:T.red, color:"#fff", borderRadius:10, fontSize:8, padding:"1px 5px", marginLeft:4 }}>{pending.length}</span>}
          </button>
        ))}
      </div>
      {dt==="Job Sheet" && <Section title="Job Register / Job Sheet" action={<PdfBtn targetId="rpt-jobsheet" title={`Job Register ${design.designNo}`} />}><div id="rpt-jobsheet"><JobSheetView design={design} /></div></Section>}
      {dt==="Flow" && <Section title="Production Flow — full journey" action={<PdfBtn targetId="rpt-flow" title={`Production Flow ${design.designNo}`} />}><div id="rpt-flow"><ProductionFlow design={design} jobbers={jobbers} /></div></Section>}
      {dt==="Fill Sizes" && <Section title="Job Register — Fill Cut Sizes" action={<PdfBtn targetId="rpt-sizes" title={`Job Register ${designLabel(design)}`} />}><div id="rpt-sizes"><SizeEditor design={design} onUpdate={save} role={role} onConfirmLock={confirmLock} L={L} onSendLot={onSendLot} people={people||jobbers} currentJobber={currentJobber} /></div></Section>}
      {dt==="Customer Orders" && <Section title="Customer Orders"><CustomerOrders design={design} onUpdate={save} role={role} /></Section>}
      {dt==="Photos" && <Section title="Reference Photos & Shirt Details"><ReferencePhotos design={design} onUpdate={save} role={role} /></Section>}
      {dt==="Movement" && <Section title="Movement Log"><MovementLog design={design} jobbers={jobbers} onAdd={addMovement} role={role} /></Section>}
      {dt==="Supplier Bills" && <Section title="Fabric Supplier Bills"><SupplierBills design={design} onUpdate={save} role={role} /></Section>}
      {dt==="Process Register" && isAdmin && <Section title="Process Register & Cost Code" action={<PdfBtn targetId="rpt-proc" title={`Process Register ${design.designNo}`} />}><div id="rpt-proc"><ProcessRegister design={design} jobbers={jobbers} onUpdate={updProcess} role={role} /></div></Section>}
      {dt==="Cost Sheet" && isAdmin && <Section title="Design Cost Sheet" action={<PdfBtn targetId="rpt-cost" title={`Cost Sheet ${design.designNo}`} />}><div id="rpt-cost"><DesignCostSheet design={design} jobbers={jobbers} challans={challans} /></div></Section>}
      {dt==="MRP" && isAdmin && <Section title="MRP & Product Codes"><MRPPanel design={design} onUpdate={save} /></Section>}
      {dt==="Barcode" && isAdmin && <Section title="Barcode Generator"><BarcodePanel design={design} jobbers={jobbers} onUpdate={save} /></Section>}
      {dt==="Pending Approvals" && isAdmin && <Section title="Pending Approvals"><PendingApprovals design={design} jobbers={jobbers} onApprove={approveEntry} onReject={rejectEntry} /></Section>}
    </div>
  );
}

// ── Process Assignment dropdown (filtered by process, show-all toggle, Other) ──
function ProcessAssignRow({ procName, jobbers, value, onChange, onAddJobber }) {
  const [showAll, setShowAll] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPrefix, setNewPrefix] = useState("");
  const list = showAll ? jobbers : jobbers.filter(j => jobberDoesProcess(j, procName));
  async function addNew() {
    if (!newName.trim()) return;
    const created = await onAddJobber({ name:newName.trim(), process:procName, prefix:newPrefix.trim() });
    if (created) onChange(created.id);
    setAdding(false); setNewName(""); setNewPrefix("");
  }
  return (
    <div style={{ background:T.surface, borderRadius:8, padding:12, border:`1px solid ${T.border}` }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
        <span style={{ fontFamily:T.mono, fontSize:11, color:T.white, fontWeight:700 }}>{procName}</span>
        <button onClick={() => setShowAll(s => !s)} style={{ background:"none", border:"none", color:T.steelLt, fontSize:10, cursor:"pointer", fontFamily:T.mono }}>{showAll?"show process only":"show all"}</button>
      </div>
      {adding ? (
        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="New jobber name" style={{ flex:2, minWidth:120, background:T.bg, border:`1px solid ${T.border}`, borderRadius:4, color:T.text, fontSize:12, padding:"6px 8px" }} />
          <input value={newPrefix} onChange={e => setNewPrefix(e.target.value)} placeholder="code e.g. 19" style={{ width:80, background:T.bg, border:`1px solid ${T.border}`, borderRadius:4, color:T.text, fontSize:12, padding:"6px 8px" }} />
          <Btn label="Save" onClick={addNew} small />
          <Btn label="✕" onClick={() => setAdding(false)} color={T.surface} textColor={T.steelLt} small />
        </div>
      ) : (
        <select value={value||""} onChange={e => { if (e.target.value === "__other__") { setAdding(true); } else { onChange(e.target.value); } }} style={{ background:T.bg, border:`1px solid ${T.border}`, color:T.text, borderRadius:6, padding:"7px 10px", fontSize:12, width:"100%" }}>
          <option value="">— not assigned yet —</option>
          {list.map(j => <option key={j.id} value={j.id}>{j.name}{j.prefix?` (${j.prefix})`:""}</option>)}
          <option value="__other__">+ Other (add new jobber)</option>
        </select>
      )}
    </div>
  );
}

function FabricBillPhoto({ bill, onPick }) {
  const ref = useRef();
  return (
    <div>
      <div onClick={() => ref.current && ref.current.click()} style={{ width:56, height:56, borderRadius:6, overflow:"hidden", background:T.bg, border:`1px solid ${T.border}`, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>
        {bill.photo ? <img src={bill.photo} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} draggable={false} /> : <span style={{ fontSize:8, color:T.textDim, fontFamily:T.mono, textAlign:"center" }}>Bill<br/>photo</span>}
      </div>
      <input ref={ref} type="file" accept="image/*" style={{ display:"none" }} onChange={e => onPick(e.target.files[0])} />
    </div>
  );
}

// ── Design Form (specs + swatches + photos + notes; NO sizes) ─────────────────
function DesignForm({ onSave, onCancel, existing, jobbers = [], onAddJobber, designs = [], creditNotes = [] }) {
  const blank = { designNo:"", lotNo:"", brand:"RUDE INC", style:"", fabric:"", supplier:"Aashish Apparels", p1Code:"", p1MRP:"", p2Code:"", p2MRP:"", fit:"Slim Fit", collarType:"Round Collar", shrinkageLen:"", shrinkageWid:"", placket:"Inside", washType:"Normal", specs: SPEC_KEYS.map(k => ({ key:k, text:"", thumb:"" })), ratio:{}, trims:"", drawingAvg:"", manualAvg:{ smxxl:"", x3to5:"", bigLabel:"6XL+", big:"" }, dateProgram:"", dateCut:"", mainThumb:"", notes:"", keywords:"", instructions:"", customSizes:[], photos:[], colors:[], activeColors:["S","M","L","XL","XXL"], processes:{}, movements:[], jobberEntries:[], supplierBills:[], customerOrders:[], status:"New", mrpFinalized:false };
  const [d, setD] = useState(existing ? {...existing} : blank);
  const DEFAULT_ORDER = ["identity","avg","specs","sizes","ratio","colors","instructions","fabricbill","photos","process","note"];
  // GLOBAL order: once anyone reorders, it becomes the default for all designs (this session + saved on each design)
  const startOrder = (window.__erpFormOrder && window.__erpFormOrder.length===DEFAULT_ORDER.length)
    ? window.__erpFormOrder
    : ((existing && existing.formOrder && existing.formOrder.length===DEFAULT_ORDER.length) ? existing.formOrder : DEFAULT_ORDER);
  const [secOrder, setSecOrder] = useState(startOrder);
  const [dragKey, setDragKey] = useState(null);
  function onDrop(targetKey) {
    if (!dragKey || dragKey===targetKey) return;
    setSecOrder(order => {
      const arr = [...order];
      const from = arr.indexOf(dragKey), to = arr.indexOf(targetKey);
      arr.splice(from,1); arr.splice(to,0,dragKey);
      window.__erpFormOrder = arr; // remember globally for all designs this session
      return arr;
    });
    setDragKey(null);
  }
  const [saving, setSaving] = useState(false);
  const fileRef = useRef();
  const [photoNote, setPhotoNote] = useState("");
  const upd = k => v => setD(f => ({...f,[k]:v}));
  const tog = k => () => setD(f => ({...f,[k]:!f[k]}));
  function addColor() { setD(f => ({...f, colors:[...f.colors, {id:`C${Date.now()}`,colorName:"",colorNo:"",sleeve:"",meters:"",sizes:{},samples:{},sampleFabric:[],balance:"",swatch:""}]})); }
  function updColor(id,k,v) { setD(f => ({...f, colors:f.colors.map(c => c.id===id?{...c,[k]:v}:c)})); }
  function removeColor(id) { setD(f => ({...f, colors:f.colors.filter(c => c.id!==id)})); }
  function addFabricBill() { setD(f => ({...f, supplierBills:[...(f.supplierBills||[]), {id:`B${Date.now()}`, billType:"Fabric", supplier:"", billNo:"", billDate:"", lrNo:"", qty:"", rate:"", amount:"", photo:"", appliesTo:[]}]})); }
  function updFabricBill(id,k,v) { setD(f => ({...f, supplierBills:(f.supplierBills||[]).map(b => { if(b.id!==id) return b; const nb={...b,[k]:v}; if(k==="qty"||k==="rate") nb.amount=((+nb.qty||0)*(+nb.rate||0))||""; return nb; })})); }
  function removeFabricBill(id) { setD(f => ({...f, supplierBills:(f.supplierBills||[]).filter(b => b.id!==id)})); }
  function addBillDesign(billId) { setD(f => ({...f, supplierBills:(f.supplierBills||[]).map(b => b.id===billId ? {...b, appliesTo:[...(b.appliesTo||[]), {designNo:"", meters:""}]} : b)})); }
  function updBillDesign(billId, idx, k, v) { setD(f => ({...f, supplierBills:(f.supplierBills||[]).map(b => b.id===billId ? {...b, appliesTo:(b.appliesTo||[]).map((x,i)=>i===idx?{...x,[k]:v}:x)} : b)})); }
  function removeBillDesign(billId, idx) { setD(f => ({...f, supplierBills:(f.supplierBills||[]).map(b => b.id===billId ? {...b, appliesTo:(b.appliesTo||[]).filter((x,i)=>i!==idx)} : b)})); }
  function fabricBillPhoto(id, file) { if(!file) return; compressImage(file).then(src => updFabricBill(id,"photo",src)).catch(()=>{}); }
  function toggleSize(s) { setD(f => ({...f, activeColors:f.activeColors.includes(s)?f.activeColors.filter(x=>x!==s):[...f.activeColors,s]})); }
  function addCustomSize() {
    const name = (prompt("Enter new size name (e.g. 10XL, 11XL, Free Size):")||"").trim();
    if (!name) return;
    setD(f => {
      if ((f.customSizes||[]).includes(name) || SIZES.includes(name)) { alert("That size already exists."); return f; }
      return { ...f, customSizes:[...(f.customSizes||[]), name], activeColors:[...f.activeColors, name] };
    });
  }
  function removeCustomSize(name) {
    setD(f => ({ ...f, customSizes:(f.customSizes||[]).filter(x=>x!==name), activeColors:f.activeColors.filter(x=>x!==name) }));
  }
  function ensureSpecs(arr) { return SPEC_KEYS.map(k => (arr||[]).find(x=>x.key===k) || { key:k, text:"", thumb:"" }); }
  function updSpec(key, field, v) { setD(f => ({ ...f, specs: ensureSpecs(f.specs).map(sp => sp.key===key ? {...sp,[field]:v} : sp) })); }
  function updRatio(sz, v) { setD(f => ({ ...f, ratio: { ...(f.ratio||{}), [sz]: v } })); }
  function updManualAvg(k, v) { setD(f => ({ ...f, manualAvg: { ...(f.manualAvg||{}), [k]: v } })); }
  function addPhoto(e) {
    const file = e.target.files[0]; if (!file) return;
    compressImage(file).then(src => { setD(f => ({...f, photos:[...(f.photos||[]), {id:`P${Date.now()}`,src,note:photoNote,date:new Date().toISOString().slice(0,10)}]})); setPhotoNote(""); }).catch(() => {});
  }
  function removePhoto(id) { setD(f => ({...f, photos:(f.photos||[]).filter(p => p.id!==id)})); }
  function assignProc(procName, jobberId) {
    setD(f => ({ ...f, processes: { ...f.processes, [procName]: { ...(f.processes?.[procName]||{}), jobber: jobberId, prefix: codeForProcess(jobbers.find(j => j.id===jobberId), procName) } } }));
  }
  async function handleSave() {
    const validBills = (d.supplierBills||[]).filter(b => b.supplier && b.qty);
    if (validBills.length === 0) { alert("Please add at least one Fabric Supplier Bill (supplier + quantity) before creating the design."); return; }
    setSaving(true); await onSave({ ...d, formOrder: secOrder }); setSaving(false);
  }
  const G = { display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))", gap:12, marginBottom:12 };
  const dragHandle = (key) => ({ draggable:true, onDragStart:()=>setDragKey(key), onDragOver:e=>e.preventDefault(), onDrop:()=>onDrop(key), style:{ order: secOrder.indexOf(key), border: dragKey===key?`1px dashed ${T.gold}`:"none", borderRadius:8 } });
  const handleBar = <div style={{ display:"flex", alignItems:"center", gap:6, cursor:"grab", color:T.steelLt, fontFamily:T.mono, fontSize:9, padding:"2px 0" }}>⋮⋮ drag to reorder</div>;
  return (
    <div style={{ fontFamily:T.sans }}>
    <div style={{ display:"flex", flexDirection:"column" }}>
      <div {...dragHandle("identity")}>
        {handleBar}
      <Section title="Design Identity">
        <div style={{ background:T.gold+"15", border:`1px solid ${T.gold}`, borderRadius:8, padding:12, marginBottom:12 }}>
          <Inp label="🏷 Code Words / Tags (type here, search by these later)" value={d.keywords||""} onChange={upd("keywords")} placeholder="e.g. blue check, diwali lot, party wear" />
        </div>
        <div style={G}>
          <Inp label="Design Number *" value={d.designNo} onChange={upd("designNo")} placeholder="e.g. 2084" />
          <Inp label="Lot No (this run)" value={d.lotNo} onChange={upd("lotNo")} placeholder="e.g. 3290" />
          <Inp label="Brand" value={d.brand} onChange={upd("brand")} />
          <Inp label="Style" value={d.style} onChange={upd("style")} />
          <Inp label="Fabric" value={d.fabric} onChange={upd("fabric")} />
          <Inp label="Supplier" value={d.supplier} onChange={upd("supplier")} />
          <Inp label="Fit" value={d.fit} onChange={upd("fit")} options={FITS} />
          <Inp label="Sleeve Type" value={d.sleeveType||"Full"} onChange={upd("sleeveType")} options={["Full","Half","Both"]} />
        </div>
        <div style={{ display:"flex", gap:16, flexWrap:"wrap", alignItems:"flex-end", marginTop:6 }}>
          <div>
            <div style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, marginBottom:4, textTransform:"uppercase" }}>Design Thumbnail</div>
            <PhotoUpload value={d.mainThumb} onChange={upd("mainThumb")} size={72} />
          </div>
          <div style={{ display:"flex", gap:12, alignItems:"flex-end" }}>
            <Inp label="Date Program Given" type="date" value={d.dateProgram} onChange={upd("dateProgram")} style={{ minWidth:160 }} />
            <Inp label="Date Cut" type="date" value={d.dateCut} onChange={upd("dateCut")} style={{ minWidth:160 }} />
          </div>
          <Inp label="Trims (meters, added on top)" type="number" value={d.trims} onChange={upd("trims")} style={{ minWidth:160 }} />
        </div>
      </Section>
      </div>
      <div {...dragHandle("avg")}>
        {handleBar}
      <Section title="Fabric Average — Manual Entry">
        <div style={{ fontFamily:T.mono, fontSize:10, color:T.textDim, marginBottom:10 }}>One average per size-group. Only groups containing your selected (active) sizes are shown. Default grouping: S–XXL together, then in 3s.</div>
        {(() => {
          // groups: first is S-XXL (the 5 base sizes), then groups of 3
          const ALL = [...SIZES, ...((d.customSizes)||[])];
          const baseGroup = ["S","M","L","XL","XXL"];
          const rest = ALL.filter(s => !baseGroup.includes(s));
          const groups = [baseGroup];
          for (let i=0;i<rest.length;i+=3) groups.push(rest.slice(i,i+3));
          // keep only groups that have at least one ACTIVE (selected) size
          const active = d.activeColors||[];
          const visibleGroups = groups
            .map(g => g.filter(s => active.includes(s)))
            .filter(g => g.length>0);
          if (visibleGroups.length===0) return <div style={{ color:T.textDim, fontFamily:T.mono, fontSize:11 }}>Select sizes in "Active Sizes" first — average boxes appear here for the selected sizes.</div>;
          const groupKey = g => "g_"+g.join("_");
          const groupLabel = g => g.length===1 ? g[0] : `${g[0]}–${g[g.length-1]}`;
          return (
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(170px,1fr))", gap:12 }}>
              {visibleGroups.map(g => (
                <Inp key={groupKey(g)} label={`Average ${groupLabel(g)} (${g.join(", ")})`} type="number" value={(d.manualAvg||{})[groupKey(g)]||""} onChange={v => updManualAvg(groupKey(g),v)} placeholder="e.g. 1.45" />
              ))}
              <Inp label="Drawing Average" value={d.drawingAvg} onChange={upd("drawingAvg")} placeholder="manual" />
            </div>
          );
        })()}
      </Section>
      </div>
      <div {...dragHandle("specs")}>
        {handleBar}
      <Section title="Pattern / Garment Specifications">
        <div style={G}>
          <Inp label="Collar Type" value={d.collarType} onChange={upd("collarType")} options={COLLARS} />
          <Inp label="Shrinkage Length" value={d.shrinkageLen} onChange={upd("shrinkageLen")} placeholder="e.g. 2% or 1.5" />
          <Inp label="Shrinkage Width" value={d.shrinkageWid} onChange={upd("shrinkageWid")} placeholder="e.g. 1% or 0.5" />
          <Inp label="Placket" value={d.placket} onChange={upd("placket")} options={PLACKETS} />
          <Inp label="Wash Type" value={d.washType} onChange={upd("washType")} options={WASHES} />
        </div>
        <div style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, margin:"6px 0 10px", textTransform:"uppercase" }}>Details (write anything + optional photo)</div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))", gap:12 }}>
          {ensureSpecs(d.specs).map(sp => (
            <div key={sp.key} style={{ background:T.surface, borderRadius:8, padding:10, border:`1px solid ${T.border}`, display:"flex", gap:10, alignItems:"flex-start" }}>
              <PhotoUpload value={sp.thumb} onChange={v => updSpec(sp.key,"thumb",v)} size={48} />
              <div style={{ flex:1 }}>
                <Inp label={sp.key} value={sp.text} onChange={v => updSpec(sp.key,"text",v)} placeholder="details (optional)" />
              </div>
            </div>
          ))}
        </div>
      </Section>
      </div>
      <div {...dragHandle("sizes")}>
        {handleBar}
      <Section title="Active Sizes (which sizes apply)">
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          {SIZES.map(s => (
            <button key={s} onClick={() => toggleSize(s)} style={{ background:d.activeColors.includes(s)?T.gold:T.surface, color:d.activeColors.includes(s)?T.bg:T.steelLt, border:`1px solid ${T.border}`, borderRadius:6, fontFamily:T.mono, fontWeight:700, fontSize:12, padding:"6px 14px", cursor:"pointer" }}>{s}</button>
          ))}
          {(d.customSizes||[]).map(s => (
            <span key={s} style={{ display:"inline-flex", alignItems:"center", gap:6, background:d.activeColors.includes(s)?T.gold:T.surface, color:d.activeColors.includes(s)?T.bg:T.steelLt, border:`1px solid ${T.gold}`, borderRadius:6, fontFamily:T.mono, fontWeight:700, fontSize:12, padding:"6px 10px" }}>
              <button onClick={() => toggleSize(s)} style={{ background:"none", border:"none", color:"inherit", cursor:"pointer", fontFamily:T.mono, fontWeight:700, fontSize:12, padding:0 }}>{s}</button>
              <button onClick={() => removeCustomSize(s)} style={{ background:"none", border:"none", color:T.red, cursor:"pointer", fontSize:13, padding:0, lineHeight:1 }}>×</button>
            </span>
          ))}
          <Btn label="+ Add custom size" onClick={addCustomSize} small color={T.surface} textColor={T.gold} style={{ border:`1px solid ${T.gold}` }} />
        </div>
        <div style={{ marginTop:8, fontFamily:T.mono, fontSize:10, color:T.textDim }}>Custom sizes (over 9XL) appear in the Fabric Average section grouped in 3s. Actual cut quantities per size are filled later by the jobber.</div>
      </Section>
      </div>
      <div {...dragHandle("ratio")}>
        {handleBar}
      <Section title="Size Ratio (per size)">
        <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"flex-end" }}>
          {sortSizes(d.activeColors, d.customSizes).map(sz => (
            <div key={sz} style={{ textAlign:"center" }}>
              <div style={{ fontFamily:T.mono, fontSize:9, color:T.gold, marginBottom:3 }}>{sz}</div>
              <input type="number" value={(d.ratio||{})[sz]||""} onChange={e => updRatio(sz, e.target.value)} placeholder="0" style={{ background:T.bg, border:`1px solid ${T.border}`, borderRadius:4, color:T.text, fontFamily:T.mono, fontSize:12, width:48, padding:"5px 4px", textAlign:"center" }} />
            </div>
          ))}
        </div>
        <div style={{ marginTop:6, fontFamily:T.mono, fontSize:10, color:T.textDim }}>Ratio for each size (e.g. S=1, M=2, L=2, XL=1).</div>
      </Section>
      </div>
      <div {...dragHandle("colors")}>
        {handleBar}
      <Section title="Color Swatches" action={<Btn label="+ Add Color" onClick={addColor} small />}>
        {d.colors.length === 0 && <div style={{ color:T.textDim, fontSize:12 }}>No colors added yet. Add a swatch photo and name for each fabric color.</div>}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))", gap:12 }}>
          {d.colors.map((c,ci) => (
            <div key={c.id} style={{ background:T.surface, borderRadius:8, padding:12, border:`1px solid ${T.border}` }}>
              <div style={{ display:"flex", gap:10, alignItems:"flex-start" }}>
                <PhotoUpload value={c.swatch} onChange={v => updColor(c.id,"swatch",v)} size={56} />
                <div style={{ flex:1 }}>
                  <Inp label={`Color ${ci+1}`} value={c.colorName} onChange={v => updColor(c.id,"colorName",v)} placeholder="e.g. Navy Blue" />
                  <div style={{ marginTop:6 }}>
                    <Inp label="Color No" value={c.colorNo||""} onChange={v => updColor(c.id,"colorNo",v)} placeholder="201" />
                  </div>
                  <div style={{ marginTop:6 }}><Inp label="Meters" value={c.meters} onChange={v => updColor(c.id,"meters",v)} type="number" /></div>
                </div>
              </div>
              <div style={{ marginTop:8 }}><Btn label="Remove" onClick={() => removeColor(c.id)} color={T.red+"22"} textColor={T.red} small /></div>
            </div>
          ))}
        </div>
      </Section>
      </div>
      <div {...dragHandle("instructions")}>
        {handleBar}
      <Section title="Shirt Making Instructions">
        <InstructionsBox value={d.instructions} onChange={upd("instructions")} />
      </Section>
      </div>
      <div {...dragHandle("fabricbill")}>
        {handleBar}
      <Section title="Fabric Supplier Bill (required)" action={<Btn label="+ Add Fabric Bill" onClick={addFabricBill} small />}>
        <div style={{ fontFamily:T.mono, fontSize:10, color:T.textDim, marginBottom:10 }}>Enter fabric purchase details here. This flows automatically to Fabric Purchases and the cost sheet. At least one bill is required.</div>
        {(d.supplierBills||[]).length===0 && <div style={{ color:T.orange, fontSize:12, marginBottom:8 }}>⚠ Add at least one fabric supplier bill.</div>}
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {(d.supplierBills||[]).map((b,bi) => (
            <div key={b.id} style={{ background:T.surface, borderRadius:8, padding:12, border:`1px solid ${b.billNo && b.billNo.trim() ? T.green : T.orange}`, display:"flex", gap:12, alignItems:"flex-start", flexWrap:"wrap" }}>
              <div style={{ position:"absolute", marginTop:-22, marginLeft:0 }}>
                <Badge label={b.billNo && b.billNo.trim() ? "✓ COMPLETE" : "⚠ INCOMPLETE — add Bill No"} color={b.billNo && b.billNo.trim() ? T.green : T.orange} />
              </div>
              <FabricBillPhoto bill={b} onPick={file => fabricBillPhoto(b.id, file)} />
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(120px,1fr))", gap:8, flex:1 }}>
                <Inp label="Type" value={b.billType||"Fabric"} onChange={v => updFabricBill(b.id,"billType",v)} options={["Fabric","Trims"]} />
                <Inp label="Bill Date" type="date" value={b.billDate} onChange={v => updFabricBill(b.id,"billDate",v)} />
                <Inp label="Supplier" value={b.supplier} onChange={v => updFabricBill(b.id,"supplier",v)} placeholder="Supplier name" />
                <Inp label="Quantity (m)" type="number" value={b.qty} onChange={v => updFabricBill(b.id,"qty",v)} />
                <Inp label="Rate" type="number" value={b.rate} onChange={v => updFabricBill(b.id,"rate",v)} />
                <Inp label="Amount" type="number" value={b.amount} onChange={v => updFabricBill(b.id,"amount",v)} />
                <Inp label="Bill No" value={b.billNo} onChange={v => updFabricBill(b.id,"billNo",v)} />
                <Inp label="LR No" value={b.lrNo} onChange={v => updFabricBill(b.id,"lrNo",v)} />
                <Inp label="Transporter" value={b.transporter||""} onChange={v => updFabricBill(b.id,"transporter",v)} placeholder="transporter name" />
              </div>
              {/* This bill also covers other designs (split meters) */}
              <div style={{ background:T.bg, borderRadius:6, padding:10, marginTop:8, marginBottom:8 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
                  <span style={{ fontFamily:T.mono, fontSize:9, color:T.steelLt, textTransform:"uppercase" }}>This bill also covers other designs (split meters)</span>
                  <Btn label="+ add design" onClick={() => addBillDesign(b.id)} small color={T.surface} textColor={T.gold} style={{ border:`1px solid ${T.border}` }} />
                </div>
                <div style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, marginBottom:6 }}>
                  This design ({d.designNo||"current"}): <b style={{color:T.gold}}>{b.qty||0} m</b>
                  {(b.appliesTo||[]).length>0 && <span> &nbsp;· others below &nbsp;· grand total: <b style={{color:T.gold}}>{((+b.qty||0)+(b.appliesTo||[]).reduce((a,x)=>a+(+x.meters||0),0))} m</b></span>}
                </div>
                {(b.appliesTo||[]).map((ad,adi) => (
                  <div key={adi} style={{ display:"flex", gap:8, alignItems:"flex-end", marginBottom:6 }}>
                    <div style={{ display:"flex", flexDirection:"column", gap:3, flex:2 }}>
                      <label style={{ fontFamily:T.mono, fontSize:8, color:T.steelLt, textTransform:"uppercase" }}>Other Design No</label>
                      <input value={ad.designNo} onChange={e => updBillDesign(b.id,adi,"designNo",e.target.value)} list={`designs-${b.id}`} placeholder="design no" style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:5, color:T.text, fontFamily:T.sans, fontSize:12, padding:"6px 8px", width:"100%", boxSizing:"border-box" }} />
                    </div>
                    <div style={{ display:"flex", flexDirection:"column", gap:3, width:90 }}>
                      <label style={{ fontFamily:T.mono, fontSize:8, color:T.steelLt, textTransform:"uppercase" }}>Meters</label>
                      <input type="number" value={ad.meters} onChange={e => updBillDesign(b.id,adi,"meters",e.target.value)} style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:5, color:T.text, fontFamily:T.mono, fontSize:12, padding:"6px 8px", width:"100%", boxSizing:"border-box" }} />
                    </div>
                    <Btn label="✕" onClick={() => removeBillDesign(b.id,adi)} color={T.red+"22"} textColor={T.red} small />
                  </div>
                ))}
                <datalist id={`designs-${b.id}`}>{designs && designs.map(dd => <option key={dd.id} value={dd.designNo} />)}</datalist>
              </div>
              <Btn label="✕ Remove this bill" onClick={() => removeFabricBill(b.id)} color={T.red+"22"} textColor={T.red} small />
            </div>
          ))}
        </div>
        {(() => {
          const colourMeters = (d.colors||[]).reduce((a,c)=>a+(+c.meters||0),0);
          const fabricBillQty = (d.supplierBills||[]).filter(b=>(b.billType||"Fabric")==="Fabric").reduce((a,b)=>a+(+b.qty||0),0);
          const trimsBillQty = (d.supplierBills||[]).filter(b=>b.billType==="Trims").reduce((a,b)=>a+(+b.qty||0),0);
          const diff = +(fabricBillQty - colourMeters).toFixed(2);
          const match = Math.abs(diff) < 0.01;
          return (
            <div style={{ marginTop:14, background:match?T.bg:T.red+"22", borderRadius:8, padding:"12px 16px", border:`2px solid ${match?T.green:T.red}` }}>
              <div style={{ fontFamily:T.mono, fontSize:12, color:T.steelLt }}>
                Fabric bill total: <b style={{color:T.gold}}>{fabricBillQty} m</b> &nbsp;·&nbsp; Colour meters total: <b style={{color:match?T.green:T.red}}>{colourMeters} m</b>
                {trimsBillQty>0 && <span> &nbsp;·&nbsp; Trims bills: <b style={{color:T.gold}}>{trimsBillQty} m</b></span>}
              </div>
              {match
                ? <div style={{ fontFamily:T.mono, fontSize:11, color:T.green, marginTop:6 }}>✓ Colour meters match the fabric bill total.</div>
                : <div style={{ fontFamily:T.mono, fontSize:12, color:T.red, marginTop:6, fontWeight:700 }}>⚠ Does NOT match — colour meters {diff>0?`are SHORT by ${Math.abs(diff)} m`:`EXCEED by ${Math.abs(diff)} m`}. Edit each colour's meters above so the total equals the fabric bill ({fabricBillQty} m).</div>
              }
            </div>
          );
        })()}
        {/* View-only: credit notes linked to this design (created from ledgers, shown here by design number) */}
        {(() => {
          const dn = String(d.designNo||"").trim();
          if (!dn) return null;
          const linked = (creditNotes||[]).filter(c => cnDesignNos(c).includes(dn));
          if (linked.length===0) return null;
          return (
            <div style={{ marginTop:14, background:T.red+"10", border:`1px solid ${T.red}44`, borderRadius:8, padding:12 }}>
              <div style={{ fontFamily:T.mono, fontSize:10, color:T.red, textTransform:"uppercase", marginBottom:8, letterSpacing:1 }}>Credit Notes linked to this design (view only)</div>
              <div style={{ fontFamily:T.mono, fontSize:9, color:T.textDim, marginBottom:8 }}>Created from the Jobber / Fabric Supplier ledgers. Shown here automatically via the design number.</div>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11 }}>
                <thead><tr style={{ background:T.surface }}>{["Date","CN No","Against","Reason","Amount (this design)"].map(h => <th key={h} style={{ padding:"6px 8px", fontFamily:T.mono, fontSize:8, color:T.steelLt, textAlign:"left", textTransform:"uppercase", border:`1px solid ${T.border}` }}>{h}</th>)}</tr></thead>
                <tbody>
                  {linked.map((c,i) => {
                    const amtThis = (c.lines||[]).filter(l=>String(l.designNo)===dn).reduce((a,l)=>a+(+l.amount||0),0);
                    const against = c.partyType==="supplier" ? `Supplier: ${c.party}` : `Jobber: ${(jobbers.find(j=>j.id===c.party)||{}).name||c.party}`;
                    return (
                      <tr key={c.id||i} style={{ background:i%2===0?T.card:T.surface }}>
                        <td style={{ padding:"6px 8px", color:T.steelLt, fontFamily:T.mono, border:`1px solid ${T.border}` }}>{c.cnDate}</td>
                        <td style={{ padding:"6px 8px", color:T.gold, fontFamily:T.mono, border:`1px solid ${T.border}` }}>{c.cnNo}</td>
                        <td style={{ padding:"6px 8px", color:T.text, border:`1px solid ${T.border}` }}>{against}</td>
                        <td style={{ padding:"6px 8px", color:T.text, border:`1px solid ${T.border}` }}>{c.reason}</td>
                        <td style={{ padding:"6px 8px", color:T.red, fontFamily:T.mono, fontWeight:700, border:`1px solid ${T.border}` }}>Rs.{amtThis}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })()}
      </Section>
      </div>
      <div {...dragHandle("photos")}>
        {handleBar}
      <Section title="Shirt Photos & Details">
        <div style={{ display:"flex", gap:10, marginBottom:14, alignItems:"flex-end" }}>
          <Inp label="Photo Note / Detail" value={photoNote} onChange={setPhotoNote} placeholder="e.g. Front view — collar detail" style={{ flex:1 }} />
          <Btn label="+ Add Shirt Photo" onClick={() => fileRef.current.click()} />
          <input ref={fileRef} type="file" accept="image/*" style={{ display:"none" }} onChange={addPhoto} />
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))", gap:12 }}>
          {(d.photos||[]).map(p => (
            <div key={p.id} style={{ borderRadius:8, overflow:"hidden", border:`1px solid ${T.border}`, background:T.surface }}>
              <div style={{ position:"relative", paddingBottom:"75%", backgroundImage:`url(${p.src})`, backgroundSize:"cover", backgroundPosition:"center" }} onContextMenu={e => e.preventDefault()}>
                <button onClick={() => removePhoto(p.id)} style={{ position:"absolute", top:6, right:6, background:T.red, border:"none", color:"#fff", borderRadius:4, width:20, height:20, cursor:"pointer", fontSize:11 }}>✕</button>
              </div>
              {p.note && <div style={{ padding:"6px 8px", fontSize:10, color:T.steelLt }}>{p.note}</div>}
            </div>
          ))}
        </div>
      </Section>
      </div>
      <div {...dragHandle("process")}>
        {handleBar}
      <Section title="Process Assignments (optional — can fill later)">
        <div style={{ fontFamily:T.mono, fontSize:10, color:T.textDim, marginBottom:12 }}>Assign a jobber for each process now, or leave blank — it can be set later, or auto-fills when a jobber logs their work.</div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))", gap:12 }}>
          {PROCESSES.filter(p => p!=="Fabric" && p!=="Cut to Pack" && p!=="Other").map(pn => (
            <ProcessAssignRow key={pn} procName={pn} jobbers={jobbers} value={d.processes?.[pn]?.jobber} onChange={id => assignProc(pn, id)} onAddJobber={onAddJobber} />
          ))}
        </div>
      </Section>
      </div>
      <div {...dragHandle("note")}>
        {handleBar}
      <Section title="Common Note / Pattern Instructions">
        <textarea value={d.notes} onChange={e => upd("notes")(e.target.value)} placeholder="What pattern to make, special instructions..." style={{ width:"100%", minHeight:80, background:T.surface, border:`1px solid ${T.border}`, borderRadius:6, color:T.text, fontFamily:T.sans, fontSize:13, padding:10, boxSizing:"border-box", resize:"vertical" }} />
      </Section>
      </div>
      </div>
      <div style={{ display:"flex", gap:12, justifyContent:"flex-end" }}>
        <Btn label="Cancel" onClick={onCancel} color={T.surface} textColor={T.steelLt} />
        <Btn label={saving?"Saving…":existing?"Save Changes":"Create Design"} onClick={handleSave} disabled={saving||!d.designNo||(d.supplierBills||[]).filter(b=>b.supplier&&b.qty).length===0} />
      </div>
    </div>
  );
}

// ── Fabric Purchases (master view across all designs + monthly totals) ────────
function FabricSupplierLedger({ designs, payments, setPayments, creditNotes, setCreditNotes, showToast, currentUser }) {
  const [sel, setSel] = useState("");
  const [search, setSearch] = useState("");
  const [showPay, setShowPay] = useState(false);
  const [showCN, setShowCN] = useState(false);
  const [yearFilter, setYearFilter] = useState(new Date().getFullYear());

  // gather all fabric bills across designs, grouped by supplier name
  const allBills = [];
  designs.forEach(d => (d.supplierBills||[]).forEach(b => { if (b.supplier && b.supplier.trim()) allBills.push({ ...b, designNo:b.designNo||d.designNo }); }));
  const supplierNames = [...new Set(allBills.map(b => b.supplier.trim()))].sort();
  const filteredNames = search.length>0 ? supplierNames.filter(n => n.toLowerCase().includes(search.toLowerCase())) : supplierNames;

  const supPayId = name => "SUP:"+name;
  const yearOf = s => { const m=(s||"").match(/(\d{4})/); return m?+m[1]:null; };

  if (!sel) {
    return (
      <div>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search fabric supplier by name..." style={{ background:T.card, border:`2px solid ${T.gold}`, borderRadius:8, color:T.text, fontFamily:T.mono, fontSize:14, padding:"10px 16px", width:"100%", boxSizing:"border-box", outline:"none", marginBottom:16 }} />
        <div style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, textTransform:"uppercase", marginBottom:8 }}>Fabric Suppliers ({filteredNames.length}) — tap to open ledger</div>
        {filteredNames.length===0 && <div style={{ textAlign:"center", color:T.textDim, padding:40, fontFamily:T.mono }}>No fabric suppliers found. They appear automatically from fabric bills.</div>}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))", gap:12 }}>
          {filteredNames.map(name => {
            const bills = allBills.filter(b => b.supplier.trim()===name);
            const billed = bills.reduce((a,b)=>a+(+b.amount||0),0);
            const paid = payments.filter(p=>p.jobberId===supPayId(name)).reduce((a,p)=>a+(+p.amount||0),0);
            const bal = billed-paid;
            return (
              <div key={name} onClick={()=>setSel(name)} style={{ background:T.card, borderRadius:10, border:`1px solid ${T.border}`, borderLeft:`4px solid ${bal>0?T.red:T.green}`, padding:16, cursor:"pointer" }}>
                <div style={{ color:T.white, fontWeight:700, fontSize:15, marginBottom:6 }}>{name}</div>
                <div style={{ fontFamily:T.mono, fontSize:11, color:T.steelLt }}>Purchases: <b style={{color:T.white}}>Rs.{billed.toFixed(0)}</b></div>
                <div style={{ fontFamily:T.mono, fontSize:11, color:T.steelLt }}>Paid: <b style={{color:T.green}}>Rs.{paid.toFixed(0)}</b></div>
                <div style={{ fontFamily:T.mono, fontSize:13, color:bal>0?T.red:T.green, fontWeight:700, marginTop:4 }}>Balance: Rs.{bal.toFixed(0)}</div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // selected supplier ledger
  const bills = allBills.filter(b => b.supplier.trim()===sel);
  const myPays = payments.filter(p => p.jobberId===supPayId(sel));
  const myCNs = (creditNotes||[]).filter(c => c.partyType==="supplier" && c.party===sel);
  const years = [...new Set([...bills.map(b=>yearOf(b.billDate)), ...myPays.map(p=>yearOf(p.date)), new Date().getFullYear()].filter(Boolean))].sort((a,b)=>b-a);
  const rows = [
    ...bills.filter(b=>yearOf(b.billDate)===yearFilter).map(b => ({ date:b.billDate||"", particulars:`Design ${b.designNo} — ${b.billType||"Fabric"}${b.billNo?` (Bill ${b.billNo})`:" (no bill no)"}`, ref:b.billNo||"", debit:+b.amount||0, credit:0 })),
    ...myPays.filter(p=>yearOf(p.date)===yearFilter).map(p => ({ date:p.date||"", particulars:`Payment (${p.mode||p.channel})`, ref:p.note||"", debit:0, credit:+p.amount||0 })),
    ...myCNs.filter(c=>yearOf(c.cnDate)===yearFilter).map(c => ({ date:c.cnDate||"", particulars:`Credit Note — ${c.reason||"claim"} (Designs ${cnDesignNos(c).join(", ")})`, ref:c.cnNo||"", debit:0, credit:+c.total||0 })),
  ].sort((a,b)=>(a.date||"").localeCompare(b.date||""));
  let run=0; const withBal = rows.map(r=>{ run+=r.debit-r.credit; return {...r,balance:run}; });
  const totDebit = rows.reduce((a,r)=>a+r.debit,0), totCredit = rows.reduce((a,r)=>a+r.credit,0);

  async function savePayment(amount, date, mode, note) {
    const p = { id:`PAY${Date.now()}`, jobberId:supPayId(sel), date, amount:+amount, mode, channel:"bank", note, createdBy:currentUser, createdAtStr:nowStr() };
    await dbUpsert("payments", payToRow(p));
    setPayments(prev => [p, ...prev]);
    recordActivity(currentUser, "Fabric supplier payment", sel, `Rs.${amount}`);
    showToast("Payment recorded ✓");
    setShowPay(false);
  }

  return (
    <div>
      <div style={{ display:"flex", gap:10, alignItems:"center", marginBottom:16, flexWrap:"wrap" }}>
        <Btn label="← Back to suppliers" onClick={()=>setSel("")} color={T.surface} textColor={T.steelLt} small />
        <span style={{ color:T.white, fontWeight:700, fontSize:18 }}>{sel}</span>
        <select value={yearFilter} onChange={e=>setYearFilter(+e.target.value)} style={{ background:T.surface, border:`1px solid ${T.border}`, color:T.text, borderRadius:6, padding:"6px 12px", fontFamily:T.mono, fontSize:12 }}>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <Btn label="+ Record Payment" onClick={()=>setShowPay(true)} color={T.green} textColor="#fff" small />
        <Btn label="+ Credit Note" onClick={()=>setShowCN(true)} color={T.red} textColor="#fff" small />
        <Btn label="Export PDF" onClick={()=>{
          const w=window.open("","_blank"); if(!w){showToast("Allow popups","error");return;}
          const rws=withBal.map(r=>`<tr><td>${r.date||""}</td><td>${r.particulars}</td><td style="text-align:right">${r.debit?r.debit.toFixed(2):""}</td><td style="text-align:right;color:#0a0">${r.credit?r.credit.toFixed(2):""}</td><td style="text-align:right;font-weight:bold">${r.balance.toFixed(2)}</td></tr>`).join("");
          w.document.write(`<html><head><title>${sel}</title><style>body{font-family:Arial;padding:24px}h1{font-size:20px;margin:0}h2{font-size:13px;color:#555;margin:4px 0 16px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}th{background:#f0f0f0}</style></head><body><h1>AASHISH APPARELS — Fabric Supplier Account</h1><h2>Supplier: ${sel} · Year: ${yearFilter} · Printed: ${new Date().toLocaleDateString()}</h2><table><thead><tr><th>Date</th><th>Particulars</th><th style="text-align:right">Debit</th><th style="text-align:right">Credit</th><th style="text-align:right">Balance</th></tr></thead><tbody>${rws}</tbody><tfoot><tr style="font-weight:bold;background:#f8f8f8"><td colspan=2>TOTAL</td><td style="text-align:right">${totDebit.toFixed(2)}</td><td style="text-align:right">${totCredit.toFixed(2)}</td><td style="text-align:right">${(totDebit-totCredit).toFixed(2)}</td></tr></tfoot></table></body></html>`);
          w.document.close(); setTimeout(()=>w.print(),300);
        }} color={T.surface} textColor={T.gold} small style={{ border:`1px solid ${T.border}` }} />
      </div>

      <div style={{ display:"flex", gap:14, marginBottom:16, flexWrap:"wrap" }}>
        <div style={{ background:T.surface, borderRadius:8, padding:"12px 18px", borderLeft:`3px solid ${T.gold}`, minWidth:150 }}><div style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt }}>TOTAL PURCHASES</div><div style={{ fontFamily:T.mono, fontSize:17, fontWeight:900, color:T.white }}>Rs.{totDebit.toFixed(0)}</div></div>
        <div style={{ background:T.surface, borderRadius:8, padding:"12px 18px", borderLeft:`3px solid ${T.green}`, minWidth:150 }}><div style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt }}>TOTAL PAID</div><div style={{ fontFamily:T.mono, fontSize:17, fontWeight:900, color:T.green }}>Rs.{totCredit.toFixed(0)}</div></div>
        <div style={{ background:T.surface, borderRadius:8, padding:"12px 18px", borderLeft:`3px solid ${(totDebit-totCredit)>0?T.red:T.green}`, minWidth:150 }}><div style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt }}>BALANCE DUE</div><div style={{ fontFamily:T.mono, fontSize:17, fontWeight:900, color:(totDebit-totCredit)>0?T.red:T.green }}>Rs.{(totDebit-totCredit).toFixed(0)}</div></div>
      </div>

      <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11 }}>
        <thead><tr style={{ background:T.surface }}>{["Date","Particulars","Bill No","Debit","Credit","Balance"].map(h=><th key={h} style={{ padding:"8px 10px", fontFamily:T.mono, fontSize:9, color:T.steelLt, textAlign:"left", textTransform:"uppercase", border:`1px solid ${T.border}` }}>{h}</th>)}</tr></thead>
        <tbody>
          {withBal.length===0 && <tr><td colSpan={6} style={{ padding:16, textAlign:"center", color:T.textDim, fontFamily:T.mono, border:`1px solid ${T.border}` }}>No entries for {yearFilter}.</td></tr>}
          {withBal.map((r,i)=>(
            <tr key={i} style={{ background:i%2===0?T.card:T.surface }}>
              <td style={{ padding:"8px 10px", color:T.steelLt, fontFamily:T.mono, border:`1px solid ${T.border}` }}>{r.date}</td>
              <td style={{ padding:"8px 10px", color:T.white, border:`1px solid ${T.border}` }}>{r.particulars}</td>
              <td style={{ padding:"8px 10px", color:T.gold, fontFamily:T.mono, border:`1px solid ${T.border}` }}>{r.ref||"—"}</td>
              <td style={{ padding:"8px 10px", color:T.white, fontFamily:T.mono, border:`1px solid ${T.border}` }}>{r.debit?`Rs.${r.debit.toFixed(2)}`:""}</td>
              <td style={{ padding:"8px 10px", color:T.green, fontFamily:T.mono, border:`1px solid ${T.border}` }}>{r.credit?`Rs.${r.credit.toFixed(2)}`:""}</td>
              <td style={{ padding:"8px 10px", color:r.balance>0?T.red:T.green, fontFamily:T.mono, fontWeight:700, border:`1px solid ${T.border}` }}>Rs.{r.balance.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {showPay && <FabricPayModal supplier={sel} onClose={()=>setShowPay(false)} onSave={savePayment} />}
      {showCN && <CreditNoteForm partyType="supplier" partyLabel={sel} designs={designs} currentUser={currentUser} onClose={()=>setShowCN(false)} onSave={async (cn) => {
        const full = { ...cn, id:`CN${Date.now()}`, partyType:"supplier", party:sel, createdAtStr:nowStr() };
        await dbUpsert("credit_notes", cnToRow(full));
        setCreditNotes(p => [full, ...p]);
        recordActivity(currentUser, "Credit note (supplier)", sel, `CN ${cn.cnNo} Rs.${cn.total} — ${cn.reason}`);
        showToast("Credit note saved ✓"); setShowCN(false);
      }} />}
    </div>
  );
}

function FabricPayModal({ supplier, onClose, onSave }) {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0,10));
  const [mode, setMode] = useState("UPI");
  const [note, setNote] = useState("");
  return (
    <Modal title={`Payment to ${supplier}`} onClose={onClose}>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:14 }}>
        <Inp label="Date" type="date" value={date} onChange={setDate} />
        <Inp label="Amount (Rs.)" type="number" value={amount} onChange={setAmount} />
        <Inp label="Mode" value={mode} onChange={setMode} options={["UPI","Bank Transfer","Cheque","NEFT/RTGS","Cash"]} />
        <Inp label="Note" value={note} onChange={setNote} placeholder="optional" />
      </div>
      <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
        <Btn label="Cancel" onClick={onClose} color={T.surface} textColor={T.steelLt} />
        <Btn label="Save Payment" onClick={()=>amount&&onSave(amount,date,mode,note)} disabled={!amount} color={T.green} textColor="#fff" />
      </div>
    </Modal>
  );
}

function FabricPurchases({ designs }) {
  const [monthFilter, setMonthFilter] = useState("");
  const all = [];
  designs.forEach(d => (d.supplierBills||[]).forEach(b => all.push({ ...b, designNo: b.designNo||d.designNo })));
  all.sort((a,b) => (b.billDate||"").localeCompare(a.billDate||""));
  const months = Array.from(new Set(all.map(b => monthKey(b.billDate)).filter(Boolean)));
  const filtered = monthFilter ? all.filter(b => monthKey(b.billDate)===monthFilter) : all;
  const totQty = filtered.reduce((a,b)=>a+(+b.qty||0),0);
  const totAmt = filtered.reduce((a,b)=>a+(+b.amount||0),0);
  const byMonth = {};
  all.forEach(b => { const m = monthKey(b.billDate)||"(no date)"; if(!byMonth[m]) byMonth[m]={qty:0,amt:0}; byMonth[m].qty+=(+b.qty||0); byMonth[m].amt+=(+b.amount||0); });
  return (
    <div>
      <div style={{ display:"flex", gap:14, marginBottom:18, flexWrap:"wrap" }}>
        <div style={{ background:T.surface, borderRadius:8, padding:"14px 18px", borderLeft:`3px solid ${T.gold}` }}>
          <div style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt }}>TOTAL FABRIC {monthFilter?`(${monthFilter})`:"(all)"}</div>
          <div style={{ fontFamily:T.mono, fontSize:18, fontWeight:900, color:T.gold }}>{totQty} m · Rs.{totAmt.toFixed(2)}</div>
        </div>
      </div>
      <div style={{ marginBottom:16 }}>
        <select value={monthFilter} onChange={e => setMonthFilter(e.target.value)} style={{ background:T.surface, border:`1px solid ${T.border}`, color:T.text, borderRadius:20, padding:"6px 14px", fontSize:11, fontFamily:T.mono }}>
          <option value="">All months</option>
          {months.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
      <div style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, textTransform:"uppercase", marginBottom:8 }}>Monthly Purchase Summary</div>
      <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12, marginBottom:20 }}>
        <thead><tr style={{ background:T.surface }}>{["Month","Quantity (m)","Amount"].map(h => <th key={h} style={{ padding:"8px 10px", fontFamily:T.mono, fontSize:9, color:T.steelLt, textAlign:"left", textTransform:"uppercase", borderBottom:`1px solid ${T.border}` }}>{h}</th>)}</tr></thead>
        <tbody>
          {Object.entries(byMonth).map(([m,v]) => (
            <tr key={m} style={{ borderBottom:`1px solid ${T.border}`, borderLeft:`4px solid ${monthColor(m==="(no date)"?"":(all.find(b=>monthKey(b.billDate)===m)?.billDate))}` }}>
              <td style={{ padding:"8px 10px", color:T.white, fontWeight:600 }}>{m}</td>
              <td style={{ padding:"8px 10px", color:T.gold, fontFamily:T.mono }}>{v.qty}</td>
              <td style={{ padding:"8px 10px", color:T.gold, fontFamily:T.mono, fontWeight:700 }}>Rs.{v.amt.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, textTransform:"uppercase", marginBottom:8 }}>All Fabric Bills</div>
      <div style={{ overflowX:"auto" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11 }}>
          <thead><tr style={{ background:T.surface }}>{["Sr","Bill Date","Bill No","Particulars","Design","Qty","Rate","Amount","LR No"].map(h => <th key={h} style={{ padding:"8px 10px", fontFamily:T.mono, fontSize:9, color:T.steelLt, textAlign:"left", textTransform:"uppercase", borderBottom:`1px solid ${T.border}`, whiteSpace:"nowrap" }}>{h}</th>)}</tr></thead>
          <tbody>
            {filtered.map((b,i) => (
              <tr key={b.id||i} style={{ background:i%2===0?T.card:T.surface, borderBottom:`1px solid ${T.border}`, borderLeft:`4px solid ${monthColor(b.billDate)}` }}>
                <td style={{ padding:"8px 10px", fontFamily:T.mono, color:T.steelLt }}>{i+1}</td>
                <td style={{ padding:"8px 10px", color:T.steelLt }}>{b.billDate||"—"}</td>
                <td style={{ padding:"8px 10px", color:T.gold, fontFamily:T.mono, fontWeight:700 }}>{b.billNo||"—"}</td>
                <td style={{ padding:"8px 10px", color:T.white, fontWeight:600 }}>{b.supplier}</td>
                <td style={{ padding:"8px 10px", color:T.gold, fontFamily:T.mono }}>{b.designNo}</td>
                <td style={{ padding:"8px 10px", color:T.text, fontFamily:T.mono }}>{b.qty||"—"}</td>
                <td style={{ padding:"8px 10px", color:T.gold, fontFamily:T.mono }}>Rs.{b.rate||"—"}</td>
                <td style={{ padding:"8px 10px", color:T.white, fontFamily:T.mono, fontWeight:700 }}>Rs.{b.amount||"—"}</td>
                <td style={{ padding:"8px 10px", color:T.steelLt, fontFamily:T.mono }}>{b.lrNo||"—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filtered.length===0 && <div style={{ textAlign:"center", color:T.textDim, padding:30, fontFamily:T.mono, fontSize:12 }}>No fabric bills yet.</div>}
    </div>
  );
}

// ── Activity Log (admin audit trail) ──────────────────────────────────────────
function ActivityLog({ log }) {
  const [q, setQ] = useState("");
  const rows = (log||[]).filter(l => {
    if (!q) return true;
    const t = (l.who+" "+l.action+" "+l.target+" "+l.detail).toLowerCase();
    return t.includes(q.toLowerCase());
  });
  return (
    <div>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search activity (name, action, design, jobber)..." style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:8, color:T.text, fontFamily:T.sans, fontSize:13, padding:"10px 14px", width:"100%", boxSizing:"border-box", outline:"none", marginBottom:16 }} />
      {rows.length===0 && <div style={{ textAlign:"center", color:T.textDim, padding:40, fontFamily:T.mono, fontSize:12 }}>No activity recorded yet.</div>}
      {rows.length>0 && (
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
          <thead><tr style={{ background:T.surface }}>{["Date & Time","Who","Action","Target","Detail"].map(h => <th key={h} style={{ padding:"8px 10px", fontFamily:T.mono, fontSize:9, color:T.steelLt, textAlign:"left", textTransform:"uppercase", borderBottom:`1px solid ${T.border}` }}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((l,i) => (
              <tr key={l.id||i} style={{ background:i%2===0?T.card:T.surface, borderBottom:`1px solid ${T.border}` }}>
                <td style={{ padding:"8px 10px", color:T.steelLt, fontFamily:T.mono, whiteSpace:"nowrap" }}>{l.ts}</td>
                <td style={{ padding:"8px 10px", color:T.white, fontWeight:600 }}>{l.who}</td>
                <td style={{ padding:"8px 10px", color:T.gold, fontFamily:T.mono }}>{l.action}</td>
                <td style={{ padding:"8px 10px", color:T.text }}>{l.target}</td>
                <td style={{ padding:"8px 10px", color:T.textDim }}>{l.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={{ marginTop:12, fontFamily:T.mono, fontSize:10, color:T.textDim }}>{rows.length} entries · newest first</div>
    </div>
  );
}

// ── Jobber's Designs (info-only, rates hidden by default) ─────────────────────
function JobberDesigns({ jobber, designs, onClose }) {
  const [showRate, setShowRate] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const rows = [];
  designs.forEach(d => {
    PROCESSES.forEach(p => {
      const pr = d.processes?.[p];
      if (pr && pr.jobber===jobber.id) rows.push({ design:d, process:p, label:"", rate:pr.rate, recdDate:pr.recdDate, dlvdDate:pr.dlvdDate });
      (pr?.splits||[]).forEach(sp => { if (sp.jobber===jobber.id) rows.push({ design:d, process:p, label:sp.label||"", rate:sp.rate, recdDate:sp.recdDate, dlvdDate:sp.dlvdDate }); });
    });
  });
  const filtered = rows.filter(r => showCompleted ? r.design.status==="Completed" : r.design.status!=="Completed");
  return (
    <Modal title={`Designs worked on — ${jobber.name}`} onClose={onClose}>
      <div style={{ display:"flex", gap:8, marginBottom:14, flexWrap:"wrap" }}>
        <button onClick={() => setShowCompleted(v=>!v)} style={{ background:showCompleted?T.gold:T.surface, color:showCompleted?T.bg:T.steelLt, border:"none", borderRadius:20, padding:"6px 16px", fontFamily:T.mono, fontSize:11, fontWeight:700, cursor:"pointer" }}>{showCompleted?"Completed":"Active"}</button>
        <button onClick={() => setShowRate(v=>!v)} style={{ background:showRate?T.gold:T.surface, color:showRate?T.bg:T.steelLt, border:"none", borderRadius:20, padding:"6px 16px", fontFamily:T.mono, fontSize:11, fontWeight:700, cursor:"pointer" }}>{showRate?"Rates shown":"Rates hidden"}</button>
      </div>
      {filtered.length===0 && <div style={{ textAlign:"center", color:T.textDim, padding:30, fontFamily:T.mono, fontSize:12 }}>No {showCompleted?"completed":"active"} designs for this jobber.</div>}
      {filtered.length>0 && (
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
          <thead><tr style={{ background:T.surface }}>{["Design","Brand","Process",...(showRate?["Rate"]:[]),"Recd","Dlvd","Days"].map(h => <th key={h} style={{ padding:"8px 10px", fontFamily:T.mono, fontSize:9, color:T.steelLt, textAlign:"left", textTransform:"uppercase", borderBottom:`1px solid ${T.border}` }}>{h}</th>)}</tr></thead>
          <tbody>
            {filtered.map((r,i) => (
              <tr key={i} style={{ background:i%2===0?T.card:T.surface, borderBottom:`1px solid ${T.border}` }}>
                <td style={{ padding:"8px 10px", fontFamily:T.mono, color:T.gold, fontWeight:700 }}>{r.design.designNo}</td>
                <td style={{ padding:"8px 10px", color:T.text }}>{r.design.brand}</td>
                <td style={{ padding:"8px 10px", color:T.white }}>{r.process}{r.label?` (${r.label})`:""}</td>
                {showRate && <td style={{ padding:"8px 10px", color:T.gold, fontFamily:T.mono }}>Rs.{r.rate||"—"}</td>}
                <td style={{ padding:"8px 10px", color:T.steelLt }}>{r.recdDate||"—"}</td>
                <td style={{ padding:"8px 10px", color:T.steelLt }}>{r.dlvdDate||"—"}</td>
                <td style={{ padding:"8px 10px", color:T.steelLt, fontFamily:T.mono }}>{daysBetween(r.recdDate,r.dlvdDate) ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={{ marginTop:12, fontFamily:T.mono, fontSize:10, color:T.textDim }}>This is an information view. Payment details are in the Bills & Ledger tab.</div>
    </Modal>
  );
}

// ── People Manager (Jobbers + Team Members) ───────────────────────────────────
const BLANK_P = { name:"", pin:"", process:"", prefix:"", processCodes:[], phone:"", gst:"", address:"", email:"", role:"jobber", contacts:[], sizeFiller:false, canCreateDesign:false };
function PeopleManager({ people, setPeople, designs, showToast, currentUser }) {
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(BLANK_P);
  const [confirmDel, setConfirmDel] = useState(null);
  const [showPin, setShowPin] = useState({});
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState("jobber");
  const [viewDesigns, setViewDesigns] = useState(null);
  const upd = k => v => setForm(f => ({...f,[k]:v}));
  const filtered = people.filter(p => p.role===tab);
  function addContact() { setForm(f => ({ ...f, contacts:[...(f.contacts||[]), { id:`CT${Date.now()}`, name:"", phone:"", role:"" }] })); }
  function updContact(id, k, v) { setForm(f => ({ ...f, contacts:(f.contacts||[]).map(c => c.id===id ? {...c,[k]:v} : c) })); }
  function removeContact(id) { setForm(f => ({ ...f, contacts:(f.contacts||[]).filter(c => c.id!==id) })); }
  function toggleProcess(pn) {
    setForm(f => {
      const has = (f.processCodes||[]).some(x => x.process===pn);
      const pc = has ? (f.processCodes||[]).filter(x => x.process!==pn) : [...(f.processCodes||[]), { process:pn, code:"" }];
      return { ...f, processCodes: pc };
    });
  }
  function setProcessCode(pn, code) {
    setForm(f => ({ ...f, processCodes: (f.processCodes||[]).map(x => x.process===pn ? {...x, code} : x) }));
  }

  async function save() {
    if (!form.name.trim()) { showToast("Name is required","error"); return; }
    if (!form.pin || String(form.pin).length < 4) { showToast("PIN must be at least 4 digits","error"); return; }
    const editingId = (modal && modal.id) ? modal.id : null;
    const clash = people.find(p => String(p.pin)===String(form.pin) && p.id!==editingId);
    if (clash) { showToast(`PIN already used by ${clash.name}. Choose a different PIN.`,"error"); return; }
    // warn if a person with the same name already exists (likely a duplicate — add the task to that card instead)
    if (modal === "add") {
      const nameClash = people.find(p => (p.name||"").trim().toLowerCase() === form.name.trim().toLowerCase());
      if (nameClash) { showToast(`"${nameClash.name}" already exists. Edit that card and tick the extra task instead of adding a duplicate.`,"error"); return; }
    }
    const first = (form.processCodes||[])[0];
    if (first) { form.process = first.process; form.prefix = first.code; }
    setSaving(true);
    if (modal === "add") {
      const id = (form.role==="team"?"T":"J") + String(Date.now()).slice(-6);
      await dbUpsert("jobbers", jToRow({...form,id}));
      setPeople(p => [...p, {...form,id}]);
      recordActivity(currentUser, "Added "+(form.role==="team"?"team member":"jobber"), form.name, "");
      showToast(`${form.role==="team"?"Team member":"Jobber"} "${form.name}" added!`);
    } else {
      await dbUpsert("jobbers", jToRow({...modal,...form}));
      setPeople(p => p.map(j => j.id===modal.id ? {...j,...form} : j));
      recordActivity(currentUser, "Edited person", form.name, "");
      showToast(`"${form.name}" updated!`);
    }
    setSaving(false);
    setModal(null);
  }

  async function del(j) {
    const used = designs.filter(d => PROCESSES.some(p => d.processes?.[p]?.jobber===j.id)).length;
    if (used > 0) { showToast(`Cannot delete — used in ${used} design(s)`,"error"); setConfirmDel(null); return; }
    await dbDelete("jobbers", j.id);
    setPeople(p => p.filter(x => x.id!==j.id));
    recordActivity(currentUser, "Deleted person", j.name, "");
    showToast(`"${j.name}" deleted`);
    setConfirmDel(null);
  }

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20, flexWrap:"wrap", gap:10 }}>
        <div style={{ display:"flex", gap:8 }}>
          {[["jobber","Jobbers"],["team","Team Members"]].map(([t,lbl]) => (
            <button key={t} onClick={() => setTab(t)} style={{ background:tab===t?T.gold:T.surface, color:tab===t?T.bg:T.steelLt, border:"none", borderRadius:20, padding:"6px 20px", fontFamily:T.mono, fontSize:11, fontWeight:700, cursor:"pointer" }}>
              {lbl} ({people.filter(p => p.role===t).length})
            </button>
          ))}
        </div>
        <Btn label={`+ Add ${tab==="team"?"Team Member":"Jobber"}`} onClick={() => { setForm({...BLANK_P,role:tab,process:tab==="team"?"":"Stitch"}); setModal("add"); }} />
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))", gap:14 }}>
        {filtered.map(j => {
          const assigned = designs.filter(d => PROCESSES.some(p => d.processes?.[p]?.jobber===j.id)).length;
          return (
            <div key={j.id} style={{ background:T.card, borderRadius:10, border:`1px solid ${j.role==="team"?T.steelLt:T.border}`, overflow:"hidden" }}>
              <div style={{ background:T.surface, padding:"12px 16px", borderBottom:`1px solid ${T.border}`, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div>
                  <div style={{ fontFamily:T.mono, fontSize:8, color:T.steelLt }}>{j.id}</div>
                  <div style={{ color:T.white, fontWeight:700, fontSize:15 }}>{j.name}</div>
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:4, alignItems:"flex-end" }}>
                  <Badge label={j.role==="team"?"TEAM":"JOBBER"} color={j.role==="team"?T.steelLt:T.gold} />
                  {(j.processCodes||[]).length>0
                    ? (j.processCodes||[]).map(pc => <Badge key={pc.process} label={`${pc.process} ${pc.code}`} color={T.steel} />)
                    : (j.process && <Badge label={j.process} color={T.steel} />)}
                </div>
              </div>
              <div style={{ padding:"12px 16px", fontSize:12 }}>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"6px 12px", marginBottom:10 }}>
                  <div><span style={{ color:T.steelLt }}>Phone: </span><span style={{ color:T.text }}>{j.phone||"—"}</span></div>
                  <div><span style={{ color:T.steelLt }}>Codes: </span><span style={{ color:T.gold, fontFamily:T.mono, fontWeight:700 }}>{(j.processCodes||[]).length?(j.processCodes||[]).map(p=>p.code).join(", "):(j.prefix||"—")}</span></div>
                  {j.gst && <div style={{ gridColumn:"1/-1" }}><span style={{ color:T.steelLt }}>GST: </span><span style={{ color:T.text, fontFamily:T.mono }}>{j.gst}</span></div>}
                  {(j.contacts||[]).length > 0 && <div style={{ gridColumn:"1/-1", marginTop:4 }}><div style={{ color:T.steelLt, fontSize:11, marginBottom:3 }}>Contacts:</div>{(j.contacts||[]).map(ct => <div key={ct.id} style={{ fontSize:11, color:T.text, paddingLeft:6 }}>• {ct.name}{ct.role?` (${ct.role})`:""}{ct.phone?` — ${ct.phone}`:""}</div>)}</div>}
                  <div><span style={{ color:T.steelLt }}>Designs: </span><span style={{ color:T.gold, fontWeight:700, fontFamily:T.mono }}>{assigned}</span></div>
                </div>
                {j.address && <div style={{ fontSize:11, marginBottom:8 }}><span style={{ color:T.steelLt }}>Address: </span><span style={{ color:T.textDim }}>{j.address}</span></div>}
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12, background:T.surface, borderRadius:6, padding:"6px 10px" }}>
                  <span style={{ color:T.steelLt, fontSize:11 }}>PIN:</span>
                  <span style={{ fontFamily:T.mono, fontSize:13, color:T.gold, letterSpacing:4, flex:1 }}>{showPin[j.id] ? j.pin : "•".repeat(String(j.pin).length)}</span>
                  <button onClick={() => setShowPin(p => ({...p,[j.id]:!p[j.id]}))} style={{ background:"none", border:"none", color:T.steelLt, cursor:"pointer", fontSize:11 }}>{showPin[j.id]?"Hide":"Show"}</button>
                </div>
                {j.role==="jobber" && <Btn label="View Designs" onClick={() => setViewDesigns(j)} color={T.surface} textColor={T.gold} small style={{ width:"100%", border:`1px solid ${T.gold}44`, marginBottom:8 }} />}
                <div style={{ display:"flex", gap:8 }}>
                  <Btn label="Edit" onClick={() => { setForm({...j}); setModal(j); }} color={T.surface} textColor={T.steelLt} small style={{ flex:1, border:`1px solid ${T.border}` }} />
                  <Btn label="Delete" onClick={() => setConfirmDel(j)} color={T.red+"22"} textColor={T.red} small style={{ flex:1, border:`1px solid ${T.red}44` }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {modal && (
        <Modal title={modal==="add"?`Add ${form.role==="team"?"Team Member":"Jobber"}`:`Edit — ${form.name}`} onClose={() => setModal(null)}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:12 }}>
            <Inp label="Full Name *" value={form.name} onChange={upd("name")} placeholder="Full name" />
            <Inp label="Role" value={form.role} onChange={upd("role")} options={["jobber","team"]} />
            <Inp label="Phone" value={form.phone||""} onChange={upd("phone")} type="tel" />
            <Inp label="GST Number" value={form.gst||""} onChange={upd("gst")} placeholder="GST no." />
          </div>
          <div style={{ marginBottom:12 }}><Inp label="Address / Shop" value={form.address||""} onChange={upd("address")} /></div>
          {form.role==="jobber" && (
            <label style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12, cursor:"pointer", fontFamily:T.sans, fontSize:13, color:T.text }}>
              <input type="checkbox" checked={!!form.sizeFiller} onChange={e => upd("sizeFiller")(e.target.checked)} style={{ width:18, height:18, accentColor:T.gold }} />
              This jobber fills the size grid (cutter / stitcher). Others only record their work & pass on.
            </label>
          )}
          {form.role==="jobber" && (
            <label style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12, cursor:"pointer", fontFamily:T.sans, fontSize:13, color:T.text }}>
              <input type="checkbox" checked={!!form.canCreateDesign} onChange={e => upd("canCreateDesign")(e.target.checked)} style={{ width:18, height:18, accentColor:T.gold }} />
              Allow this jobber to create a NEW design from a challan (placeholder — admin completes later). Use for trusted jobbers only.
            </label>
          )}
          {form.role==="jobber" && (
            <div style={{ marginBottom:16 }}>
              <div style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, textTransform:"uppercase", letterSpacing:0.8, marginBottom:8 }}>Area of Work — tick every task this jobber does (one card per jobber)</div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))", gap:8 }}>
                {PROCESSES.filter(p => p!=="Fabric").map(pn => {
                  const checked = (form.processCodes||[]).some(x => x.process===pn);
                  const code = (form.processCodes||[]).find(x => x.process===pn)?.code || "";
                  return (
                    <div key={pn} style={{ background:T.surface, borderRadius:6, padding:"8px 10px", border:`1px solid ${checked?T.gold+"66":T.border}` }}>
                      <label style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer", color:T.text, fontSize:12, marginBottom:checked?6:0 }}>
                        <input type="checkbox" checked={checked} onChange={() => toggleProcess(pn)} style={{ accentColor:T.gold, width:14, height:14 }} />
                        {pn}
                      </label>
                      {checked && <input value={code} onChange={e => setProcessCode(pn, e.target.value)} placeholder="code e.g. 13" style={{ background:T.bg, border:`1px solid ${T.border}`, borderRadius:4, color:T.gold, fontFamily:T.mono, fontSize:12, padding:"5px 8px", width:"100%", boxSizing:"border-box" }} />}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div style={{ marginBottom:16 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
              <span style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, textTransform:"uppercase", letterSpacing:0.8 }}>Additional Contacts (supervisors / helpers)</span>
              <Btn label="+ Add Contact" onClick={addContact} small />
            </div>
            {(form.contacts||[]).length === 0 && <div style={{ fontFamily:T.mono, fontSize:11, color:T.textDim, marginBottom:6 }}>No extra contacts. Tap "+ Add Contact" to add a supervisor or helper.</div>}
            {(form.contacts||[]).map(ct => (
              <div key={ct.id} style={{ display:"flex", gap:8, marginBottom:8, alignItems:"flex-end", flexWrap:"wrap" }}>
                <Inp label="Name" value={ct.name} onChange={v => updContact(ct.id,"name",v)} placeholder="Contact name" style={{ flex:2, minWidth:120 }} />
                <Inp label="Phone" value={ct.phone} onChange={v => updContact(ct.id,"phone",v)} type="tel" placeholder="Phone" style={{ flex:1, minWidth:100 }} />
                <Inp label="Role" value={ct.role} onChange={v => updContact(ct.id,"role",v)} placeholder="e.g. Supervisor" style={{ flex:1, minWidth:100 }} />
                <Btn label="✕" onClick={() => removeContact(ct.id)} color={T.red+"22"} textColor={T.red} small />
              </div>
            ))}
          </div>
          <div style={{ marginBottom:20 }}>
            <Inp label="Login PIN (4 digits — birthdate or last 4 of phone) *" value={form.pin} onChange={upd("pin")} type="number" />
            <div style={{ marginTop:6, fontSize:11, color:T.steelLt }}>Private PIN. Barcode code above is separate and used only for the cost code.</div>
          </div>
          <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
            <Btn label="Cancel" onClick={() => setModal(null)} color={T.surface} textColor={T.steelLt} />
            <Btn label={saving?"Saving…":modal==="add"?"Add":"Save Changes"} onClick={save} disabled={saving} />
          </div>
        </Modal>
      )}
      {viewDesigns && <JobberDesigns jobber={viewDesigns} designs={designs} onClose={() => setViewDesigns(null)} />}
      {confirmDel && (
        <Modal title="Delete?" onClose={() => setConfirmDel(null)}>
          <div style={{ color:T.text, marginBottom:20 }}>Delete <strong style={{ color:T.white }}>{confirmDel.name}</strong>? Cannot be undone.</div>
          <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
            <Btn label="Cancel" onClick={() => setConfirmDel(null)} color={T.surface} textColor={T.steelLt} />
            <Btn label="Yes, Delete" onClick={() => del(confirmDel)} color={T.red} textColor={T.white} />
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Challans (jobber-entered, admin-approved; feeds bills) ─────────────────────
function ChallansPanel({ jobbers, designs, setDesigns, challans, setChallans, bills = [], showToast, currentUser, role }) {
  const isAdmin = role === "admin";
  const [filterJ, setFilterJ] = useState("");
  const [filterDesign, setFilterDesign] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [showApproved, setShowApproved] = useState(false); // default: hide approved, show pending
  const [monthSel, setMonthSel] = useState([]); // multi-select months; empty = all
  const jname = id => jobbers.find(j => j.id===id)?.name || id || "—";
  const monthOf = d => (d||"").slice(0,7); // YYYY-MM

  // available months from challans
  const allMonths = [...new Set(challans.map(c => monthOf(c.date)).filter(Boolean))].sort().reverse();
  function toggleMonth(m) { setMonthSel(p => p.includes(m) ? p.filter(x=>x!==m) : [...p, m]); }

  let list = challans;
  if (!showApproved) list = list.filter(c => c.status==="pending"); // default view = pending only
  if (filterJ) list = list.filter(c => c.jobberId===filterJ);
  if (filterDesign) list = list.filter(c => challanDesigns(c).includes(String(filterDesign)));
  if (monthSel.length) list = list.filter(c => monthSel.includes(monthOf(c.date)));
  list = [...list].sort((a,b) => (b.date||"").localeCompare(a.date||""));

  // TOTAL PIECES RECEIVED BY US = sum of qty on the last process (Press) challans, approved only
  const piecesReceived = challans
    .filter(c => c.status!=="rejected")
    .reduce((sum, c) => {
      const pressLines = (c.lines||[]).filter(l => l.process==="Press");
      if (pressLines.length) return sum + pressLines.reduce((a,l)=>a+(+l.qty||0),0);
      if (c.process==="Press") return sum + (+c.qty||0);
      return sum;
    }, 0);

  async function approve(c) {
    const u = { ...c, status:"approved" };
    await dbUpsert("challans", challanToRow(u));
    setChallans(p => p.map(x => x.id===c.id?u:x));
    recordActivity(currentUser, "Approved challan", `Designs ${challanDesigns(c).join(", ")}`, `${jname(c.jobberId)} · ${challanQty(c)} pcs`);
    showToast("Challan approved ✓");
  }
  async function reject(c) {
    const u = { ...c, status:"rejected" };
    await dbUpsert("challans", challanToRow(u));
    setChallans(p => p.map(x => x.id===c.id?u:x));
    showToast("Challan rejected");
  }
  async function remove(c) {
    await dbDelete("challans", c.id);
    setChallans(p => p.filter(x => x.id!==c.id));
    showToast("Challan deleted");
  }

  const pendingCount = challans.filter(c => c.status==="pending").length;

  return (
    <div>
      <div style={{ display:"flex", gap:10, marginBottom:12, flexWrap:"wrap", alignItems:"center" }}>
        <Btn label="+ New Challan" onClick={() => setShowForm(true)} />
        {isAdmin && pendingCount>0 && <Badge label={`${pendingCount} pending approval`} color={T.orange} />}
        <div style={{ marginLeft:"auto", background:T.surface, borderRadius:8, padding:"8px 16px", border:`1px solid ${T.gold}44` }}>
          <span style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt }}>PIECES RECEIVED (from Press): </span>
          <span style={{ fontFamily:T.mono, fontSize:16, color:T.gold, fontWeight:900 }}>{piecesReceived.toLocaleString()}</span>
        </div>
      </div>

      <div style={{ display:"flex", gap:10, marginBottom:12, flexWrap:"wrap", alignItems:"center" }}>
        <button onClick={() => setShowApproved(v=>!v)} style={{ background:showApproved?T.gold:T.surface, color:showApproved?T.bg:T.steelLt, border:"none", borderRadius:20, padding:"6px 16px", fontFamily:T.mono, fontSize:11, fontWeight:700, cursor:"pointer" }}>
          {showApproved ? "Showing ALL (tap for pending only)" : "Showing PENDING only (tap to show all)"}
        </button>
        <select value={filterJ} onChange={e => setFilterJ(e.target.value)} style={{ background:T.surface, border:`1px solid ${T.border}`, color:T.text, borderRadius:6, padding:"7px 10px", fontSize:12, fontFamily:T.mono }}>
          <option value="">All jobbers</option>
          {jobbers.filter(j=>j.role==="jobber").map(j => <option key={j.id} value={j.id}>{j.name && j.name.trim() ? j.name : `(no name — ${j.id})`}</option>)}
        </select>
        <select value={filterDesign} onChange={e => setFilterDesign(e.target.value)} style={{ background:T.surface, border:`1px solid ${T.border}`, color:T.text, borderRadius:6, padding:"7px 10px", fontSize:12, fontFamily:T.mono }}>
          <option value="">All designs</option>
          {designs.map(d => <option key={d.id} value={d.designNo}>{d.designNo}</option>)}
        </select>
      </div>

      {/* Multi-month picker */}
      {allMonths.length>0 && (
        <div style={{ display:"flex", gap:6, marginBottom:14, flexWrap:"wrap", alignItems:"center" }}>
          <span style={{ fontFamily:T.mono, fontSize:9, color:T.steelLt, textTransform:"uppercase" }}>Months:</span>
          <button onClick={() => setMonthSel([])} style={{ background:monthSel.length===0?T.gold:T.surface, color:monthSel.length===0?T.bg:T.steelLt, border:"none", borderRadius:14, padding:"4px 12px", fontFamily:T.mono, fontSize:10, fontWeight:700, cursor:"pointer" }}>All</button>
          {allMonths.map(m => {
            const on = monthSel.includes(m);
            const label = new Date(m+"-01").toLocaleDateString("en-IN",{month:"short",year:"2-digit"});
            return <button key={m} onClick={() => toggleMonth(m)} style={{ background:on?T.gold:T.surface, color:on?T.bg:T.steelLt, border:"none", borderRadius:14, padding:"4px 12px", fontFamily:T.mono, fontSize:10, fontWeight:700, cursor:"pointer" }}>{label}</button>;
          })}
          {monthSel.length>0 && <span style={{ fontFamily:T.mono, fontSize:9, color:T.gold }}>({monthSel.length} selected)</span>}
        </div>
      )}

      {list.length===0 && <div style={{ textAlign:"center", color:T.textDim, padding:40, fontFamily:T.mono, fontSize:12 }}>{showApproved ? "No challans match these filters." : "No pending challans. 🎉 Tap \"Showing PENDING only\" to see all."}</div>}

      <div style={{ overflowX:"auto" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11 }}>
          <thead>
            <tr style={{ background:T.surface }}>
              {["Date","Challan No","Jobber","Design","Process","Qty","Rate","Amount","Photo","Status",""].map(h => (
                <th key={h} style={{ padding:"8px 8px", fontFamily:T.mono, fontSize:9, color:T.steelLt, textAlign:"left", textTransform:"uppercase", borderBottom:`1px solid ${T.border}`, whiteSpace:"nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map((c,i) => {
              const designsList = challanDesigns(c);
              const lns = (c.lines && c.lines.length) ? c.lines : [{ designNo:c.designNo, process:c.process, qty:c.qty, rate:c.rate, amount:c.amount }];
              return (
              <tr key={c.id||i} style={{ background:i%2===0?T.card:T.surface, borderBottom:`1px solid ${T.border}`, borderLeft:`3px solid ${monthColor(c.date)}` }}>
                <td style={{ padding:"8px", color:T.steelLt, whiteSpace:"nowrap", verticalAlign:"top" }}>{c.date||"—"}</td>
                <td style={{ padding:"8px", color:T.gold, fontFamily:T.mono, verticalAlign:"top" }}>{c.challanNo||"—"}</td>
                <td style={{ padding:"8px", color:T.white, fontWeight:600, whiteSpace:"nowrap", verticalAlign:"top" }}>{jname(c.jobberId)}</td>
                <td colSpan={5} style={{ padding:"4px 8px" }}>
                  {lns.map((l,li) => (
                    <div key={li} style={{ display:"flex", gap:10, padding:"3px 0", borderBottom: li<lns.length-1?`1px solid ${T.border}`:"none", fontSize:11 }}>
                      <span style={{ color:T.gold, fontFamily:T.mono, fontWeight:700, minWidth:60 }}>{l.designNo}</span>
                      <span style={{ color:T.steelLt, minWidth:80 }}>{l.process||"—"}</span>
                      <span style={{ color:T.text, fontFamily:T.mono, minWidth:50 }}>{l.qty} pc</span>
                      <span style={{ color:T.gold, fontFamily:T.mono, minWidth:60 }}>Rs.{l.rate}</span>
                      <span style={{ color:T.white, fontFamily:T.mono, fontWeight:700 }}>Rs.{l.amount}</span>
                      {l.isSplit && <Badge label="split" color={T.steelLt} />}
                    </div>
                  ))}
                  {lns.length>1 && <div style={{ fontFamily:T.mono, fontSize:10, color:T.gold, marginTop:3 }}>Challan total: Rs.{challanTotal(c)} · {challanQty(c)} pcs</div>}
                </td>
                <td style={{ padding:"8px", verticalAlign:"top" }}>{c.photo ? <img src={c.photo} alt="" onClick={()=>window.open().document.write(`<img src="${c.photo}" style="max-width:100%">`)} style={{ width:28, height:28, borderRadius:4, objectFit:"cover", cursor:"pointer" }} draggable={false} onContextMenu={e=>e.preventDefault()} /> : <span style={{ color:T.textDim }}>—</span>}</td>
                <td style={{ padding:"8px", verticalAlign:"top" }}>
                  <Badge label={c.status} color={c.status==="approved"?T.green:c.status==="rejected"?T.red:T.orange} />
                  {(() => { const lb = [...new Set(billsForChallan(c, bills).map(b=>b.billNo).filter(Boolean))]; return lb.length ? <div style={{ fontFamily:T.mono, fontSize:9, color:T.green, marginTop:3 }}>Bill: {lb.join(", ")}</div> : (c.billed && <Badge label="billed" color={T.steelLt} />); })()}
                </td>
                <td style={{ padding:"8px", whiteSpace:"nowrap", verticalAlign:"top" }}>
                  {isAdmin && c.status==="pending" && <><Btn label="✓" onClick={()=>approve(c)} color={T.green} textColor="#fff" small /> <Btn label="✕" onClick={()=>reject(c)} color={T.red+"22"} textColor={T.red} small /></>}
                  {isAdmin && c.status!=="pending" && !c.billed && <Btn label="Del" onClick={()=>remove(c)} color={T.red+"22"} textColor={T.red} small />}
                </td>
              </tr>
            );})}
          </tbody>
        </table>
      </div>

      {showForm && <ChallanForm jobbers={jobbers} designs={designs} challans={challans} role={role} currentUser={currentUser} onClose={()=>setShowForm(false)} onSave={async (c) => {
        // create placeholders for any new design numbers
        for (const dn of (c.newDesignNos||[])) {
          if (!designs.some(d => String(d.designNo)===String(dn))) {
            const nd = makePlaceholderDesign({ ...c, designNo:dn }, currentUser);
            await dbUpsert("designs", dToRow(nd));
            setDesigns(p => [nd, ...p]);
            recordActivity(currentUser, "Created placeholder design (via challan)", `Design ${dn}`, "needs completion");
            recordNotification(currentUser, `New placeholder design ${dn} created via challan — complete its details`, nd.id);
          }
        }
        await dbUpsert("challans", challanToRow(c));
        setChallans(p => [c,...p]);
        // send-to-next: create a movement for each design in the challan
        if (c.sendToId) {
          const targetName = c.sendToId==="__office__" ? "Office / Admin" : ((jobbers.find(j=>j.id===c.sendToId)||{}).name||"");
          for (const dn of challanDesigns(c)) {
            const design = designs.find(d => String(d.designNo)===String(dn));
            if (design) {
              const lineQty = (c.lines||[]).filter(l=>String(l.designNo)===String(dn)).reduce((a,l)=>a+(+l.qty||0),0) || +c.qty;
              const mv = { id:`MV${Date.now()}_${dn}`, date:c.date||new Date().toISOString().slice(0,10), jobber:jname(c.jobberId), receivedFrom:jname(c.jobberId), sentTo:targetName, sentToId:c.sendToId==="__office__"?"":c.sendToId, qty:lineQty, remark:`Challan ${c.challanNo||""}`, status:"sent" };
              const updated = { ...design, movements:[...(design.movements||[]), mv] };
              setDesigns(p => p.map(x => x.id===updated.id?updated:x));
              await dbUpsert("movements", mvToRow(mv, design.id));
            }
          }
          recordNotification(currentUser, `Challan ${c.challanNo||""} sent to ${targetName}`, "");
        }
        recordActivity(currentUser, "Added challan", `Designs ${challanDesigns(c).join(", ")}`, `${jname(c.jobberId)} · ${challanQty(c)} pcs`);
        showToast(c.sendToId ? "Challan saved & sent ✓" : "Challan added ✓");
        setShowForm(false);
      }} />}
    </div>
  );
}

// Shirt-making instructions with auto-numbering + inline Hindi/Gujarati translation
function InstructionsBox({ value, onChange, L = (x)=>x }) {
  const [hi, setHi] = useState("");
  const [gu, setGu] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const points = (value||"").split(/\n|(?<=\.)\s+/).map(s=>s.trim()).filter(Boolean);
  const numbered = points.map((p,i)=>`${i+1}. ${p}`).join("\n");
  async function doTranslate(lang) {
    setErr(""); setBusy(lang);
    const res = await googleTranslate(numbered, lang);
    setBusy("");
    if (!res.ok) { setErr(res.error||"Translation failed"); return; }
    if (lang==="hi") setHi(res.text); else setGu(res.text);
  }
  return (
    <div>
      <div style={{ fontFamily:T.mono, fontSize:10, color:T.textDim, marginBottom:8 }}>Type instructions. Each new line or full-stop becomes a numbered point automatically. Text in brackets ( ) is kept as pronounced.</div>
      <textarea
        value={value||""}
        onChange={e => { onChange(e.target.value); setHi(""); setGu(""); }}
        placeholder={"e.g. Use single needle for collar. Attach pocket 2 inch from placket. Buttons must be YKK (pakka)."}
        rows={5}
        style={{ width:"100%", boxSizing:"border-box", background:T.surface, border:`1px solid ${T.border}`, borderRadius:8, color:T.text, fontFamily:T.sans, fontSize:14, padding:"10px 12px", lineHeight:1.6, outline:"none", resize:"vertical" }}
      />
      {(value||"").trim() && (
        <div style={{ background:T.bg, borderRadius:8, padding:14, marginTop:10, border:`1px solid ${T.border}` }}>
          <div style={{ fontFamily:T.mono, fontSize:9, color:T.gold, textTransform:"uppercase", marginBottom:8 }}>Preview — numbered points</div>
          <ol style={{ margin:0, paddingLeft:22, color:T.text, fontSize:14, lineHeight:1.9 }}>
            {points.map((p,i) => <li key={i} style={{ marginBottom:4 }}>{p}</li>)}
          </ol>
          <div style={{ display:"flex", gap:8, marginTop:12, flexWrap:"wrap" }}>
            <Btn label={busy==="hi"?"Translating…":"Show Hindi"} onClick={()=>doTranslate("hi")} disabled={!!busy} small color={T.surface} textColor={T.gold} style={{ border:`1px solid ${T.border}` }} />
            <Btn label={busy==="gu"?"Translating…":"Show Gujarati"} onClick={()=>doTranslate("gu")} disabled={!!busy} small color={T.surface} textColor={T.gold} style={{ border:`1px solid ${T.border}` }} />
            {(hi||gu) && <Btn label="Hide" onClick={()=>{setHi("");setGu("");}} small color={T.surface} textColor={T.steelLt} style={{ border:`1px solid ${T.border}` }} />}
          </div>
          {err && <div style={{ color:T.red, fontFamily:T.mono, fontSize:10, marginTop:8 }}>⚠ {err}</div>}
          {(hi||gu) && (
            <div style={{ display:"grid", gridTemplateColumns:`1fr${hi?" 1fr":""}${gu?" 1fr":""}`, gap:12, marginTop:12 }}>
              <div style={{ background:T.surface, borderRadius:8, padding:12 }}>
                <div style={{ fontFamily:T.mono, fontSize:9, color:T.steelLt, textTransform:"uppercase", marginBottom:6 }}>English</div>
                <div style={{ whiteSpace:"pre-line", fontSize:13, color:T.text, lineHeight:1.8 }}>{numbered}</div>
              </div>
              {hi && <div style={{ background:T.surface, borderRadius:8, padding:12 }}>
                <div style={{ fontFamily:T.mono, fontSize:9, color:T.gold, textTransform:"uppercase", marginBottom:6 }}>हिंदी (Hindi)</div>
                <div style={{ whiteSpace:"pre-line", fontSize:14, color:T.white, lineHeight:1.8 }}>{hi}</div>
              </div>}
              {gu && <div style={{ background:T.surface, borderRadius:8, padding:12 }}>
                <div style={{ fontFamily:T.mono, fontSize:9, color:T.gold, textTransform:"uppercase", marginBottom:6 }}>ગુજરાતી (Gujarati)</div>
                <div style={{ whiteSpace:"pre-line", fontSize:14, color:T.white, lineHeight:1.8 }}>{gu}</div>
              </div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ChallanForm({ jobbers, designs, challans = [], role, currentUser, onClose, onSave, fixedJobber }) {
  const isAdmin = role === "admin";
  const [head, setHead] = useState({ jobberId: fixedJobber||"", date:new Date().toISOString().slice(0,10), challanNo:"", photo:"", sendToId:"" });
  const [lines, setLines] = useState([{ id:`L${Date.now()}`, designNo:"", process:"", qty:"", rate:"", isSplit:false, newDesign:false }]);
  const updHead = k => v => setHead(f => ({ ...f, [k]:v }));
  const actingJobber = jobbers.find(j => j.id === (fixedJobber || head.jobberId));
  const mayCreateDesign = isAdmin || (actingJobber && actingJobber.canCreateDesign);
  const photoRef = useRef();
  function handlePhoto(e) { const file = e.target.files[0]; if (!file) return; compressImage(file).then(src => updHead("photo")(src)).catch(()=>{}); }

  function addLine() { setLines(l => [...l, { id:`L${Date.now()}`, designNo:"", process:"", qty:"", rate:"", isSplit:false, newDesign:false }]); }
  function removeLine(id) { setLines(l => l.length>1 ? l.filter(x=>x.id!==id) : l); }
  function updLine(id, k, v) { setLines(l => l.map(x => x.id===id ? { ...x, [k]:v } : x)); }

  // per-line computed info
  function lineInfo(ln) {
    const amount = (+ln.qty||0) * (+ln.rate||0);
    const designExists = designs.some(d => String(d.designNo) === String(ln.designNo).trim());
    const isNewDesign = ln.newDesign && ln.designNo.trim() && !designExists;
    const dup = (ln.designNo && ln.process)
      ? challans.find(c => challanDesigns(c).includes(String(ln.designNo).trim()) && (c.lines||[]).concat([{process:c.process}]).some(x=>x.process===ln.process) && c.status!=="rejected" && c.jobberId!==head.jobberId)
      : null;
    return { amount, isNewDesign, dup, dupBlocked: dup && !ln.isSplit };
  }
  const total = lines.reduce((a,ln)=>a+((+ln.qty||0)*(+ln.rate||0)),0);
  const anyBlocked = lines.some(ln => lineInfo(ln).dupBlocked);
  const validLines = lines.filter(ln => ln.designNo && ln.qty);
  const canSave = head.jobberId && validLines.length>0 && !anyBlocked;

  function save() {
    if (!canSave) return;
    const builtLines = validLines.map(ln => ({ designNo:String(ln.designNo).trim(), process:ln.process, qty:+ln.qty, rate:+ln.rate||0, amount:(+ln.qty||0)*(+ln.rate||0), isSplit:!!ln.isSplit }));
    const newDesignNos = validLines.filter(ln => lineInfo(ln).isNewDesign).map(ln => String(ln.designNo).trim());
    // first line's process/design kept at top-level for back-compat & simple displays
    const first = builtLines[0];
    onSave({
      id:`CH${Date.now()}`, jobberId:head.jobberId, date:head.date, challanNo:head.challanNo, photo:head.photo, sendToId:head.sendToId,
      lines:builtLines, designNo:first.designNo, process:first.process, qty:builtLines.reduce((a,l)=>a+l.qty,0), rate:first.rate, amount:builtLines.reduce((a,l)=>a+l.amount,0),
      isSplit: builtLines.some(l=>l.isSplit), status:"approved", billed:false, createdBy:currentUser, createdAtStr:nowStr(), newDesignNos
    });
  }

  return (
    <Modal title="New Challan (v3 — multi-design)" onClose={onClose}>
      {/* Header: jobber, date, challan no */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12, marginBottom:14 }}>
        {fixedJobber
          ? <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
              <label style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, textTransform:"uppercase" }}>Jobber</label>
              <div style={{ background:T.bg, border:`1px solid ${T.border}`, borderRadius:6, color:T.gold, fontFamily:T.sans, fontSize:13, padding:"8px 12px", fontWeight:600 }}>{(jobbers.find(j=>j.id===fixedJobber)||{}).name||""}</div>
            </div>
          : <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
              <label style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, textTransform:"uppercase" }}>Jobber *</label>
              <select value={head.jobberId} onChange={e => updHead("jobberId")(e.target.value)} style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:6, color:T.text, fontFamily:T.sans, fontSize:13, padding:"8px 12px", width:"100%", boxSizing:"border-box" }}>
                <option value="">— select jobber —</option>
                {jobbers.filter(j=>j.role==="jobber").map(j => <option key={j.id} value={j.id}>{j.name && j.name.trim() ? j.name : `(no name — ${j.id})`}</option>)}
              </select>
            </div>
        }
        <Inp label="Challan No" value={head.challanNo} onChange={updHead("challanNo")} />
        <Inp label="Date" type="date" value={head.date} onChange={updHead("date")} />
      </div>

      {/* Design lines */}
      <div style={{ fontFamily:T.mono, fontSize:10, color:T.gold, textTransform:"uppercase", marginBottom:8, letterSpacing:1 }}>Designs in this challan (add as many as needed)</div>
      {lines.map((ln,idx) => {
        const info = lineInfo(ln);
        const dupName = info.dup ? ((jobbers.find(j=>j.id===info.dup.jobberId)||{}).name||"another jobber") : "";
        return (
          <div key={ln.id} style={{ background:T.surface, borderRadius:8, padding:12, marginBottom:10, border:`1px solid ${info.dupBlocked?T.red:T.border}` }}>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"flex-end" }}>
              <div style={{ display:"flex", flexDirection:"column", gap:4, flex:"2 1 140px" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <label style={{ fontFamily:T.mono, fontSize:9, color:T.steelLt, textTransform:"uppercase" }}>Design No *</label>
                  {mayCreateDesign && <button onClick={() => { updLine(ln.id,"newDesign",!ln.newDesign); updLine(ln.id,"designNo",""); }} style={{ background:"none", border:"none", color:T.gold, fontFamily:T.mono, fontSize:8, cursor:"pointer", textTransform:"uppercase" }}>{ln.newDesign?"pick existing":"+ new"}</button>}
                </div>
                {ln.newDesign
                  ? <input value={ln.designNo} onChange={e => updLine(ln.id,"designNo",e.target.value)} placeholder="New design no" style={{ background:T.bg, border:`1px solid ${T.gold}`, borderRadius:6, color:T.text, fontFamily:T.sans, fontSize:13, padding:"7px 10px", width:"100%", boxSizing:"border-box" }} />
                  : <select value={ln.designNo} onChange={e => updLine(ln.id,"designNo",e.target.value)} style={{ background:T.bg, border:`1px solid ${T.border}`, borderRadius:6, color:T.text, fontFamily:T.sans, fontSize:13, padding:"7px 10px", width:"100%", boxSizing:"border-box" }}>
                      <option value="">— select —</option>
                      {designs.map(d => <option key={d.id} value={d.designNo}>{designLabel(d)}</option>)}
                    </select>
                }
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:4, flex:"1 1 100px" }}>
                <label style={{ fontFamily:T.mono, fontSize:9, color:T.steelLt, textTransform:"uppercase" }}>Process</label>
                <select value={ln.process} onChange={e => updLine(ln.id,"process",e.target.value)} style={{ background:T.bg, border:`1px solid ${T.border}`, borderRadius:6, color:T.text, fontFamily:T.sans, fontSize:13, padding:"7px 10px", width:"100%", boxSizing:"border-box" }}>
                  <option value="">—</option>
                  {PROCESSES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:4, width:70 }}>
                <label style={{ fontFamily:T.mono, fontSize:9, color:T.steelLt, textTransform:"uppercase" }}>Qty *</label>
                <input type="number" value={ln.qty} onChange={e => updLine(ln.id,"qty",e.target.value)} style={{ background:T.bg, border:`1px solid ${T.border}`, borderRadius:6, color:T.text, fontFamily:T.mono, fontSize:13, padding:"7px 8px", width:"100%", boxSizing:"border-box" }} />
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:4, width:80 }}>
                <label style={{ fontFamily:T.mono, fontSize:9, color:T.steelLt, textTransform:"uppercase" }}>Rate</label>
                <input type="number" value={ln.rate} onChange={e => updLine(ln.id,"rate",e.target.value)} style={{ background:T.bg, border:`1px solid ${T.border}`, borderRadius:6, color:T.text, fontFamily:T.mono, fontSize:13, padding:"7px 8px", width:"100%", boxSizing:"border-box" }} />
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:4, width:90 }}>
                <label style={{ fontFamily:T.mono, fontSize:9, color:T.steelLt, textTransform:"uppercase" }}>Amount</label>
                <div style={{ fontFamily:T.mono, fontSize:14, color:T.gold, fontWeight:700, padding:"7px 0" }}>Rs.{info.amount}</div>
              </div>
              {lines.length>1 && <Btn label="✕" onClick={() => removeLine(ln.id)} color={T.red+"22"} textColor={T.red} small />}
            </div>
            {info.isNewDesign && <div style={{ fontFamily:T.mono, fontSize:9, color:T.green, marginTop:6 }}>✓ New placeholder design "{ln.designNo}" will be created.</div>}
            {info.dup && (
              <div style={{ marginTop:8 }}>
                <div style={{ fontFamily:T.mono, fontSize:10, color:info.dupBlocked?T.red:T.green, fontWeight:700 }}>⚠ {dupName} already logged "{ln.process}" on design {ln.designNo}.</div>
                <label style={{ display:"flex", alignItems:"center", gap:6, cursor:"pointer", fontFamily:T.sans, fontSize:11, color:T.text, marginTop:4 }}>
                  <input type="checkbox" checked={!!ln.isSplit} onChange={e => updLine(ln.id,"isSplit",e.target.checked)} style={{ width:14, height:14, accentColor:T.gold }} />
                  Genuine SPLIT (one cuts, one stitches) — allow both.
                </label>
              </div>
            )}
          </div>
        );
      })}
      <Btn label="+ Add another design" onClick={addLine} small color={T.surface} textColor={T.gold} style={{ border:`1px solid ${T.border}`, marginBottom:14 }} />

      {/* Total */}
      <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:14 }}>
        <div style={{ background:T.bg, borderRadius:8, padding:"10px 18px", border:`1px solid ${T.gold}44` }}>
          <span style={{ fontFamily:T.mono, fontSize:11, color:T.steelLt }}>CHALLAN TOTAL: </span>
          <span style={{ fontFamily:T.mono, fontSize:18, color:T.gold, fontWeight:900 }}>Rs.{total}</span>
        </div>
      </div>

      <div style={{ display:"flex", gap:10, alignItems:"center", marginBottom:14 }}>
        <Btn label={head.photo?"Change Photo":"+ Challan Photo (optional)"} onClick={()=>photoRef.current.click()} color={T.surface} textColor={T.gold} small style={{ border:`1px solid ${T.border}` }} />
        {head.photo && <img src={head.photo} alt="" style={{ width:40, height:40, borderRadius:4, objectFit:"cover" }} />}
        <input ref={photoRef} type="file" accept="image/*" style={{ display:"none" }} onChange={handlePhoto} />
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:4, marginBottom:14 }}>
        <label style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, textTransform:"uppercase" }}>Send To Next (after this work)</label>
        <select value={head.sendToId} onChange={e => updHead("sendToId")(e.target.value)} style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:6, color:T.text, fontFamily:T.sans, fontSize:13, padding:"8px 12px", width:"100%", boxSizing:"border-box" }}>
          <option value="">— no one / finished —</option>
          <option value="__office__">🏢 Office / Admin</option>
          {jobbers.filter(j=>j.role==="jobber" && j.id!==head.jobberId).map(j => <option key={j.id} value={j.id}>{j.name && j.name.trim() ? j.name : `(no name — ${j.id})`}</option>)}
        </select>
      </div>
      {!isAdmin && <div style={{ fontFamily:T.mono, fontSize:10, color:T.orange, marginBottom:12 }}>This challan auto-posts to the cost sheet & your ledger now. Admin can reject it later if wrong.</div>}
      <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
        <Btn label="Cancel" onClick={onClose} color={T.surface} textColor={T.steelLt} />
        <Btn label="Save Challan" onClick={save} disabled={!canSave} />
      </div>
    </Modal>
  );
}

// ── Bills + Payments + Dual Ledger ────────────────────────────────────────────
function BillsLedger({ jobbers, designs, bills, setBills, payments, setPayments, challans, setChallans, creditNotes, setCreditNotes, showToast, currentUser }) {
  const [selJ, setSelJ] = useState("");
  const [ledgerView, setLedgerView] = useState("bank");
  const [yearFilter, setYearFilter] = useState(new Date().getFullYear());
  const [showBillForm, setShowBillForm] = useState(false);
  const [showCNForm, setShowCNForm] = useState(false);
  const [showPayForm, setShowPayForm] = useState(false);
  const jList = jobbers.filter(j => j.role==="jobber");
  const j = jobbers.find(x => x.id===selJ);

  function suggestForDesign(designNo) {
    const d = designs.find(x => x.designNo === designNo);
    if (!d) return { qty:"", rate:"" };
    const tp = (d.colors||[]).reduce((a,c) => a+Object.values(c.sizes||{}).reduce((x,v)=>x+(+v||0),0), 0);
    let rate = "";
    PROCESSES.forEach(p => { const pr=d.processes?.[p]; if (pr && pr.jobber===selJ && pr.rate) rate = pr.rate; });
    return { qty: tp||"", rate };
  }

  const allMyBills = bills.filter(b => b.jobberId===selJ);
  const allMyPays = payments.filter(p => p.jobberId===selJ);
  const years = Array.from(new Set([...allMyBills.map(b=>yearOf(b.billDate)), ...allMyPays.map(p=>yearOf(p.date)), new Date().getFullYear()].filter(Boolean))).sort((a,b)=>b-a);
  const myBills = allMyBills.filter(b => yearOf(b.billDate)===yearFilter);
  const myPays = allMyPays.filter(p => yearOf(p.date)===yearFilter);

  const bankBills = myBills.filter(b => b.hasGst);
  const cashBills = myBills.filter(b => !b.hasGst);
  const bankPays = myPays.filter(p => p.channel==="bank");
  const cashPays = myPays.filter(p => p.channel==="cash");

  const bankBilled = bankBills.reduce((a,b)=>a+(+b.total||0),0);
  const cashBilled = cashBills.reduce((a,b)=>a+(+b.total||0),0);
  const bankPaid = bankPays.reduce((a,p)=>a+(+p.amount||0),0);
  const cashPaid = cashPays.reduce((a,p)=>a+(+p.amount||0),0);

  // ── AUTO LEDGER: built directly from challans (debit) + payments (credit) ──
  const myChallans = (challans||[]).filter(c => c.jobberId===selJ && c.status!=="rejected" && yearOf(c.date)===yearFilter);
  const myCNs = (creditNotes||[]).filter(c => c.partyType==="jobber" && c.party===selJ && yearOf(c.cnDate)===yearFilter);
  const acctRows = [
    ...myChallans.map(c => ({ date:c.date||"", kind:"debit", particulars:`Designs ${challanDesigns(c).join(", ")}`, ref:c.challanNo||"", debit:challanTotal(c), credit:0 })),
    ...myPays.map(p => ({ date:p.date||"", kind:"credit", particulars:`Payment (${p.mode||p.channel})`, ref:p.note||"", debit:0, credit:+p.amount||0 })),
    ...myCNs.map(c => ({ date:c.cnDate||"", kind:"credit", particulars:`Credit Note — ${c.reason||"claim"} (Designs ${cnDesignNos(c).join(", ")})`, ref:c.cnNo||"", debit:0, credit:+c.total||0 })),
  ].sort((a,b) => (a.date||"").localeCompare(b.date||""));
  let runBal = 0;
  const acctWithBal = acctRows.map(r => { runBal += r.debit - r.credit; return { ...r, balance:runBal }; });
  const acctDebit = acctRows.reduce((a,r)=>a+r.debit,0);
  const acctCredit = acctRows.reduce((a,r)=>a+r.credit,0);

  async function deleteBill(id) { await dbDelete("bills", id); setBills(p=>p.filter(b=>b.id!==id)); recordActivity(currentUser, "Deleted bill", `Jobber ${j?.name||""}`, ""); showToast("Bill deleted"); }
  async function deletePay(id) { await dbDelete("payments", id); setPayments(p=>p.filter(x=>x.id!==id)); recordActivity(currentUser, "Deleted payment", `Jobber ${j?.name||""}`, ""); showToast("Payment deleted"); }

  function exportAccountPDF() {
    const w = window.open("", "_blank");
    if (!w) { showToast("Allow popups to export PDF","error"); return; }
    const rows = acctWithBal.map(r => `<tr><td>${r.date||""}</td><td>${r.particulars}</td><td>${r.ref||""}</td><td style="text-align:right">${r.debit?r.debit.toFixed(2):""}</td><td style="text-align:right;color:#0a0">${r.credit?r.credit.toFixed(2):""}</td><td style="text-align:right;font-weight:bold">${r.balance.toFixed(2)}</td></tr>`).join("");
    w.document.write(`
      <html><head><title>Account - ${j?.name||""}</title>
      <style>body{font-family:Arial;padding:24px;color:#111}h1{font-size:20px;margin:0}h2{font-size:13px;color:#555;margin:4px 0 16px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}th{background:#f0f0f0}</style>
      </head><body>
      <h1>AASHISH APPARELS</h1>
      <h2>Account Statement (from challans) &middot; Jobber: ${j?.name||""} ${j?.gst?("&middot; GST: "+j.gst):""} &middot; Year: ${yearFilter} &middot; Printed: ${new Date().toLocaleDateString()}</h2>
      <table><thead><tr><th>Date</th><th>Particulars</th><th>Challan/Ref</th><th style="text-align:right">Debit</th><th style="text-align:right">Credit</th><th style="text-align:right">Balance</th></tr></thead>
      <tbody>${rows||'<tr><td colspan=6>No entries</td></tr>'}</tbody>
      <tfoot><tr style="font-weight:bold;background:#f8f8f8"><td colspan=3>TOTAL</td><td style="text-align:right">${acctDebit.toFixed(2)}</td><td style="text-align:right">${acctCredit.toFixed(2)}</td><td style="text-align:right">${(acctDebit-acctCredit).toFixed(2)}</td></tr></tfoot>
      </table>
      </body></html>`);
    w.document.close();
    setTimeout(() => w.print(), 300);
  }

  function exportPDF() {
    const which = ledgerView;
    if (which==="account") { exportAccountPDF(); return; }
    const header = which==="cash" ? "AA" : "AASHISH APPARELS";
    const title = which==="bank" ? "Bank Ledger (GST Bills)" : which==="cash" ? "Cash Ledger" : "Combined Ledger";
    const billsList = which==="bank" ? bankBills : which==="cash" ? cashBills : myBills;
    const paysList = which==="bank" ? bankPays : which==="cash" ? cashPays : myPays;
    const billed = which==="bank" ? bankBilled : which==="cash" ? cashBilled : bankBilled+cashBilled;
    const paid = which==="bank" ? bankPaid : which==="cash" ? cashPaid : bankPaid+cashPaid;
    const bal = billed - paid;
    const w = window.open("", "_blank");
    if (!w) { showToast("Allow popups to export PDF","error"); return; }
    const billRows = billsList.map(b => `<tr><td>${b.billDate||""}</td><td>${b.billNo||""}</td><td>${(b.lines||[]).map(l=>l.designNo).join(", ")}</td><td style="text-align:right">${(+b.total||0).toFixed(2)}</td></tr>`).join("");
    const payRows = paysList.map(p => `<tr><td>${p.date||""}</td><td>${p.mode||""}</td><td>${p.note||""}</td><td style="text-align:right">${(+p.amount||0).toFixed(2)}</td></tr>`).join("");
    w.document.write(`
      <html><head><title>${header} - ${j?.name||""}</title>
      <style>body{font-family:Arial;padding:24px;color:#111}h1{font-size:20px;margin:0}h2{font-size:13px;color:#555;margin:4px 0 16px}table{width:100%;border-collapse:collapse;margin-bottom:18px;font-size:12px}th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}th{background:#f0f0f0}.tot{font-weight:bold;font-size:14px}</style>
      </head><body>
      <h1>${header}</h1>
      <h2>${title} &middot; Jobber: ${j?.name||""} ${j?.gst?("&middot; GST: "+j.gst):""} &middot; Printed: ${new Date().toLocaleDateString()}</h2>
      <h3>Bills</h3>
      <table><thead><tr><th>Date</th><th>Bill No</th><th>Designs</th><th style="text-align:right">Amount</th></tr></thead><tbody>${billRows||'<tr><td colspan=4>No bills</td></tr>'}</tbody></table>
      <h3>Payments</h3>
      <table><thead><tr><th>Date</th><th>Mode</th><th>Note</th><th style="text-align:right">Amount</th></tr></thead><tbody>${payRows||'<tr><td colspan=4>No payments</td></tr>'}</tbody></table>
      <p class="tot">Total Billed: Rs.${billed.toFixed(2)} &nbsp;|&nbsp; Total Paid: Rs.${paid.toFixed(2)} &nbsp;|&nbsp; Balance Due: Rs.${bal.toFixed(2)}</p>
      <script>window.onload=()=>window.print()</script>
      </body></html>`);
    w.document.close();
  }

  return (
    <div>
      <div style={{ maxWidth:320, marginBottom:20 }}>
        <div style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, marginBottom:4, textTransform:"uppercase" }}>Select Jobber</div>
        <select value={selJ} onChange={e => setSelJ(e.target.value)} style={{ background:T.surface, border:`1px solid ${T.border}`, color:T.text, borderRadius:6, padding:"8px 12px", fontSize:13, width:"100%" }}>
          <option value="">— select —</option>
          {jList.map(jb => <option key={jb.id} value={jb.id}>{jb.name}</option>)}
        </select>
      </div>

      {j && (
        <>
          <div style={{ display:"flex", gap:10, marginBottom:16, flexWrap:"wrap" }}>
            <Btn label="+ New Bill" onClick={() => setShowBillForm(true)} />
            <Btn label="+ Record Payment" onClick={() => setShowPayForm(true)} color={T.green} textColor="#fff" />
            <Btn label="+ Credit Note" onClick={() => setShowCNForm(true)} color={T.red} textColor="#fff" />
            <Btn label="Export PDF" onClick={exportPDF} color={T.surface} textColor={T.gold} style={{ border:`1px solid ${T.gold}44` }} />
          </div>

          <div style={{ display:"flex", gap:8, marginBottom:16, flexWrap:"wrap", alignItems:"center" }}>
            {[["account","Account (auto)"],["bank","Bank (GST)"],["combined","Combined"],["cash","Cash"]].map(([v,lbl]) => (
              <button key={v} onClick={() => setLedgerView(v)} style={{ background:ledgerView===v?T.gold:T.surface, color:ledgerView===v?T.bg:T.steelLt, border:"none", borderRadius:20, padding:"6px 18px", fontFamily:T.mono, fontSize:11, fontWeight:700, cursor:"pointer" }}>{lbl}</button>
            ))}
            <select value={yearFilter} onChange={e => setYearFilter(+e.target.value)} style={{ marginLeft:"auto", background:T.surface, border:`1px solid ${T.border}`, color:T.gold, borderRadius:20, padding:"6px 14px", fontSize:11, fontFamily:T.mono, fontWeight:700 }}>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>

          <div style={{ display:"flex", gap:14, marginBottom:18, flexWrap:"wrap" }}>
            {(ledgerView==="bank" || ledgerView==="combined") && (
              <div style={{ background:T.surface, borderRadius:8, padding:"14px 18px", borderLeft:`3px solid ${T.gold}`, minWidth:180 }}>
                <div style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt }}>BANK (GST) — AASHISH APPARELS</div>
                <div style={{ fontFamily:T.mono, fontSize:12, color:T.text, marginTop:4 }}>Billed Rs.{bankBilled.toFixed(2)} · Paid <span style={{color:T.green}}>Rs.{bankPaid.toFixed(2)}</span></div>
                <div style={{ fontFamily:T.mono, fontSize:18, fontWeight:900, color:(bankBilled-bankPaid)>0?T.red:T.green, marginTop:2 }}>Bal Rs.{(bankBilled-bankPaid).toFixed(2)}</div>
              </div>
            )}
            {(ledgerView==="cash" || ledgerView==="combined") && (
              <div style={{ background:T.surface, borderRadius:8, padding:"14px 18px", borderLeft:`3px solid ${T.steelLt}`, minWidth:180 }}>
                <div style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt }}>CASH — AA</div>
                <div style={{ fontFamily:T.mono, fontSize:12, color:T.text, marginTop:4 }}>Billed Rs.{cashBilled.toFixed(2)} · Paid <span style={{color:T.green}}>Rs.{cashPaid.toFixed(2)}</span></div>
                <div style={{ fontFamily:T.mono, fontSize:18, fontWeight:900, color:(cashBilled-cashPaid)>0?T.red:T.green, marginTop:2 }}>Bal Rs.{(cashBilled-cashPaid).toFixed(2)}</div>
              </div>
            )}
          </div>

          {ledgerView==="account" && (
            <>
              <div style={{ display:"flex", gap:14, marginBottom:16, flexWrap:"wrap" }}>
                <div style={{ background:T.surface, borderRadius:8, padding:"14px 18px", borderLeft:`3px solid ${T.gold}`, minWidth:160 }}>
                  <div style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt }}>TOTAL WORK (DEBIT)</div>
                  <div style={{ fontFamily:T.mono, fontSize:18, fontWeight:900, color:T.white, marginTop:2 }}>Rs.{acctDebit.toFixed(2)}</div>
                </div>
                <div style={{ background:T.surface, borderRadius:8, padding:"14px 18px", borderLeft:`3px solid ${T.green}`, minWidth:160 }}>
                  <div style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt }}>TOTAL PAID (CREDIT)</div>
                  <div style={{ fontFamily:T.mono, fontSize:18, fontWeight:900, color:T.green, marginTop:2 }}>Rs.{acctCredit.toFixed(2)}</div>
                </div>
                <div style={{ background:T.surface, borderRadius:8, padding:"14px 18px", borderLeft:`3px solid ${(acctDebit-acctCredit)>0?T.red:T.green}`, minWidth:160 }}>
                  <div style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt }}>BALANCE DUE</div>
                  <div style={{ fontFamily:T.mono, fontSize:18, fontWeight:900, color:(acctDebit-acctCredit)>0?T.red:T.green, marginTop:2 }}>Rs.{(acctDebit-acctCredit).toFixed(2)}</div>
                </div>
              </div>
              <div style={{ fontFamily:T.mono, fontSize:10, color:T.gold, textTransform:"uppercase", marginBottom:8, letterSpacing:1 }}>Account Statement (auto from challans &amp; payments)</div>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11, marginBottom:20 }}>
                <thead><tr style={{ background:T.surface }}>{["Date","Particulars","Challan/Ref","Debit","Credit","Balance"].map(h => <th key={h} style={{ padding:"8px 10px", fontFamily:T.mono, fontSize:9, color:T.steelLt, textAlign:"left", textTransform:"uppercase", border:`1px solid ${T.border}` }}>{h}</th>)}</tr></thead>
                <tbody>
                  {acctWithBal.length===0 && <tr><td colSpan={6} style={{ padding:16, textAlign:"center", color:T.textDim, fontFamily:T.mono, border:`1px solid ${T.border}` }}>No challans or payments yet for {yearFilter}.</td></tr>}
                  {acctWithBal.map((r,i) => (
                    <tr key={i} style={{ background:i%2===0?T.card:T.surface }}>
                      <td style={{ padding:"8px 10px", color:T.steelLt, fontFamily:T.mono, border:`1px solid ${T.border}` }}>{r.date}</td>
                      <td style={{ padding:"8px 10px", color:T.white, border:`1px solid ${T.border}` }}>{r.particulars}</td>
                      <td style={{ padding:"8px 10px", color:T.gold, fontFamily:T.mono, border:`1px solid ${T.border}` }}>{r.ref||"—"}</td>
                      <td style={{ padding:"8px 10px", color:T.white, fontFamily:T.mono, border:`1px solid ${T.border}` }}>{r.debit?`Rs.${r.debit.toFixed(2)}`:""}</td>
                      <td style={{ padding:"8px 10px", color:T.green, fontFamily:T.mono, border:`1px solid ${T.border}` }}>{r.credit?`Rs.${r.credit.toFixed(2)}`:""}</td>
                      <td style={{ padding:"8px 10px", color:r.balance>0?T.red:T.green, fontFamily:T.mono, fontWeight:700, border:`1px solid ${T.border}` }}>Rs.{r.balance.toFixed(2)}</td>
                    </tr>
                  ))}
                  {acctWithBal.length>0 && (
                    <tr style={{ background:T.bg }}>
                      <td colSpan={3} style={{ padding:"10px", fontFamily:T.mono, fontWeight:700, color:T.gold, border:`1px solid ${T.border}` }}>TOTAL</td>
                      <td style={{ padding:"10px", fontFamily:T.mono, fontWeight:900, color:T.white, border:`1px solid ${T.border}` }}>Rs.{acctDebit.toFixed(2)}</td>
                      <td style={{ padding:"10px", fontFamily:T.mono, fontWeight:900, color:T.green, border:`1px solid ${T.border}` }}>Rs.{acctCredit.toFixed(2)}</td>
                      <td style={{ padding:"10px", fontFamily:T.mono, fontWeight:900, color:(acctDebit-acctCredit)>0?T.red:T.green, border:`1px solid ${T.border}` }}>Rs.{(acctDebit-acctCredit).toFixed(2)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </>
          )}

          {ledgerView!=="account" && <><div style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, textTransform:"uppercase", marginBottom:8 }}>Bills</div>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11, marginBottom:20 }}>
            <thead><tr style={{ background:T.surface }}>{["Date","Bill No","Designs","Linked Challans","Type","Total",""].map(h => <th key={h} style={{ padding:"8px 10px", fontFamily:T.mono, fontSize:9, color:T.steelLt, textAlign:"left", textTransform:"uppercase", borderBottom:`1px solid ${T.border}` }}>{h}</th>)}</tr></thead>
            <tbody>
              {(ledgerView==="bank"?bankBills:ledgerView==="cash"?cashBills:myBills).map((b,i) => {
                const linkedCh = challansForBill(b, challans);
                const linkedNos = [...new Set(linkedCh.map(c=>c.challanNo).filter(Boolean))];
                return (
                <tr key={b.id||i} style={{ background:i%2===0?T.card:T.surface, borderBottom:`1px solid ${T.border}`, borderLeft:`4px solid ${monthColor(b.billDate)}` }}>
                  <td style={{ padding:"8px 10px", color:T.steelLt }}>{b.billDate}</td>
                  <td style={{ padding:"8px 10px", color:T.gold, fontFamily:T.mono }}>{b.billNo}</td>
                  <td style={{ padding:"8px 10px", color:T.text, fontFamily:T.mono }}>{(b.lines||[]).map(l=>l.designNo).join(", ")}</td>
                  <td style={{ padding:"8px 10px", color:linkedNos.length?T.green:T.textDim, fontFamily:T.mono, fontSize:10 }}>{linkedNos.length?linkedNos.join(", "):"none"}</td>
                  <td style={{ padding:"8px 10px" }}><Badge label={b.hasGst?"GST/Bank":"Cash"} color={b.hasGst?T.gold:T.steelLt} /></td>
                  <td style={{ padding:"8px 10px", color:T.white, fontFamily:T.mono, fontWeight:700 }}>Rs.{(+b.total||0).toFixed(2)}</td>
                  <td style={{ padding:"8px 10px" }}><Btn label="✕" onClick={() => deleteBill(b.id)} color={T.red+"22"} textColor={T.red} small /></td>
                </tr>
              );})}
            </tbody>
          </table>

          <div style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, textTransform:"uppercase", marginBottom:8 }}>Payments</div>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11 }}>
            <thead><tr style={{ background:T.surface }}>{["Date","Mode","Channel","Note","Amount",""].map(h => <th key={h} style={{ padding:"8px 10px", fontFamily:T.mono, fontSize:9, color:T.steelLt, textAlign:"left", textTransform:"uppercase", borderBottom:`1px solid ${T.border}` }}>{h}</th>)}</tr></thead>
            <tbody>
              {(ledgerView==="bank"?bankPays:ledgerView==="cash"?cashPays:myPays).map((p,i) => (
                <tr key={p.id||i} style={{ background:i%2===0?T.card:T.surface, borderBottom:`1px solid ${T.border}`, borderLeft:`4px solid ${monthColor(p.date)}` }}>
                  <td style={{ padding:"8px 10px", color:T.steelLt }}>{p.date}</td>
                  <td style={{ padding:"8px 10px", color:T.text }}>{p.mode}</td>
                  <td style={{ padding:"8px 10px" }}><Badge label={p.channel==="bank"?"Bank":"Cash"} color={p.channel==="bank"?T.gold:T.steelLt} /></td>
                  <td style={{ padding:"8px 10px", color:T.textDim }}>{p.note}</td>
                  <td style={{ padding:"8px 10px", color:T.green, fontFamily:T.mono, fontWeight:700 }}>Rs.{(+p.amount||0).toFixed(2)}</td>
                  <td style={{ padding:"8px 10px" }}><Btn label="✕" onClick={() => deletePay(p.id)} color={T.red+"22"} textColor={T.red} small /></td>
                </tr>
              ))}
            </tbody>
          </table>
          </>}

          {showBillForm && <BillForm jobber={j} designs={designs} selJ={selJ} suggestForDesign={suggestForDesign} challans={(challans||[]).filter(c => c.jobberId===selJ && c.status==="approved" && !c.billed)} onClose={() => setShowBillForm(false)} onSave={async (bill, usedChallanIds) => {
        await dbUpsert("bills", billToRow(bill));
        setBills(p => [bill,...p]);
        if (usedChallanIds && usedChallanIds.length) {
          const upd = (challans||[]).filter(c => usedChallanIds.includes(c.id)).map(c => ({ ...c, billed:true, billId:bill.id }));
          for (const c of upd) { await dbUpsert("challans", challanToRow(c)); }
          setChallans(p => p.map(c => usedChallanIds.includes(c.id) ? { ...c, billed:true, billId:bill.id } : c));
        }
        recordActivity(currentUser, "Added bill", `Jobber ${j?.name||""}`, `Bill ${bill.billNo} Rs.${bill.total}`);
        showToast("Bill saved ✓"); setShowBillForm(false);
      }} currentUser={currentUser} />}
          {showPayForm && <PaymentForm jobber={j} selJ={selJ} onClose={() => setShowPayForm(false)} onSave={async (pay) => { await dbUpsert("payments", payToRow(pay)); setPayments(p => [pay,...p]); recordActivity(currentUser, "Recorded payment", `Jobber ${j?.name||""}`, `Rs.${pay.amount} (${pay.channel})`); showToast("Payment recorded ✓"); setShowPayForm(false); }} currentUser={currentUser} />}
          {showCNForm && <CreditNoteForm partyType="jobber" partyLabel={j?.name||""} designs={designs} currentUser={currentUser} onClose={()=>setShowCNForm(false)} onSave={async (cn) => {
            const full = { ...cn, id:`CN${Date.now()}`, partyType:"jobber", party:selJ, createdAtStr:nowStr() };
            await dbUpsert("credit_notes", cnToRow(full));
            setCreditNotes(p => [full, ...p]);
            recordActivity(currentUser, "Credit note (jobber)", j?.name||"", `CN ${cn.cnNo} Rs.${cn.total} — ${cn.reason}`);
            showToast("Credit note saved ✓"); setShowCNForm(false);
          }} />}
        </>
      )}
    </div>
  );
}

// ── Bill Form ─────────────────────────────────────────────────────────────────
function CreditNoteForm({ partyType, partyLabel, designs, onClose, onSave, currentUser }) {
  const [cnNo, setCnNo] = useState("");
  const [cnDate, setCnDate] = useState(new Date().toISOString().slice(0,10));
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState([{ id:`L${Date.now()}`, designNo:"", qty:"", rate:"", amount:"" }]);
  const REASONS = ["Damage claim","Rate difference","Short supply","Quality issue","Goods returned","Other"];
  function addLine() { setLines(l => [...l, { id:`L${Date.now()}`, designNo:"", qty:"", rate:"", amount:"" }]); }
  function removeLine(id) { setLines(l => l.length>1 ? l.filter(x=>x.id!==id) : l); }
  function updLine(id,k,v) { setLines(l => l.map(x => { if(x.id!==id) return x; const nx={...x,[k]:v}; const q=+nx.qty||0,r=+nx.rate||0; if(k==="qty"||k==="rate") nx.amount=(q*r)?String(q*r):nx.amount; return nx; })); }
  const total = lines.reduce((a,l)=>a+(+l.amount||0),0);
  const valid = lines.filter(l => l.designNo && l.amount);
  function save() {
    if (!cnNo || valid.length===0) return;
    onSave({ cnNo, cnDate, reason, lines: valid.map(l=>({ designNo:String(l.designNo).trim(), qty:+l.qty||0, rate:+l.rate||0, amount:+l.amount||0 })), total, createdBy:currentUser });
  }
  return (
    <Modal title={`New Credit Note — ${partyLabel}`} onClose={onClose}>
      <div style={{ background:T.red+"15", border:`1px solid ${T.red}55`, borderRadius:8, padding:10, marginBottom:14, fontFamily:T.mono, fontSize:11, color:T.red }}>A credit note REDUCES what you owe {partyLabel} (claim/deduction). It shows on the credit side of their ledger.</div>
      <div style={{ display:"flex", gap:12, marginBottom:14, flexWrap:"wrap" }}>
        <Inp label="Credit Note No *" value={cnNo} onChange={setCnNo} style={{ minWidth:140 }} />
        <Inp label="Date" type="date" value={cnDate} onChange={setCnDate} style={{ minWidth:150 }} />
        <Inp label="Reason *" value={reason} onChange={setReason} options={REASONS} style={{ minWidth:160 }} />
      </div>
      <div style={{ fontFamily:T.mono, fontSize:10, color:T.gold, textTransform:"uppercase", marginBottom:8 }}>Designs / amounts in this credit note</div>
      {lines.map(l => (
        <div key={l.id} style={{ display:"flex", gap:8, marginBottom:8, alignItems:"flex-end", flexWrap:"wrap" }}>
          <Inp label="Design No" value={l.designNo} onChange={v=>updLine(l.id,"designNo",v)} options={designs.map(d=>d.designNo)} style={{ flex:2, minWidth:110 }} />
          <Inp label="Qty" type="number" value={l.qty} onChange={v=>updLine(l.id,"qty",v)} style={{ width:70 }} />
          <Inp label="Rate" type="number" value={l.rate} onChange={v=>updLine(l.id,"rate",v)} style={{ width:80 }} />
          <Inp label="Amount" type="number" value={l.amount} onChange={v=>updLine(l.id,"amount",v)} style={{ width:90 }} />
          {lines.length>1 && <Btn label="✕" onClick={()=>removeLine(l.id)} color={T.red+"22"} textColor={T.red} small />}
        </div>
      ))}
      <Btn label="+ Add line" onClick={addLine} small color={T.surface} textColor={T.gold} style={{ border:`1px solid ${T.border}`, marginBottom:14 }} />
      <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:16 }}>
        <div style={{ background:T.bg, borderRadius:8, padding:"10px 18px", border:`1px solid ${T.red}55` }}>
          <span style={{ fontFamily:T.mono, fontSize:11, color:T.steelLt }}>CREDIT NOTE TOTAL: </span>
          <span style={{ fontFamily:T.mono, fontSize:18, color:T.red, fontWeight:900 }}>Rs.{total}</span>
        </div>
      </div>
      <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
        <Btn label="Cancel" onClick={onClose} color={T.surface} textColor={T.steelLt} />
        <Btn label="Save Credit Note" onClick={save} disabled={!cnNo||valid.length===0||!reason} color={T.red} textColor="#fff" />
      </div>
    </Modal>
  );
}

function BillForm({ jobber, designs, selJ, suggestForDesign, challans = [], onClose, onSave, currentUser }) {
  const [billNo, setBillNo] = useState("");
  const [billDate, setBillDate] = useState(new Date().toISOString().slice(0,10));
  const [lines, setLines] = useState([{ id:`L${Date.now()}`, designNo:"", qty:"", rate:"", amount:"" }]);
  const [selChallans, setSelChallans] = useState([]);
  function toggleChallan(id) { setSelChallans(p => p.includes(id) ? p.filter(x=>x!==id) : [...p, id]); }
  function selectAllChallans() { setSelChallans(challans.map(c=>c.id)); }
  function clearChallans() { setSelChallans([]); }
  const challanLines = challans.filter(c => selChallans.includes(c.id)).map(c => ({ id:c.id, designNo:c.designNo, qty:c.qty, rate:c.rate, amount:c.amount, fromChallan:true }));
  const [gstPct, setGstPct] = useState("5");
  const [hasGst, setHasGst] = useState(true);
  const [roundOff, setRoundOff] = useState(true);

  function addLine() { setLines(l => [...l, { id:`L${Date.now()}`, designNo:"", qty:"", rate:"", amount:"" }]); }
  function removeLine(id) { setLines(l => l.filter(x => x.id!==id)); }
  function updLine(id, k, v) {
    setLines(l => l.map(x => {
      if (x.id !== id) return x;
      const nx = { ...x, [k]:v };
      if (k==="designNo") { const s = suggestForDesign(v); nx.qty = nx.qty||s.qty; nx.rate = nx.rate||s.rate; }
      const q = +nx.qty||0, r = +nx.rate||0;
      if (k==="qty"||k==="rate"||k==="designNo") nx.amount = (q*r) ? String(q*r) : nx.amount;
      return nx;
    }));
  }
  const gross = [...challanLines, ...lines].reduce((a,l) => a+(+l.amount||0), 0);
  const gstAmt = hasGst ? gross * (+gstPct||0) / 100 : 0;
  let total = gross + gstAmt;
  let roundDiff = 0;
  if (roundOff) { const r = Math.round(total); roundDiff = r - total; total = r; }

  function save() {
    if (!billNo) return;
    const allLines = [...challanLines, ...lines.filter(l => l.designNo || l.amount)];
    onSave({ id:`BILL${Date.now()}`, jobberId:selJ, billNo, billDate, lines:allLines, gross, gstPct:+gstPct, gstAmt, roundOff:roundDiff, total, hasGst, createdBy:currentUser, createdAtStr:nowStr() }, selChallans);
  }

  return (
    <Modal title={`New Bill — ${jobber.name}`} onClose={onClose}>
      <div style={{ display:"flex", gap:12, marginBottom:14, flexWrap:"wrap" }}>
        <Inp label="Bill No *" value={billNo} onChange={setBillNo} style={{ minWidth:120 }} />
        <Inp label="Bill Date" type="date" value={billDate} onChange={setBillDate} style={{ minWidth:150 }} />
      </div>
      {challans.length > 0 && (
        <div style={{ background:T.surface, borderRadius:8, padding:12, marginBottom:14 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
            <span style={{ fontFamily:T.mono, fontSize:10, color:T.gold, textTransform:"uppercase" }}>Pull from approved challans ({challans.length})</span>
            <div style={{ display:"flex", gap:6 }}>
              <Btn label="Select all" onClick={selectAllChallans} small color={T.surface} textColor={T.gold} style={{ border:`1px solid ${T.border}` }} />
              <Btn label="Clear" onClick={clearChallans} small color={T.surface} textColor={T.steelLt} style={{ border:`1px solid ${T.border}` }} />
            </div>
          </div>
          <div style={{ maxHeight:160, overflow:"auto" }}>
            {challans.map(c => (
              <label key={c.id} style={{ display:"flex", alignItems:"center", gap:8, padding:"5px 0", cursor:"pointer", fontSize:12, color:T.text }}>
                <input type="checkbox" checked={selChallans.includes(c.id)} onChange={()=>toggleChallan(c.id)} style={{ accentColor:T.gold, width:14, height:14 }} />
                <span style={{ fontFamily:T.mono, color:T.steelLt }}>{c.date}</span>
                <span style={{ color:T.gold, fontFamily:T.mono }}>D{c.designNo}</span>
                <span>{c.process}</span>
                <span style={{ fontFamily:T.mono, marginLeft:"auto" }}>{c.qty} × Rs.{c.rate} = <b style={{color:T.white}}>Rs.{c.amount}</b></span>
              </label>
            ))}
          </div>
        </div>
      )}
      <div style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, marginBottom:8, textTransform:"uppercase" }}>Designs in this bill (manual entry — for handwritten challans)</div>
      {lines.map(l => (
        <div key={l.id} style={{ display:"flex", gap:8, marginBottom:8, alignItems:"flex-end", flexWrap:"wrap" }}>
          <Inp label="Design No" value={l.designNo} onChange={v => updLine(l.id,"designNo",v)} options={designs.map(d=>d.designNo)} style={{ flex:2, minWidth:110 }} />
          <Inp label="Qty" type="number" value={l.qty} onChange={v => updLine(l.id,"qty",v)} style={{ width:70 }} />
          <Inp label="Rate/pc" type="number" value={l.rate} onChange={v => updLine(l.id,"rate",v)} style={{ width:80 }} />
          <Inp label="Amount" type="number" value={l.amount} onChange={v => updLine(l.id,"amount",v)} style={{ width:90 }} />
          <Btn label="✕" onClick={() => removeLine(l.id)} color={T.red+"22"} textColor={T.red} small />
        </div>
      ))}
      <Btn label="+ Add Design Line" onClick={addLine} small color={T.surface} textColor={T.gold} style={{ border:`1px solid ${T.border}`, marginBottom:14 }} />

      <div style={{ background:T.surface, borderRadius:8, padding:14, marginBottom:16 }}>
        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}><span style={{ color:T.steelLt, fontSize:12 }}>Gross</span><span style={{ color:T.white, fontFamily:T.mono, fontWeight:700 }}>Rs.{gross.toFixed(2)}</span></div>
        <label style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8, cursor:"pointer", color:T.text, fontSize:12 }}>
          <input type="checkbox" checked={hasGst} onChange={() => setHasGst(v=>!v)} style={{ accentColor:T.gold, width:14, height:14 }} />
          GST bill (paid via Bank). Untick = Cash bill.
        </label>
        {hasGst && (
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
            <span style={{ color:T.steelLt, fontSize:12 }}>GST <input type="number" value={gstPct} onChange={e => setGstPct(e.target.value)} style={{ width:48, background:T.bg, border:`1px solid ${T.border}`, color:T.gold, borderRadius:4, padding:"3px 6px", fontFamily:T.mono, fontSize:12, margin:"0 4px" }} />%</span>
            <span style={{ color:T.white, fontFamily:T.mono }}>Rs.{gstAmt.toFixed(2)}</span>
          </div>
        )}
        <label style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8, cursor:"pointer", color:T.text, fontSize:12 }}>
          <input type="checkbox" checked={roundOff} onChange={() => setRoundOff(v=>!v)} style={{ accentColor:T.gold, width:14, height:14 }} />
          Round off {roundOff && roundDiff!==0 ? `(${roundDiff>0?"+":""}${roundDiff.toFixed(2)})` : ""}
        </label>
        <div style={{ display:"flex", justifyContent:"space-between", borderTop:`1px solid ${T.border}`, paddingTop:8 }}><span style={{ color:T.gold, fontWeight:700 }}>TOTAL</span><span style={{ color:T.gold, fontFamily:T.mono, fontWeight:900, fontSize:16 }}>Rs.{total.toFixed(2)}</span></div>
      </div>
      <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
        <Btn label="Cancel" onClick={onClose} color={T.surface} textColor={T.steelLt} />
        <Btn label="Save Bill" onClick={save} disabled={!billNo} />
      </div>
    </Modal>
  );
}

// ── Payment Form ──────────────────────────────────────────────────────────────
function PaymentForm({ jobber, selJ, onClose, onSave, currentUser }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0,10));
  const [amount, setAmount] = useState("");
  const [channel, setChannel] = useState("bank");
  const [mode, setMode] = useState("UPI");
  const [note, setNote] = useState("");
  const bankModes = ["UPI","Bank Transfer","Cheque","NEFT/RTGS"];
  function save() {
    if (!amount) return;
    onSave({ id:`PAY${Date.now()}`, jobberId:selJ, date, amount:+amount, mode: channel==="cash"?"Cash":mode, channel, note, createdBy:currentUser, createdAtStr:nowStr() });
  }
  return (
    <Modal title={`Record Payment — ${jobber.name}`} onClose={onClose}>
      <div style={{ display:"flex", gap:10, marginBottom:14 }}>
        {[["bank","Bank (GST)"],["cash","Cash"]].map(([v,lbl]) => (
          <button key={v} onClick={() => setChannel(v)} style={{ flex:1, background:channel===v?T.gold:T.surface, color:channel===v?T.bg:T.steelLt, border:"none", borderRadius:8, padding:"10px", fontFamily:T.mono, fontSize:12, fontWeight:700, cursor:"pointer" }}>{lbl}</button>
        ))}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:14 }}>
        <Inp label="Date" type="date" value={date} onChange={setDate} />
        <Inp label="Amount (Rs.)" type="number" value={amount} onChange={setAmount} />
        {channel==="bank" && <Inp label="Mode" value={mode} onChange={setMode} options={bankModes} />}
        <Inp label="Note" value={note} onChange={setNote} placeholder="optional" style={channel==="cash"?{gridColumn:"1/-1"}:{}} />
      </div>
      <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
        <Btn label="Cancel" onClick={onClose} color={T.surface} textColor={T.steelLt} />
        <Btn label="Save Payment" onClick={save} disabled={!amount} color={T.green} textColor="#fff" />
      </div>
    </Modal>
  );
}

// ── Jobber Ledger ─────────────────────────────────────────────────────────────
function JobberLedger({ designs, jobbers }) {
  const [selJ, setSelJ] = useState("");
  const j = jobbers.find(x => x.id===selJ);
  const jList = jobbers.filter(j => j.role==="jobber");
  const entries = !j ? [] : designs.flatMap(d =>
    PROCESSES.map(p => {
      const proc = (d.processes||{})[p];
      if (!proc || proc.jobber!==selJ || !proc.rate) return null;
      const tp = (d.colors||[]).reduce((a,c) => a+Object.values(c.sizes||{}).reduce((x,v) => x+(+v||0), 0), 0);
      const amt = +(proc.billAmt||(tp*(+proc.rate||0)));
      const paid = +(proc.paid||0);
      return { designNo:d.designNo, brand:d.brand, process:p, pcs:tp, rate:proc.rate, billNo:proc.billNo, date:proc.date, amt, paid, bal:amt-paid };
    }).filter(Boolean)
  );
  const totAmt = entries.reduce((a,e) => a+e.amt, 0);
  const totPaid = entries.reduce((a,e) => a+e.paid, 0);
  const totBal = entries.reduce((a,e) => a+e.bal, 0);
  return (
    <div>
      <div style={{ maxWidth:280, marginBottom:20 }}>
        <div style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, marginBottom:4, textTransform:"uppercase" }}>Select Jobber</div>
        <select value={selJ} onChange={e => setSelJ(e.target.value)} style={{ background:T.surface, border:`1px solid ${T.border}`, color:T.text, borderRadius:6, padding:"8px 12px", fontSize:13, width:"100%" }}>
          <option value="">— select —</option>
          {jList.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
        </select>
      </div>
      {j && (
        <>
          <div style={{ background:T.surface, borderRadius:8, padding:14, marginBottom:16, display:"flex", gap:24, flexWrap:"wrap" }}>
            {[["NAME",j.name,T.white],["PROCESS",j.process,T.gold],["CODE",j.prefix||"—",T.gold],["BILLED",`Rs.${totAmt.toLocaleString()}`,T.white],["PAID",`Rs.${totPaid.toLocaleString()}`,T.green],["BALANCE",`Rs.${totBal.toLocaleString()}`,totBal>0?T.red:T.green]].map(([l,v,c]) => (
              <div key={l}><div style={{ fontSize:10, color:T.steelLt }}>{l}</div><div style={{ color:c, fontFamily:T.mono, fontWeight:700, fontSize:14 }}>{v}</div></div>
            ))}
          </div>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
            <thead>
              <tr style={{ background:T.surface }}>
                {["Design","Brand","Process","Pcs","Rate","Bill No","Date","Amount","Paid","Balance"].map(h => (
                  <th key={h} style={{ padding:"8px 10px", fontFamily:T.mono, fontSize:9, color:T.steelLt, textAlign:"left", textTransform:"uppercase", borderBottom:`1px solid ${T.border}`, whiteSpace:"nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((e,i) => (
                <tr key={i} style={{ background:i%2===0?T.card:T.surface, borderBottom:`1px solid ${T.border}` }}>
                  <td style={{ padding:"8px 10px", fontFamily:T.mono, color:T.gold, fontWeight:700 }}>{e.designNo}</td>
                  <td style={{ padding:"8px 10px", color:T.text }}>{e.brand}</td>
                  <td style={{ padding:"8px 10px", color:T.white }}>{e.process}</td>
                  <td style={{ padding:"8px 10px", fontFamily:T.mono, color:T.text }}>{e.pcs}</td>
                  <td style={{ padding:"8px 10px", fontFamily:T.mono, color:T.gold }}>Rs.{e.rate}</td>
                  <td style={{ padding:"8px 10px", color:T.steelLt }}>{e.billNo||"—"}</td>
                  <td style={{ padding:"8px 10px", color:T.steelLt }}>{e.date||"—"}</td>
                  <td style={{ padding:"8px 10px", fontFamily:T.mono, color:T.white }}>Rs.{e.amt}</td>
                  <td style={{ padding:"8px 10px", fontFamily:T.mono, color:T.green }}>Rs.{e.paid}</td>
                  <td style={{ padding:"8px 10px", fontFamily:T.mono, fontWeight:700, color:e.bal>0?T.red:T.green }}>Rs.{e.bal}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

// ── Jobber Panel ──────────────────────────────────────────────────────────────
function JobberPanel({ user, designs, setDesigns, people, challans, setChallans, onLogout }) {
  const [sel, setSel] = useState(null);
  const [showChallan, setShowChallan] = useState(false);
  const [lang, setLang] = useState("en");
  const L = makeL(lang);
  const [toast, setToast] = useState({ msg:"", type:"" });
  function showToast(msg, type="success") { setToast({msg,type}); setTimeout(() => setToast({msg:"",type:""}), 3000); }
  const myDesigns = designs.filter(d =>
    PROCESSES.some(p => d.processes?.[p]?.jobber===user.id) ||
    (d.movements||[]).some(m => m.sentToId===user.id)
  );

  function updateDesign(updated) {
    setDesigns(p => p.map(x => x.id===updated.id?updated:x));
    setSel(updated);
  }
  async function sendLot(mv) {
    const updated = { ...sel, movements:[...(sel.movements||[]), mv] };
    setDesigns(p => p.map(x => x.id===updated.id?updated:x));
    setSel(updated);
    await dbUpsert("movements", mvToRow(mv, sel.id));
    recordNotification(user.name, `${user.name} sent Design ${sel.designNo} to ${mv.sentTo} (${mv.qty} pcs)`, sel.id);
    showToast("Sent ✓");
  }

  if (sel) {
    return (
      <div style={{ minHeight:"100vh", background:T.bg }}>
        <div style={{ background:T.surface, borderBottom:`2px solid ${T.gold}`, padding:"14px 20px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div style={{ fontFamily:T.mono, fontSize:14, color:T.gold, fontWeight:700 }}>AASHISH APPARELS</div>
          <div style={{ display:"flex", gap:8, alignItems:"center" }}>
            <LangToggle lang={lang} setLang={setLang} />
            <Badge label="JOBBER" color={T.gold} />
            <span style={{ color:T.steelLt, fontSize:12 }}>{user.name}</span>
            <Btn label={L("Logout")} onClick={onLogout} color={T.surface} textColor={T.steelLt} small />
          </div>
        </div>
        <div style={{ maxWidth:1100, margin:"0 auto", padding:24 }}>
          <DesignDetail design={sel} jobbers={people} onBack={() => setSel(null)} onUpdate={updateDesign} showToast={showToast} role="jobber" currentUser={user.name} currentJobber={user} L={L} onSendLot={sendLot} people={people} challans={challans} />
        </div>
        <Toast {...toast} />
      </div>
    );
  }

  return (
    <div style={{ minHeight:"100vh", background:T.bg, fontFamily:T.sans }}>
      <div style={{ background:T.surface, borderBottom:`2px solid ${T.gold}`, padding:"14px 20px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div>
          <div style={{ fontFamily:T.mono, fontSize:14, color:T.gold, fontWeight:700 }}>AASHISH APPARELS</div>
          <div style={{ fontSize:11, color:T.steelLt }}>Logged in: <span style={{ color:T.white }}>{user.name}</span> <Badge label="JOBBER" color={T.gold} /></div>
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          <LangToggle lang={lang} setLang={setLang} />
          <Btn label={L("Logout")} onClick={onLogout} color={T.surface} textColor={T.steelLt} small />
        </div>
      </div>
      <div style={{ padding:20, maxWidth:900, margin:"0 auto" }}>
        {(() => {
          const myLate = myDesigns.filter(d => d.status!=="Completed" && (ageDays(d.createdAtStr||d.dateProgram) ?? 0) > 60);
          return myLate.length > 0 ? (
            <div style={{ background:T.red+"22", border:`1px solid ${T.red}`, borderRadius:8, padding:12, marginBottom:16, fontFamily:T.mono, fontSize:12, color:T.red }}>
              ⚠ Late designs needing attention: {myLate.map(d=>d.designNo).join(", ")}
            </div>
          ) : null;
        })()}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16, flexWrap:"wrap", gap:10 }}>
          <span style={{ fontFamily:T.mono, fontSize:11, color:T.steelLt, textTransform:"uppercase" }}>Your Assigned Designs — tap to fill sizes</span>
          <Btn label="+ New Challan" onClick={() => setShowChallan(true)} />
        </div>
        {(challans||[]).filter(c => c.jobberId===user.id).length > 0 && (
          <div style={{ background:T.card, borderRadius:10, border:`1px solid ${T.border}`, padding:14, marginBottom:16 }}>
            <div style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, textTransform:"uppercase", marginBottom:8 }}>Your Challans</div>
            {(challans||[]).filter(c => c.jobberId===user.id).slice(0,10).map(c => (
              <div key={c.id} style={{ display:"flex", gap:10, alignItems:"center", padding:"6px 0", fontSize:12, borderBottom:`1px solid ${T.border}` }}>
                <span style={{ fontFamily:T.mono, color:T.steelLt }}>{c.date}</span>
                <span style={{ color:T.gold, fontFamily:T.mono }}>D{c.designNo}</span>
                <span style={{ color:T.text }}>{c.qty} pcs</span>
                <span style={{ marginLeft:"auto" }}><Badge label={c.status} color={c.status==="approved"?T.green:c.status==="rejected"?T.red:T.orange} /></span>
              </div>
            ))}
          </div>
        )}
        {myDesigns.length === 0 && <div style={{ color:T.textDim, textAlign:"center", padding:60, fontFamily:T.mono }}>No designs assigned yet.</div>}
        {myDesigns.map(d => {
          const myProcs = PROCESSES.filter(p => d.processes?.[p]?.jobber===user.id);
          return (
            <div key={d.id} style={{ background:T.card, borderRadius:10, padding:18, marginBottom:12, border:`1px solid ${T.border}`, cursor:"pointer" }} onClick={() => setSel(d)}>
              <div style={{ display:"flex", justifyContent:"space-between" }}>
                <div>
                  <div style={{ fontFamily:T.mono, fontSize:22, color:T.gold, fontWeight:900 }}>{designLabel(d)}</div>
                  <div style={{ color:T.white, fontWeight:600 }}>{d.brand} · {d.style}</div>
                  <div style={{ color:T.steelLt, fontSize:12, marginTop:4 }}>Your work: {myProcs.join(", ")}</div>
                </div>
                <Badge label={d.status} color={T.steel} />
              </div>
              {(d.colors||[]).some(c => c.swatch) && (
                <div style={{ display:"flex", gap:6, marginTop:10 }}>
                  {(d.colors||[]).filter(c => c.swatch).map((c,ci) => (
                    <div key={ci} title={c.colorName} style={{ textAlign:"center" }}>
                      <div style={{ width:36, height:36, borderRadius:4, overflow:"hidden", border:`1px solid ${T.border}` }} onContextMenu={e => e.preventDefault()}>
                        <img src={c.swatch} alt="" style={{ width:"100%", height:"100%", objectFit:"cover", pointerEvents:"none" }} draggable={false} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {showChallan && <ChallanForm jobbers={people} designs={designs} challans={challans} role="jobber" currentUser={user.name} fixedJobber={user.id} onClose={()=>setShowChallan(false)} onSave={async (c) => {
        for (const dn of (c.newDesignNos||[])) {
          if (!designs.some(d => String(d.designNo)===String(dn))) {
            const nd = makePlaceholderDesign({ ...c, designNo:dn }, user.name);
            await dbUpsert("designs", dToRow(nd));
            setDesigns(p => [nd, ...p]);
            recordNotification(user.name, `New placeholder design ${dn} created via challan by ${user.name} — complete its details`, nd.id);
          }
        }
        await dbUpsert("challans", challanToRow(c));
        setChallans(p => [c,...p]);
        if (c.sendToId) {
          const target = c.sendToId==="__office__" ? null : people.find(j=>j.id===c.sendToId);
          const targetName = c.sendToId==="__office__" ? "Office / Admin" : (target?.name||"");
          for (const dn of challanDesigns(c)) {
            const design = designs.find(d => String(d.designNo)===String(dn));
            if (design) {
              const lineQty = (c.lines||[]).filter(l=>String(l.designNo)===String(dn)).reduce((a,l)=>a+(+l.qty||0),0) || +c.qty;
              const mv = { id:`MV${Date.now()}_${dn}`, date:c.date||new Date().toISOString().slice(0,10), jobber:user.name, receivedFrom:user.name, sentTo:targetName, sentToId:c.sendToId==="__office__"?"":c.sendToId, qty:lineQty, remark:`Challan ${c.challanNo||""}`, status:"sent" };
              const updated = { ...design, movements:[...(design.movements||[]), mv] };
              setDesigns(p => p.map(x => x.id===updated.id?updated:x));
              await dbUpsert("movements", mvToRow(mv, design.id));
            }
          }
          recordNotification(user.name, `${user.name} sent Challan ${c.challanNo||""} to ${targetName}`, "");
        }
        recordNotification(user.name, `New challan by ${user.name} — designs ${challanDesigns(c).join(", ")} (${challanQty(c)} pcs)`, "");
        showToast(c.sendToId ? "Saved & sent to next ✓" : "Challan saved ✓");
        setShowChallan(false);
      }} />}
      <Toast {...toast} />
    </div>
  );
}

// ── Notification Bell ─────────────────────────────────────────────────────────
function NotificationBell({ notifications, currentUser, onOpenDesign, onMarkRead }) {
  const [open, setOpen] = useState(false);
  const unread = (notifications||[]).filter(n => !(n.readBy||[]).includes(currentUser));
  return (
    <div style={{ position:"relative" }}>
      <button onClick={() => setOpen(o => !o)} style={{ background:"none", border:"none", cursor:"pointer", position:"relative", padding:"6px 10px", fontSize:18 }}>
        🔔
        {unread.length > 0 && <span style={{ position:"absolute", top:0, right:2, background:T.red, color:"#fff", borderRadius:10, fontSize:9, fontWeight:700, padding:"1px 5px", fontFamily:T.mono }}>{unread.length}</span>}
      </button>
      {open && (
        <div onClick={() => setOpen(false)} style={{ position:"fixed", inset:0, background:"#000A", zIndex:99999, display:"flex", alignItems:"flex-start", justifyContent:"center", padding:"16px", boxSizing:"border-box" }}>
          <div onClick={e => e.stopPropagation()} style={{ marginTop:50, width:"min(420px,100%)", maxHeight:"80vh", overflow:"auto", background:T.card, border:`1px solid ${T.border}`, borderRadius:12, boxShadow:"0 8px 40px #000", boxSizing:"border-box" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"14px 16px", borderBottom:`1px solid ${T.border}`, position:"sticky", top:0, background:T.card }}>
              <span style={{ fontFamily:T.mono, fontSize:12, color:T.gold, fontWeight:700, textTransform:"uppercase" }}>Notifications {unread.length>0?`(${unread.length} new)`:""}</span>
              <button onClick={() => setOpen(false)} style={{ background:"none", border:"none", color:T.steelLt, fontSize:22, cursor:"pointer", lineHeight:1 }}>✕</button>
            </div>
            {(notifications||[]).length === 0 && <div style={{ padding:24, textAlign:"center", color:T.textDim, fontFamily:T.mono, fontSize:12 }}>No notifications yet.</div>}
            {(notifications||[]).slice(0,40).map(n => {
              const isUnread = !(n.readBy||[]).includes(currentUser);
              return (
                <div key={n.id} onClick={() => { onMarkRead(n); if (n.designId) { onOpenDesign(n.designId); setOpen(false); } }} style={{ padding:"12px 16px", borderBottom:`1px solid ${T.border}`, cursor:"pointer", background:isUnread?T.surface:"transparent", display:"flex", gap:8, alignItems:"flex-start" }}>
                  {isUnread && <span style={{ width:8, height:8, borderRadius:"50%", background:T.gold, marginTop:5, flexShrink:0 }} />}
                  <div style={{ flex:1 }}>
                    <div style={{ color:isUnread?T.white:T.steelLt, fontSize:13, fontWeight:isUnread?600:400 }}>{n.message}</div>
                    <div style={{ color:T.textDim, fontSize:10, fontFamily:T.mono, marginTop:2 }}>{n.ts}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Home Dashboard ────────────────────────────────────────────────────────────
function Dashboard({ designs, bookings, bills, payments, people, lateDesigns, onGo, isAdmin }) {
  const inProgress = designs.filter(d => d.status==="In Progress").length;
  const mrpPending = designs.filter(d => !d.mrpFinalized && d.status!=="Completed").length;
  const completed = designs.filter(d => d.status==="Completed").length;

  const stats = [
    ["Total Designs", designs.length, T.gold],
    ["In Progress", inProgress, T.orange],
    ["Late (60+ days)", lateDesigns.length, lateDesigns.length?T.red:T.steel],
    ["MRP Pending", mrpPending, mrpPending?T.red:T.steel],
    ["Completed", completed, T.green],
  ];

  const cards = isAdmin ? [
    ["Designs", "All designs & status", "Designs", T.gold],
    ["+ New Design", "Create a new design", "__new__", T.green],
    ["Bookings", "Orders & demand planning", "Bookings", T.steelLt],
    ["Challans", "Jobber challans & approval", "Challans", T.orange],
    ["Bills & Ledger", "Jobber bills & payments", "Bills & Ledger", T.gold],
    ["Fabric Purchases", "Fabric bills & monthly totals", "Fabric Purchases", T.steelLt],
    ["People", "Jobbers & team members", "People", T.steelLt],
    ["Activity Log", "Who changed what & when", "Activity Log", T.steelLt],
    ["Search", "Find any design fast", "Search", T.gold],
  ] : [
    ["Designs", "All designs & status", "Designs", T.gold],
    ["+ New Design", "Create a new design", "__new__", T.green],
    ["Bookings", "Orders & demand planning", "Bookings", T.steelLt],
    ["Challans", "Jobber challans", "Challans", T.orange],
    ["Search", "Find any design fast", "Search", T.gold],
  ];

  return (
    <div>
      <div style={{ display:"flex", gap:12, marginBottom:22, flexWrap:"wrap" }}>
        {stats.map(([l,v,c]) => (
          <div key={l} style={{ background:T.card, borderRadius:10, padding:"14px 20px", borderLeft:`3px solid ${c}`, minWidth:120, flex:"1 1 120px" }}>
            <div style={{ fontFamily:T.mono, fontSize:26, fontWeight:900, color:c }}>{v}</div>
            <div style={{ fontSize:11, color:T.steelLt, marginTop:2 }}>{l}</div>
          </div>
        ))}
      </div>

      {lateDesigns.length > 0 && (
        <div onClick={() => onGo("Designs")} style={{ background:T.red+"22", border:`1px solid ${T.red}`, borderRadius:10, padding:14, marginBottom:22, fontFamily:T.mono, fontSize:13, color:T.red, cursor:"pointer" }}>
          ⚠ {lateDesigns.length} design(s) over 60 days old — tap to view: {lateDesigns.map(d=>d.designNo).join(", ")}
        </div>
      )}

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))", gap:14 }}>
        {cards.map(([title, sub, dest, color]) => (
          <div key={title} onClick={() => onGo(dest)} style={{ background:T.card, borderRadius:14, border:`1px solid ${T.border}`, borderTop:`4px solid ${color}`, padding:"22px 20px", cursor:"pointer", transition:"transform 0.1s" }}
            onMouseEnter={e => e.currentTarget.style.borderColor=color}
            onMouseLeave={e => e.currentTarget.style.borderColor=T.border}>
            <div style={{ fontFamily:T.mono, fontSize:17, fontWeight:900, color:color, marginBottom:6 }}>{title}</div>
            <div style={{ fontSize:12, color:T.steelLt }}>{sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Team / Admin shared design workspace ──────────────────────────────────────
function Workspace({ role, currentUser, designs, setDesigns, people, setPeople, bookings, setBookings, bills, setBills, payments, setPayments, activityLog, notifications, setNotifications, challans, setChallans, onLogout }) {
  const isAdmin = role === "admin";
  const [tab, setTab] = useState("Home");
  const [sel, setSel] = useState(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [toast, setToast] = useState({ msg:"", type:"" });
  const [search, setSearch] = useState("");
  const [showCompleted, setShowCompleted] = useState(false);
  const [monthFilter, setMonthFilter] = useState("");
  function showToast(msg, type="success") { setToast({msg,type}); setTimeout(() => setToast({msg:"",type:""}), 3000); }
  const jobbers = people.filter(p => p.role==="jobber");
  async function markNotifRead(n) {
    if ((n.readBy||[]).includes(currentUser)) return;
    const updated = { ...n, readBy:[...(n.readBy||[]), currentUser] };
    setNotifications(prev => prev.map(x => x.id===n.id ? updated : x));
    await dbUpsert("notifications", notifToRow(updated), true);
  }
  function openDesignById(id) {
    const d = designs.find(x => x.id===id);
    if (d) { setTab("Designs"); setSel(d); }
  }
  const lateDesigns = designs.filter(d => d.status!=="Completed" && (ageDays(d.createdAtStr || d.dateProgram) ?? 0) > 60);
  const monthOptions = Array.from(new Set(designs.map(d => monthKey(d.createdAtStr||d.dateProgram)).filter(Boolean)));
  async function addJobberInline({ name, process, prefix }) {
    const id = "J" + String(Date.now()).slice(-6);
    const j = { id, name, role:"jobber", process: process||"", prefix: prefix||"", pin: String(Date.now()).slice(-4), phone:"", gst:"", email:"", address:"" };
    await dbUpsert("jobbers", jToRow(j));
    setPeople(p => [...p, j]);
    showToast(`Jobber "${name}" added (PIN ${j.pin})`);
    return j;
  }

  const TABS = isAdmin ? ["Home","Designs","Bookings","Challans","People","Bills & Ledger","Fabric Purchases","Fabric Suppliers","Activity Log","Search"] : ["Home","Designs","Bookings","Challans","Search"];

  async function sendLot(mv) {
    if (!sel) return;
    const updated = { ...sel, movements:[...(sel.movements||[]), mv] };
    setDesigns(p => p.map(x => x.id===updated.id?updated:x));
    setSel(updated);
    await dbUpsert("movements", mvToRow(mv, sel.id));
    recordNotification(currentUser, `${currentUser} sent Design ${sel.designNo} to ${mv.sentTo} (${mv.qty} pcs)`, sel.id);
    showToast("Sent ✓");
  }
  async function saveDesign(d) {
    const isNew = creating;
    d = { ...d, supplierBills:(d.supplierBills||[]).map(b => ({ ...b, designNo: b.designNo||d.designNo })) };
    if (d.lotNo) {
      const clash = designs.find(x => x.lotNo===d.lotNo && x.id!==d.id);
      if (clash) { showToast(`Lot No ${d.lotNo} already used (design ${clash.designNo}). Use a unique lot no.`,"error"); return; }
    }
    const newD = isNew
      ? { ...d, id:`D${Date.now()}`, createdBy:currentUser, createdAtStr:nowStr(), editCount:0 }
      : { ...d, editedBy:currentUser, editedAtStr:nowStr(), editCount:(d.editCount||0)+1 };
    await dbUpsert("designs", dToRow(newD));
    recordActivity(currentUser, isNew?"Created design":"Edited design", `Design ${d.designNo}`, isNew?"":`edit #${newD.editCount}`);
    if (isNew) { setDesigns(p => [newD,...p]); showToast(`Design ${d.designNo} created!`); }
    else { setDesigns(p => p.map(x => x.id===newD.id?newD:x)); showToast("Saved!"); }
    // PROPAGATE multi-design fabric bills: copy each bill into the OTHER designs it covers (with their meters)
    try {
      for (const b of (newD.supplierBills||[])) {
        for (const ad of (b.appliesTo||[])) {
          const dn = String(ad.designNo||"").trim();
          if (!dn || dn===String(newD.designNo)) continue;
          const target = designs.find(x => String(x.designNo)===dn);
          if (!target) continue;
          // build a linked copy of the bill for the target design with that design's meters
          const linkedBill = { ...b, id:`${b.id}__${target.id}`, qty:ad.meters||"", amount:((+ad.meters||0)*(+b.rate||0))||"", designNo:dn, appliesTo:[], linkedFrom:newD.designNo, sharedBillNo:b.billNo };
          const existingBills = (target.supplierBills||[]).filter(x => x.id!==linkedBill.id);
          const updatedTarget = { ...target, supplierBills:[...existingBills, linkedBill] };
          await dbUpsert("designs", dToRow(updatedTarget));
          setDesigns(p => p.map(x => x.id===target.id?updatedTarget:x));
        }
      }
    } catch(e) { console.error("bill propagation error", e); }
    setCreating(false); setEditing(false); setSel(isNew?null:newD);
  }
  function updateDesign(updated) { setDesigns(p => p.map(x => x.id===updated.id?updated:x)); setSel(updated); }
  const sl = search.toLowerCase();
  const searchResults = search.length > 1 ? designs.filter(d =>
    (d.designNo||"").toLowerCase().includes(sl) ||
    (d.lotNo||"").toLowerCase().includes(sl) ||
    (d.brand||"").toLowerCase().includes(sl) ||
    (d.style||"").toLowerCase().includes(sl) ||
    (d.fabric||"").toLowerCase().includes(sl) ||
    (d.keywords||"").toLowerCase().includes(sl)
  ) : [];
  const peopleResults = search.length > 1 ? people.filter(p =>
    (p.name||"").toLowerCase().includes(sl) || (p.prefix||"").toLowerCase().includes(sl)
  ) : [];
  const fabricSupplierResults = search.length > 1 ? [...new Set(designs.flatMap(d => (d.supplierBills||[]).map(b => b.supplier).filter(Boolean)))].filter(n => n.toLowerCase().includes(sl)) : [];

  if (creating || editing) {
    return (
      <div style={{ minHeight:"100vh", background:T.bg }}>
        <div style={{ background:T.surface, borderBottom:`2px solid ${T.gold}`, padding:"14px 24px", display:"flex", justifyContent:"space-between" }}>
          <div style={{ fontFamily:T.mono, fontSize:14, color:T.gold, fontWeight:700 }}>AASHISH APPARELS · {creating?"New Design (v4 ✓ has Code Words)":"Edit Design (v4 ✓ has Code Words)"}</div>
          <Btn label="Cancel" onClick={() => { setCreating(false); setEditing(false); }} color={T.surface} textColor={T.steelLt} small />
        </div>
        <div style={{ maxWidth:1000, margin:"0 auto", padding:24 }}>
          <DesignForm onSave={saveDesign} onCancel={() => { setCreating(false); setEditing(false); }} existing={editing?sel:null} jobbers={jobbers} onAddJobber={addJobberInline} designs={designs} creditNotes={creditNotes} />
        </div>
        <Toast {...toast} />
      </div>
    );
  }

  if (sel) {
    return (
      <div style={{ minHeight:"100vh", background:T.bg }}>
        <div style={{ background:T.surface, borderBottom:`2px solid ${T.gold}`, padding:"14px 24px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div style={{ fontFamily:T.mono, fontSize:14, color:T.gold, fontWeight:700 }}>AASHISH APPARELS · {isAdmin?"ADMIN":"TEAM"}</div>
          <div style={{ display:"flex", gap:10, alignItems:"center" }}>
            <span style={{ color:T.steelLt, fontSize:12 }}>{currentUser}</span>
            <Btn label="Edit Design" onClick={() => setEditing(true)} color={T.surface} textColor={T.gold} small style={{ border:`1px solid ${T.gold}44` }} />
            <Btn label="Logout" onClick={onLogout} color={T.surface} textColor={T.steelLt} small />
          </div>
        </div>
        <div style={{ maxWidth:1100, margin:"0 auto", padding:24 }}>
          <DesignDetail design={sel} jobbers={jobbers} onBack={() => setSel(null)} onUpdate={updateDesign} showToast={showToast} role={role} currentUser={currentUser} L={(x)=>x} onSendLot={sendLot} people={jobbers} challans={challans} />
        </div>
        <Toast {...toast} />
      </div>
    );
  }

  return (
    <div style={{ minHeight:"100vh", background:T.bg, fontFamily:T.sans }}>
      <div style={{ background:T.surface, borderBottom:`2px solid ${T.gold}`, padding:"0 24px", display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap" }}>
        <div style={{ display:"flex", alignItems:"center", flexWrap:"wrap" }}>
          <div style={{ marginRight:32, padding:"14px 0" }}>
            <div style={{ fontFamily:T.mono, fontSize:14, fontWeight:900, color:T.gold, letterSpacing:2 }}>AASHISH APPARELS</div>
            <div style={{ fontFamily:T.mono, fontSize:8, color:T.steelLt, letterSpacing:2 }}>PRODUCTION ERP · {isAdmin?"ADMIN":"TEAM"} · {currentUser}</div>
          </div>
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)} style={{ background:"none", border:"none", cursor:"pointer", padding:"18px 16px", fontFamily:T.mono, fontSize:11, fontWeight:700, color:tab===t?T.gold:T.steelLt, borderBottom:tab===t?`2px solid ${T.gold}`:"2px solid transparent", marginBottom:-2, textTransform:"uppercase" }}><BL text={t} /></button>
          ))}
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
          <NotificationBell notifications={notifications} currentUser={currentUser} onOpenDesign={openDesignById} onMarkRead={markNotifRead} />
          <Btn label="Logout" onClick={onLogout} color={T.surface} textColor={T.steelLt} small />
        </div>
      </div>
      <div style={{ maxWidth:1200, margin:"0 auto", padding:24 }}>
        {tab==="Home" && (
          <Dashboard designs={designs} bookings={bookings} bills={bills} payments={payments} people={people} lateDesigns={lateDesigns} isAdmin={isAdmin} onGo={(dest) => { if (dest==="__new__") setCreating(true); else setTab(dest); }} />
        )}
        {tab==="Designs" && (
          <div>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
              <div style={{ fontFamily:T.mono, fontSize:11, color:T.steelLt, textTransform:"uppercase" }}>All Designs ({designs.length})</div>
              <Btn label="+ New Design" onClick={() => setCreating(true)} />
            </div>
            {isAdmin && (
              <div style={{ display:"flex", gap:12, marginBottom:20, flexWrap:"wrap" }}>
                {[["Total",designs.length,T.gold],["In Progress",designs.filter(d=>d.status==="In Progress").length,T.orange],["MRP Pending",designs.filter(d=>!d.mrpFinalized).length,T.red],["Approvals",designs.reduce((a,d)=>a+(d.jobberEntries||[]).filter(e=>e.status==="pending").length,0),T.red]].map(([l,v,c]) => (
                  <div key={l} style={{ background:T.card, borderRadius:8, padding:"14px 18px", borderLeft:`3px solid ${c}`, minWidth:120 }}>
                    <div style={{ fontFamily:T.mono, fontSize:20, fontWeight:900, color:T.white }}>{v}</div>
                    <div style={{ fontSize:11, color:T.steelLt, marginTop:2 }}>{l}</div>
                  </div>
                ))}
              </div>
            )}
            {lateDesigns.length > 0 && (
              <div style={{ background:T.red+"22", border:`1px solid ${T.red}`, borderRadius:8, padding:12, marginBottom:16, fontFamily:T.mono, fontSize:12, color:T.red }}>
                ⚠ {lateDesigns.length} design(s) are over 60 days old: {lateDesigns.map(d=>d.designNo).join(", ")}
              </div>
            )}
            <div style={{ display:"flex", gap:10, marginBottom:16, flexWrap:"wrap", alignItems:"center" }}>
              <button onClick={() => setShowCompleted(v=>!v)} style={{ background:showCompleted?T.gold:T.surface, color:showCompleted?T.bg:T.steelLt, border:"none", borderRadius:20, padding:"6px 16px", fontFamily:T.mono, fontSize:11, fontWeight:700, cursor:"pointer" }}>{showCompleted?"Showing Completed":"Show Completed"}</button>
              <select value={monthFilter} onChange={e => setMonthFilter(e.target.value)} style={{ background:T.surface, border:`1px solid ${T.border}`, color:T.text, borderRadius:20, padding:"6px 14px", fontSize:11, fontFamily:T.mono }}>
                <option value="">All months</option>
                {monthOptions.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            {designs.length === 0 && <div style={{ textAlign:"center", color:T.textDim, padding:60, fontFamily:T.mono }}>No designs yet. Click + New Design to start.</div>}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))", gap:14 }}>
              {designs.filter(d => showCompleted ? d.status==="Completed" : d.status!=="Completed").filter(d => !monthFilter || monthKey(d.createdAtStr||d.dateProgram)===monthFilter).map(d => {
                const tp = (d.colors||[]).reduce((a,c) => a+Object.values(c.sizes||{}).reduce((x,v) => x+(+v||0), 0), 0);
                const pend = (d.jobberEntries||[]).filter(e => e.status==="pending").length;
                const isLate = d.status!=="Completed" && (ageDays(d.createdAtStr||d.dateProgram) ?? 0) > 60;
                const mc = monthColor(d.createdAtStr||d.dateProgram);
                return (
                  <div key={d.id} style={{ background:T.card, borderRadius:10, border:`2px solid ${isLate?T.red:T.border}`, overflow:"hidden", cursor:"pointer", borderLeft:`5px solid ${mc}` }} onMouseEnter={e => { if(!isLate) e.currentTarget.style.borderColor=T.gold; }} onMouseLeave={e => { if(!isLate) e.currentTarget.style.borderColor=T.border; e.currentTarget.style.borderLeftColor=mc; }} onClick={() => setSel(d)}>
                    <div style={{ padding:"16px 18px", borderBottom:`1px solid ${T.border}` }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"start" }}>
                        <div style={{ display:"flex", gap:10, alignItems:"flex-start" }}>
                          {d.mainThumb && <img src={d.mainThumb} alt="" onContextMenu={e=>e.preventDefault()} style={{ width:44, height:44, borderRadius:6, objectFit:"cover", flexShrink:0 }} draggable={false} />}
                          <div>
                            <div style={{ fontFamily:T.mono, fontSize:24, fontWeight:900, color:T.gold }}>{designLabel(d)}</div>
                            <div style={{ color:T.white, fontWeight:600 }}>{d.brand}</div>
                            <div style={{ color:T.steelLt, fontSize:11 }}>Style: {d.style} · {d.fabric}</div>
                            {isLate && <div style={{ color:T.red, fontSize:10, fontFamily:T.mono, marginTop:2 }}>⚠ {ageDays(d.createdAtStr||d.dateProgram)} days old</div>}
                          </div>
                        </div>
                        <div style={{ display:"flex", flexDirection:"column", gap:4, alignItems:"flex-end" }}>
                          <Badge label={d.status} color={d.status==="New"?T.steel:d.status==="In Progress"?T.orange:T.green} />
                          {isAdmin && !d.mrpFinalized && <Badge label="MRP Pending" color={T.red} />}
                          {(d.supplierBills||[]).some(b => !(b.billNo && b.billNo.trim())) && <Badge label="Fabric bill incomplete" color={T.orange} />}
                          {pend > 0 && <Badge label={`${pend} pending`} color={T.orange} />}
                        </div>
                      </div>
                      {(d.colors||[]).some(c => c.swatch) && (
                        <div style={{ display:"flex", gap:4, marginTop:10 }}>
                          {(d.colors||[]).filter(c => c.swatch).slice(0,6).map((c,ci) => (
                            <div key={ci} title={c.colorName} style={{ width:22, height:22, borderRadius:3, overflow:"hidden", border:`1px solid ${T.border}` }} onContextMenu={e => e.preventDefault()}>
                              <img src={c.swatch} alt="" style={{ width:"100%", height:"100%", objectFit:"cover", pointerEvents:"none" }} draggable={false} />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div style={{ padding:"10px 18px", display:"flex", gap:16, fontSize:11 }}>
                      <div><span style={{ color:T.steelLt }}>Colors: </span><span style={{ color:T.white, fontFamily:T.mono }}>{(d.colors||[]).length}</span></div>
                      <div><span style={{ color:T.steelLt }}>Pieces: </span><span style={{ color:T.gold, fontFamily:T.mono, fontWeight:700 }}>{tp.toLocaleString()}</span></div>
                      {isAdmin && d.mrpFinalized && <div><span style={{ color:T.steelLt }}>MRP: </span><span style={{ color:T.green, fontFamily:T.mono }}>Rs.{d.p1MRP}</span></div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {tab==="Bookings" && <Section title="Bookings — Order Planning" action={<PdfBtn targetId="rpt-bookings" title="Bookings" />}><div id="rpt-bookings"><BookingsPanel bookings={bookings} setBookings={setBookings} showToast={showToast} currentUser={currentUser} /></div></Section>}
        {tab==="People" && isAdmin && <PeopleManager people={people} setPeople={setPeople} designs={designs} showToast={showToast} currentUser={currentUser} />}
        {tab==="Challans" && <Section title="Challans" action={<PdfBtn targetId="rpt-challans" title="Challans" />}><div id="rpt-challans"><ChallansPanel jobbers={people} designs={designs} setDesigns={setDesigns} challans={challans} setChallans={setChallans} bills={bills} showToast={showToast} currentUser={currentUser} role={role} /></div></Section>}
        {tab==="Bills & Ledger" && isAdmin && <Section title="Jobber Bills & Payment Ledger"><BillsLedger jobbers={people} designs={designs} bills={bills} setBills={setBills} payments={payments} setPayments={setPayments} challans={challans} setChallans={setChallans} creditNotes={creditNotes} setCreditNotes={setCreditNotes} showToast={showToast} currentUser={currentUser} /></Section>}
        {tab==="Fabric Purchases" && isAdmin && <Section title="Fabric Purchases — all bills & monthly totals" action={<PdfBtn targetId="rpt-fabric" title="Fabric Purchases" />}><div id="rpt-fabric"><FabricPurchases designs={designs} /></div></Section>}
        {tab==="Fabric Suppliers" && isAdmin && <Section title="Fabric Supplier Ledger"><FabricSupplierLedger designs={designs} payments={payments} setPayments={setPayments} creditNotes={creditNotes} setCreditNotes={setCreditNotes} showToast={showToast} currentUser={currentUser} /></Section>}
        {tab==="Activity Log" && isAdmin && <Section title="Activity Log — all changes" action={<PdfBtn targetId="rpt-activity" title="Activity Log" />}><div id="rpt-activity"><ActivityLog log={activityLog} /></div></Section>}
        {tab==="Search" && (
          <div>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by Design No, Brand or Style..." style={{ background:T.card, border:`2px solid ${T.gold}`, borderRadius:8, color:T.text, fontFamily:T.mono, fontSize:15, padding:"12px 18px", width:"100%", boxSizing:"border-box", outline:"none", marginBottom:20 }} />
            {search.length > 1 && searchResults.length === 0 && <div style={{ textAlign:"center", color:T.textDim, padding:40, fontFamily:T.mono }}>No designs found.</div>}
            {searchResults.length > 0 && <div style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, textTransform:"uppercase", margin:"6px 0" }}>Designs</div>}
            {searchResults.map(d => (
              <div key={d.id} style={{ background:T.card, borderRadius:10, padding:18, marginBottom:12, border:`1px solid ${T.border}`, cursor:"pointer" }} onClick={() => setSel(d)}>
                <span style={{ fontFamily:T.mono, fontSize:22, fontWeight:900, color:T.gold }}>{designLabel(d)}</span>
                <span style={{ color:T.white, fontWeight:600, marginLeft:16 }}>{d.brand}</span>
                <span style={{ color:T.steelLt, marginLeft:12 }}>Style: {d.style}</span>
                {d.keywords && <span style={{ color:T.gold, marginLeft:12, fontSize:12, fontStyle:"italic" }}>🏷 {d.keywords}</span>}
              </div>
            ))}
            {isAdmin && peopleResults.length > 0 && <div style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, textTransform:"uppercase", margin:"12px 0 6px" }}>People</div>}
            {isAdmin && peopleResults.map(p => (
              <div key={p.id} style={{ background:T.card, borderRadius:10, padding:14, marginBottom:10, border:`1px solid ${T.border}` }}>
                <span style={{ color:T.white, fontWeight:700 }}>{p.name}</span>
                <Badge label={p.role==="team"?"TEAM":"JOBBER"} color={p.role==="team"?T.steelLt:T.gold} />
                {p.process && <span style={{ color:T.steelLt, marginLeft:8, fontSize:12 }}>{p.process}</span>}
                {p.prefix && <span style={{ color:T.gold, fontFamily:T.mono, marginLeft:8, fontSize:12 }}>code {p.prefix}</span>}
              </div>
            ))}
            {isAdmin && fabricSupplierResults.length > 0 && <div style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, textTransform:"uppercase", margin:"12px 0 6px" }}>Fabric Suppliers</div>}
            {isAdmin && fabricSupplierResults.map(name => {
              const bills = designs.flatMap(d => (d.supplierBills||[]).filter(b=>b.supplier===name).map(b=>({...b,designNo:b.designNo||d.designNo})));
              const billed = bills.reduce((a,b)=>a+(+b.amount||0),0);
              const paid = payments.filter(p=>p.jobberId==="SUP:"+name).reduce((a,p)=>a+(+p.amount||0),0);
              return (
                <div key={name} onClick={()=>{ setTab("Fabric Suppliers"); }} style={{ background:T.card, borderRadius:10, padding:14, marginBottom:10, border:`1px solid ${T.border}`, cursor:"pointer" }}>
                  <span style={{ color:T.white, fontWeight:700 }}>{name}</span>
                  <Badge label="FABRIC SUPPLIER" color={T.steelLt} />
                  <span style={{ color:T.steelLt, marginLeft:8, fontSize:12, fontFamily:T.mono }}>Purchases Rs.{billed.toFixed(0)} · Paid Rs.{paid.toFixed(0)} · Bal Rs.{(billed-paid).toFixed(0)}</span>
                  <div style={{ fontFamily:T.mono, fontSize:10, color:T.gold, marginTop:4 }}>Tap → open Fabric Suppliers tab</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <Toast {...toast} />
    </div>
  );
}

// ── Login ─────────────────────────────────────────────────────────────────────
const ADMINS = [
  { name: "Admin 1", pin: "0000" },
  { name: "Admin 2", pin: "1111" },
];
function Login({ people, onAdmin, onUser, loadInfo, onRefresh }) {
  const [mode, setMode] = useState("select");
  const [pin, setPin] = useState("");
  const [adminPin, setAdminPin] = useState("");
  const [err, setErr] = useState("");
  const [dupes, setDupes] = useState(null);

  function tryAdmin() {
    const a = ADMINS.find(x => x.pin === adminPin);
    if (a) onAdmin(a.name);
    else setErr("Wrong admin PIN");
  }
  function tryUser() {
    const matches = people.filter(x => x.role===mode && String(x.pin)===String(pin));
    if (matches.length === 0) { setErr("Wrong PIN"); return; }
    if (matches.length === 1) { onUser(matches[0]); return; }
    setDupes(matches);
  }
  const PS = { background:T.surface, border:`1px solid ${T.border}`, borderRadius:8, color:T.text, fontSize:20, textAlign:"center", letterSpacing:8, width:"100%", padding:"12px", boxSizing:"border-box", fontFamily:T.mono, marginBottom:12, outline:"none" };

  return (
    <div style={{ minHeight:"100vh", background:T.bg, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:T.sans }}>
      <div style={{ background:T.card, borderRadius:16, padding:40, width:"min(400px,94vw)", border:`1px solid ${T.border}`, boxShadow:"0 8px 40px #0009" }}>
        <div style={{ textAlign:"center", marginBottom:32 }}>
          <div style={{ fontFamily:T.mono, fontSize:24, fontWeight:900, color:T.gold, letterSpacing:2 }}>AASHISH</div>
          <div style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, letterSpacing:3 }}>APPARELS · PRODUCTION ERP</div>
          <div style={{ marginTop:16, height:2, background:`linear-gradient(90deg,transparent,${T.gold},transparent)` }} />
        </div>
        {mode === "select" && (
          <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
            <Btn label="Admin Login" onClick={() => { setMode("admin"); setErr(""); }} style={{ padding:"14px", fontSize:14 }} />
            <Btn label="Team Member Login" onClick={() => { setMode("team"); setErr(""); }} color={T.surface} textColor={T.steelLt} style={{ padding:"14px", fontSize:14, border:`1px solid ${T.border}` }} />
            <Btn label="Jobber Login" onClick={() => { setMode("jobber"); setErr(""); }} color={T.surface} textColor={T.steelLt} style={{ padding:"14px", fontSize:14, border:`1px solid ${T.border}` }} />
            <div style={{ marginTop:8, textAlign:"center" }}>
              <div style={{ fontFamily:T.mono, fontSize:10, color:T.textDim, marginBottom:6 }}>{loadInfo || "Loading…"}</div>
              <button onClick={onRefresh} style={{ background:"none", border:`1px solid ${T.border}`, color:T.steelLt, borderRadius:6, padding:"6px 16px", fontFamily:T.mono, fontSize:11, cursor:"pointer" }}>↻ Refresh data</button>
            </div>
          </div>
        )}
        {mode === "admin" && (
          <div>
            <div style={{ fontFamily:T.mono, fontSize:11, color:T.steelLt, marginBottom:12, textAlign:"center" }}>Admin PIN (Admin 1: 0000 · Admin 2: 1111)</div>
            <input type="password" value={adminPin} onChange={e => setAdminPin(e.target.value)} onKeyDown={e => e.key==="Enter" && tryAdmin()} placeholder="PIN" maxLength={6} style={PS} />
            {err && <div style={{ color:T.red, fontSize:11, marginBottom:8, textAlign:"center" }}>{err}</div>}
            <div style={{ display:"flex", gap:10 }}>
              <Btn label="Back" onClick={() => { setMode("select"); setErr(""); setAdminPin(""); }} color={T.surface} textColor={T.steelLt} style={{ flex:1 }} />
              <Btn label="Login" onClick={tryAdmin} style={{ flex:2 }} />
            </div>
          </div>
        )}
        {(mode === "team" || mode === "jobber") && !dupes && (
          <div>
            <div style={{ fontFamily:T.mono, fontSize:11, color:T.steelLt, marginBottom:12, textAlign:"center" }}>{mode==="team"?"Team Member":"Jobber"} — enter your PIN</div>
            <input type="password" value={pin} onChange={e => setPin(e.target.value)} onKeyDown={e => e.key==="Enter" && tryUser()} placeholder="PIN" maxLength={6} autoFocus style={PS} />
            {err && <div style={{ color:T.red, fontSize:11, marginBottom:8, textAlign:"center" }}>{err}</div>}
            <div style={{ display:"flex", gap:10 }}>
              <Btn label="Back" onClick={() => { setMode("select"); setErr(""); setPin(""); }} color={T.surface} textColor={T.steelLt} style={{ flex:1 }} />
              <Btn label="Login" onClick={tryUser} style={{ flex:2 }} />
            </div>
          </div>
        )}
        {dupes && (
          <div>
            <div style={{ fontFamily:T.mono, fontSize:11, color:T.steelLt, marginBottom:12, textAlign:"center" }}>Select your name</div>
            {dupes.map(p => (
              <button key={p.id} onClick={() => onUser(p)} style={{ display:"block", width:"100%", background:T.surface, border:`1px solid ${T.border}`, color:T.text, borderRadius:8, padding:"12px", marginBottom:8, fontFamily:T.sans, fontSize:14, cursor:"pointer" }}>{p.name}</button>
            ))}
            <Btn label="Back" onClick={() => { setDupes(null); setPin(""); }} color={T.surface} textColor={T.steelLt} style={{ width:"100%" }} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [auth, setAuth] = useState(null);
  const [designs, setDesigns] = useState([]);
  const [people, setPeople] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [bills, setBills] = useState([]);
  const [creditNotes, setCreditNotes] = useState([]);
  const [payments, setPayments] = useState([]);
  const [activityLog, setActivityLog] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [challans, setChallans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadInfo, setLoadInfo] = useState("");
  const [saveError, setSaveError] = useState("");

  async function loadAll() {
    try {
      const [pRows, dRows, mvRows, entRows, bRows, billRows, payRows, logRows, notifRows, chRows, cnRows] = await Promise.all([
        dbSelect("jobbers"), dbSelect("designs"), dbSelect("movements"), dbSelect("jobber_entries"), dbSelect("bookings"), dbSelect("bills"), dbSelect("payments"), dbSelect("activity_log"), dbSelect("notifications"), dbSelect("challans"), dbSelect("credit_notes")
      ]);
      const ppl = (pRows||[]).map(rowToJ);
      setPeople(ppl);
      setDesigns((dRows||[]).map(r => {
        const d = rowToD(r);
        d.movements = (mvRows||[]).filter(m => m.design_id===r.id).map(rowToMv);
        d.jobberEntries = (entRows||[]).filter(e => e.design_id===r.id).map(rowToEnt);
        return d;
      }));
      setBookings((bRows||[]).map(rowToB));
      setBills((billRows||[]).map(rowToBill));
      setPayments((payRows||[]).map(rowToPay));
      setActivityLog((logRows||[]).map(rowToLog).sort((a,b)=> (b.ts||"").localeCompare(a.ts||"")));
      setNotifications((notifRows||[]).map(rowToNotif).sort((a,b)=> (b.ts||"").localeCompare(a.ts||"")));
      setChallans((chRows||[]).map(rowToChallan));
      setCreditNotes((cnRows||[]).map(rowToCn));
      setLoadInfo(`Loaded ${ppl.length} people, ${(dRows||[]).length} designs`);
    } catch(e) {
      setLoadInfo("Load error: " + (e?.message||e));
    }
    setLoading(false);
  }

  useEffect(() => { _logSink = (entry) => setActivityLog(prev => [entry, ...prev]); _notifSink = (entry) => setNotifications(prev => [entry, ...prev]); return () => { _logSink = null; _notifSink = null; }; }, []);
  useEffect(() => {
    window.__erpSaveError = (msg) => setSaveError(msg);
    return () => { window.__erpSaveError = null; };
  }, []);
  useEffect(() => { loadAll(); }, []);

  if (loading) return <Loader />;
  if (!auth) return <Login people={people} loadInfo={loadInfo} onRefresh={loadAll} onAdmin={name => setAuth({role:"admin", name})} onUser={u => setAuth({role:u.role, user:u, name:u.name})} />;

  const errorBanner = saveError ? (
    <div style={{ position:"fixed", top:0, left:0, right:0, zIndex:9998, background:T.red, color:"#fff", padding:"10px 16px", fontFamily:T.mono, fontSize:12, fontWeight:700, display:"flex", justifyContent:"space-between", alignItems:"center", gap:12 }}>
      <span>⚠ {saveError} — your last change did NOT save. Tell admin to check the database column.</span>
      <button onClick={() => setSaveError("")} style={{ background:"#fff", color:T.red, border:"none", borderRadius:4, padding:"4px 12px", fontFamily:T.mono, fontWeight:700, cursor:"pointer" }}>Dismiss</button>
    </div>
  ) : null;

  if (auth.role === "jobber") {
    return <>{errorBanner}<JobberPanel user={auth.user} designs={designs} setDesigns={setDesigns} people={people} challans={challans} setChallans={setChallans} onLogout={() => setAuth(null)} /></>;
  }
  return (
    <>
    {errorBanner}
    <Workspace
      role={auth.role}
      currentUser={auth.name}
      designs={designs} setDesigns={setDesigns}
      people={people} setPeople={setPeople}
      bookings={bookings} setBookings={setBookings}
      bills={bills} setBills={setBills}
      payments={payments} setPayments={setPayments}
      activityLog={activityLog}
      notifications={notifications} setNotifications={setNotifications}
      challans={challans} setChallans={setChallans}
      onLogout={() => setAuth(null)}
    />
    </>
  );
}
