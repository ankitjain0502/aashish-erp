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
    if (!r.ok) {
      let msg = ""; try { msg = await r.text(); } catch(e) {}
      console.error(`LOAD FAILED [${table}] ${r.status}:`, msg);
      if (typeof window !== "undefined" && window.__erpSaveError) window.__erpSaveError(`Load failed (${table}): ${r.status} ${msg.slice(0,180)}`);
      return [];
    }
    return r.json();
  } catch(e) {
    console.error(`LOAD ERROR [${table}]:`, e);
    if (typeof window !== "undefined" && window.__erpSaveError) window.__erpSaveError(`Load error (${table}): ${e?.message||e}`);
    return [];
  }
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

// ── Section Lock system ───────────────────────────────────────────────────────
function lockRow(l) { return { id:l.id, locked:!!l.locked, req_pending:!!l.reqPending, req_by:l.reqBy||"", code:l.code||"", code_active:!!l.codeActive }; }
function getLock(locks, id) { return (locks||[]).find(l => l.id===id) || { id, locked:false, reqPending:false, reqBy:"", code:"", codeActive:false }; }
function lockLabel(id) {
  if (id==="fabric_bills") return "Fabric Bills";
  if (id && id.startsWith("fabric_bills_")) return `Fabric Bills — Design ${id.replace("fabric_bills_","")}`;
  return id;
}
async function saveLock(setLocks, l) {
  setLocks(prev => { const ex = prev.some(x=>x.id===l.id); return ex ? prev.map(x=>x.id===l.id?l:x) : [...prev, l]; });
  await dbUpsert("locks", lockRow(l), true);
}
// Lock toggle button + unlock-request + code-entry, all in one component
function LockControl({ sectionId, label, locks, setLocks, currentUser, role }) {
  const l = getLock(locks, sectionId);
  const [codeInput, setCodeInput] = useState("");
  const [showEntry, setShowEntry] = useState(false);
  if (!l.locked) {
    return <button onClick={()=>saveLock(setLocks, { ...l, id:sectionId, locked:true, reqPending:false, code:"", codeActive:false })} style={{ background:T.surface, border:`1px solid ${T.border}`, color:T.steelLt, borderRadius:6, padding:"5px 12px", fontFamily:T.mono, fontSize:10, fontWeight:700, cursor:"pointer" }} title={`Lock ${label}`}>🔓 Lock {label}</button>;
  }
  // locked:
  return (
    <div style={{ display:"inline-flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
      <span style={{ background:T.red+"18", border:`1px solid ${T.red}`, color:T.red, borderRadius:6, padding:"5px 12px", fontFamily:T.mono, fontSize:10, fontWeight:700 }}>🔒 {label} LOCKED</span>
      {!l.reqPending && !showEntry && <button onClick={async()=>{ await saveLock(setLocks, { ...l, id:sectionId, reqPending:true, reqBy:currentUser||"user" }); setShowEntry(true); }} style={{ background:T.gold, color:T.bg, border:"none", borderRadius:6, padding:"5px 12px", fontFamily:T.mono, fontSize:10, fontWeight:700, cursor:"pointer" }}>Request unlock</button>}
      {(l.reqPending || showEntry) && (
        <span style={{ display:"inline-flex", alignItems:"center", gap:6 }}>
          {l.codeActive
            ? <span style={{ fontFamily:T.mono, fontSize:9, color:T.steelLt }}>Admin generated a code — enter it:</span>
            : <span style={{ fontFamily:T.mono, fontSize:9, color:T.orange }}>Waiting for admin to generate code on Home…</span>}
          <input value={codeInput} onChange={e=>setCodeInput(e.target.value.replace(/\D/g,"").slice(0,4))} placeholder="4-digit" style={{ width:70, background:T.bg, border:`1px solid ${T.border}`, borderRadius:6, color:T.text, fontFamily:T.mono, fontSize:13, padding:"5px 8px", textAlign:"center" }} />
          <button onClick={async()=>{
            if (l.codeActive && codeInput && codeInput===l.code) {
              await saveLock(setLocks, { id:sectionId, locked:false, reqPending:false, reqBy:"", code:"", codeActive:false });
              setShowEntry(false); setCodeInput("");
            } else { alert("Wrong or not-yet-generated code. Ask admin to generate it on Home."); }
          }} style={{ background:T.green, color:"#fff", border:"none", borderRadius:6, padding:"5px 12px", fontFamily:T.mono, fontSize:10, fontWeight:700, cursor:"pointer" }}>Unlock</button>
        </span>
      )}
    </div>
  );
}

const T = {
  bg: "#F7F4FB", surface: "#FFFFFF", card: "#FCFAFF", border: "#E6DCF2",
  gold: "#B8860B", steel: "#8B6FB0", steelLt: "#A98FC9",
  white: "#2A1A3E", red: "#D14D72", green: "#2E9E6B", orange: "#E08A2B",
  text: "#3A2A52", textDim: "#9385A8",
  accent: "#8B4FBF", accentLt: "#C77DD6", pink: "#E06B9C",
  mono: "'Courier New',monospace", sans: "'Segoe UI',Arial,sans-serif"
};

const SIZES = ["S","M","L","XL","XXL","3XL","4XL","5XL","6XL","7XL","8XL","9XL","10XL"];
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
const SPEC_KEYS = ["Label","Button","Tag","Embroidery","Print","Vinyl","Other Details 1","Other Details 2"];
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
// total pieces helper (FULL sleeve = c.sizes)
function totalPiecesFull(d) {
  return (d.colors||[]).reduce((a,c) => a+Object.values(c.sizes||{}).reduce((x,v)=>x+(+v||0),0), 0);
}
// HALF sleeve pieces (c.sizesHalf)
function totalPiecesHalf(d) {
  return (d.colors||[]).reduce((a,c) => a+Object.values(c.sizesHalf||{}).reduce((x,v)=>x+(+v||0),0), 0);
}
// total pieces helper (combined both sleeves)
function totalPieces(d) {
  return totalPiecesFull(d) + totalPiecesHalf(d);
}
// FULL sleeve fabric meters (c.meters) and HALF sleeve fabric (c.metersHalf)
function totalMetersFull(d) {
  return (d.colors||[]).reduce((a,c) => a+(+c.meters||0), 0);
}
function totalMetersHalf(d) {
  return (d.colors||[]).reduce((a,c) => a+(+c.metersHalf||0), 0);
}
// total sample meters across all colours
function sampleMeters(d) {
  return (d.colors||[]).reduce((a,c) => a + (c.sampleFabric||[]).reduce((x,sf)=>x+(+sf.meters||0),0), 0);
}
// total meters (gross, includes sample fabric) — both sleeves combined
function totalMeters(d) {
  return totalMetersFull(d) + totalMetersHalf(d);
}
// per-sleeve average = that sleeve's fabric / that sleeve's pieces
function fabricAverageFull(d) {
  const pcs = totalPiecesFull(d); if (!pcs) return "";
  return (totalMetersFull(d) / pcs).toFixed(2);
}
function fabricAverageHalf(d) {
  const pcs = totalPiecesHalf(d); if (!pcs) return "";
  return (totalMetersHalf(d) / pcs).toFixed(2);
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
// Build the BELOW-barcode fabric block: designTotal(colourMeters) rate supplierInitials+cityLetter+billNo billDate
// e.g. "1000(66)  155  APA12  010726"  — 1000 = design ke saare colours ka total, 66 = is colour ka
function buildFabricBlock(block, designTotal) {
  if (!block) return "";
  const m = block.meters !== "" && block.meters != null ? Math.ceil(+block.meters) : "";
  const tot = designTotal != null && designTotal !== "" && +designTotal > 0 ? Math.ceil(+designTotal) : "";
  const meters = m === "" ? (tot===""?"":String(tot)) : (tot === "" ? String(m) : `${tot}(${m})`);
  const supTok = (block.initials||"") + (block.cityLetter||"") + (block.billNo||"");
  return [meters, block.rate, supTok, block.billDate].filter(v => v !== "" && v != null).join("  ");
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
    colors: (d.colors||[]).map(c => ({ ...c, swatch: c.swatch || "" })),
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
// helper: can this jobber fill the size grid? STRICTLY stitcher and admin only.
function canFillSizes(jobber) {
  if (!jobber) return false;
  if (jobber.role === "admin") return true;
  // only stitchers may fill sizes — no other override
  if ((jobber.processCodes||[]).some(x => (x.process||"").toLowerCase().includes("stitch"))) return true;
  return (jobber.process||"").toLowerCase().includes("stitch");
}
// helper: does jobber do this process?
function jobberDoesProcess(jobber, processName) {
  if (!jobber) return false;
  if ((jobber.processCodes||[]).some(x => x.process===processName)) return true;
  return jobber.process===processName;
}
function mvToRow(mv, did) {
  return { id: mv.id, design_id: did, date: mv.date||"", received_date: mv.receivedDate||"", sent_date: mv.sentDate||"", jobber: mv.jobber||"", received_from: mv.receivedFrom||"", sent_to: mv.sentTo||"", sent_to_id: mv.sentToId||"", qty: mv.qty||0, remark: mv.remark||"", status: mv.status||"pending" };
}
function rowToMv(r) {
  return { id: r.id, date: r.date||"", receivedDate: r.received_date||"", sentDate: r.sent_date||"", jobber: r.jobber||"", receivedFrom: r.received_from||"", sentTo: r.sent_to||"", sentToId: r.sent_to_id||"", qty: r.qty||0, remark: r.remark||"", status: r.status||"pending" };
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

// Swatch images sync to the DB, so keep them small (~20-40KB) to protect storage.
function compressSwatch(file) { return compressImage(file, 400, 0.6); }

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
  // Show design number first, lot number in brackets — only when a lot number is entered.
  if (d.lotNo && String(d.lotNo).trim() && d.lotNo !== d.designNo) return `${d.designNo} (${d.lotNo})`;
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
  // While any modal/form is open, pause the background auto-refresh so typing isn't disturbed.
  useEffect(() => {
    window.__erpModalsOpen = (window.__erpModalsOpen || 0) + 1;
    return () => { window.__erpModalsOpen = Math.max(0, (window.__erpModalsOpen || 1) - 1); };
  }, []);
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

function Calculator({ onClose }) {
  const [display, setDisplay] = useState("0");
  const [prev, setPrev] = useState(null);
  const [op, setOp] = useState(null);
  const [fresh, setFresh] = useState(true);
  function inputDigit(d) {
    if (fresh) { setDisplay(d==="."?"0.":d); setFresh(false); }
    else if (d==="." && display.includes(".")) {}
    else setDisplay(display==="0" && d!=="." ? d : display+d);
  }
  function clearAll() { setDisplay("0"); setPrev(null); setOp(null); setFresh(true); }
  function backspace() { setDisplay(display.length>1 ? display.slice(0,-1) : "0"); }
  function compute(a, b, o) {
    a=+a; b=+b;
    if (o==="+") return a+b; if (o==="-") return a-b;
    if (o==="\u00d7") return a*b; if (o==="\u00f7") return b===0?0:a/b;
    return b;
  }
  function chooseOp(o) {
    if (op && !fresh) { const r = compute(prev, display, op); setDisplay(String(r)); setPrev(r); }
    else setPrev(display);
    setOp(o); setFresh(true);
  }
  function equals() {
    if (op==null) return;
    const r = compute(prev, display, op);
    setDisplay(String(Math.round(r*10000)/10000)); setPrev(null); setOp(null); setFresh(true);
  }
  function pct() { setDisplay(String((+display)/100)); }
  const keys = [
    ["C","\u232b","%","\u00f7"],
    ["7","8","9","\u00d7"],
    ["4","5","6","-"],
    ["1","2","3","+"],
    ["0",".","="],
  ];
  function press(k) {
    if (k==="C") clearAll();
    else if (k==="\u232b") backspace();
    else if (k==="%") pct();
    else if (["+","-","\u00d7","\u00f7"].includes(k)) chooseOp(k);
    else if (k==="=") equals();
    else inputDigit(k);
  }
  return (
    <div style={{ position:"fixed", bottom:80, right:24, width:260, background:T.surface, borderRadius:14, boxShadow:"0 10px 40px rgba(0,0,0,0.4)", border:`1px solid ${T.border}`, zIndex:9998, overflow:"hidden" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 14px", background:T.accent||T.gold }}>
        <span style={{ fontFamily:T.mono, fontSize:12, fontWeight:700, color:"#fff" }}>Calculator</span>
        <button onClick={onClose} style={{ background:"none", border:"none", color:"#fff", fontSize:16, cursor:"pointer", lineHeight:1 }}>\u2715</button>
      </div>
      <div style={{ padding:14 }}>
        <div style={{ background:T.bg, borderRadius:8, padding:"14px 12px", textAlign:"right", fontFamily:T.mono, fontSize:26, fontWeight:700, color:T.text, marginBottom:12, overflow:"hidden", whiteSpace:"nowrap", textOverflow:"ellipsis" }}>{display}</div>
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          {keys.map((row,ri) => (
            <div key={ri} style={{ display:"flex", gap:8 }}>
              {row.map(k => {
                const isOp = ["+","-","\u00d7","\u00f7","="].includes(k);
                const isFn = ["C","\u232b","%"].includes(k);
                const wide = k==="0";
                return (
                  <button key={k} onClick={()=>press(k)} style={{
                    flex: wide?2.15:1, padding:"14px 0", borderRadius:8, border:"none", cursor:"pointer",
                    fontFamily:T.mono, fontSize:16, fontWeight:700,
                    background: k==="=" ? (T.accent||T.gold) : isOp ? (T.accentLt||T.gold)+"33" : isFn ? T.border : T.card,
                    color: k==="=" ? "#fff" : isOp ? (T.accent||T.gold) : T.text,
                  }}>{k}</button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
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

function PhotoUpload({ label, value, onChange, size=60, small=false }) {
  const ref = useRef();
  function handle(e) {
    const file = e.target.files[0];
    if (!file) return;
    (small ? compressSwatch(file) : compressImage(file)).then(onChange).catch(() => {});
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
    ...(design.sleeveType==="Both" ? [
      ["Full Sleeve Avg", fabricAverageFull(design)||"—", T.accent],
      ["Half Sleeve Avg", fabricAverageHalf(design)||"—", T.pink],
    ] : []),
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
  const [showSampleShrink, setShowSampleShrink] = useState(false);
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
      <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:6 }}>
        <button onClick={()=>setShowSampleShrink(s=>!s)} style={{ background:showSampleShrink?(T.accent||T.gold):T.surface, color:showSampleShrink?"#fff":T.steelLt, border:`1px solid ${T.border}`, borderRadius:16, padding:"5px 14px", fontFamily:T.mono, fontSize:10, fontWeight:700, cursor:"pointer" }}>
          {showSampleShrink?"✓ ":""}Show Sample Shrinkage
        </button>
      </div>
      <div style={{ overflowX:"auto", marginBottom:16 }}>
        <table style={{ borderCollapse:"collapse", fontSize:11, minWidth:"100%" }}>
          <thead>
            <tr style={{ background:T.surface }}>
              <th style={{ padding:"8px 6px", fontFamily:T.mono, fontSize:9, color:T.steelLt, textAlign:"left", border:`1px solid ${T.border}` }}>SWATCH</th>
              <th style={{ padding:"8px 10px", fontFamily:T.mono, fontSize:9, color:T.steelLt, textAlign:"left", border:`1px solid ${T.border}` }}>COLOR</th>
              <th style={{ padding:"8px", fontFamily:T.mono, fontSize:9, color:T.steelLt, border:`1px solid ${T.border}` }}>MTR</th>
              <th style={{ padding:"8px", fontFamily:T.mono, fontSize:9, color:T.steelLt, border:`1px solid ${T.border}` }}>SHRINK</th>
              {showSampleShrink && <th style={{ padding:"8px", fontFamily:T.mono, fontSize:9, color:T.accent||T.gold, border:`1px solid ${T.border}` }}>SAMPLE SHRINK</th>}
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
                  <td style={{ padding:"6px", color:T.text, fontFamily:T.mono, border:`1px solid ${T.border}`, textAlign:"center" }}>{c.shrinkage||"—"}</td>
                  {showSampleShrink && <td style={{ padding:"6px", color:T.accent||T.gold, fontFamily:T.mono, border:`1px solid ${T.border}`, textAlign:"center" }}>{c.sampleShrinkage||"—"}</td>}
                  {sizes.map(s => <td key={s} style={{ padding:"6px", color:T.text, fontFamily:T.mono, border:`1px solid ${T.border}`, textAlign:"center" }}>{(c.sizes||{})[s]||0}</td>)}
                  <td style={{ padding:"6px", color:T.gold, fontFamily:T.mono, fontWeight:700, border:`1px solid ${T.border}`, textAlign:"center" }}>{rt}</td>
                  <td style={{ padding:"6px 8px", color:T.steelLt, border:`1px solid ${T.border}` }}>{c.balance||""}</td>
                </tr>
              );
            })}
            <tr style={{ background:T.bg }}>
              <td colSpan={2} style={{ padding:"8px", fontFamily:T.mono, fontWeight:700, color:T.gold, border:`1px solid ${T.border}` }}>TOTAL</td>
              <td style={{ padding:"8px", color:T.gold, fontFamily:T.mono, border:`1px solid ${T.border}`, textAlign:"center" }}>{totalMeters(design)}</td>
              <td style={{ border:`1px solid ${T.border}` }} />
              {showSampleShrink && <td style={{ border:`1px solid ${T.border}` }} />}
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
  const allowedToFill = isAdmin || canFillSizes(currentJobber);
  const canEdit = !locked && allowedToFill;
  function updColor(id, k, v) { if (!canEdit) return; onUpdate({ ...design, colors: design.colors.map(c => c.id===id ? {...c,[k]:v} : c) }); }
  function setNotes(v) { if (!canEdit) return; onUpdate({ ...design, notes: v }); }
  function addSampleFabric(id) { if (!canEdit) return; onUpdate({ ...design, colors: design.colors.map(c => c.id===id ? {...c, sampleFabric:[...(c.sampleFabric||[]), {meters:"", date:new Date().toISOString().slice(0,10)}]} : c) }); }
  function updSampleFabric(id, idx, k, v) { if (!canEdit) return; onUpdate({ ...design, colors: design.colors.map(c => c.id===id ? {...c, sampleFabric:(c.sampleFabric||[]).map((sf,j)=>j===idx?{...sf,[k]:v}:sf)} : c) }); }
  function delSampleFabric(id, idx) { if (!canEdit) return; onUpdate({ ...design, colors: design.colors.map(c => c.id===id ? {...c, sampleFabric:(c.sampleFabric||[]).filter((_,j)=>j!==idx)} : c) }); }
  const totalPcs = (design.colors||[]).reduce((a,c) => a+sizes.reduce((x,s)=>x+(+(c.sizes||{})[s]||0),0), 0);
  const totalSample = totalSamplePcs(design);
  return (
    <div style={{ fontFamily:T.sans, fontSize:12 }}>
      {!allowedToFill && <div style={{ background:T.orange+"22", border:`1px solid ${T.orange}`, borderRadius:8, padding:12, marginBottom:14, fontFamily:T.mono, fontSize:11, color:T.orange }}>👁 View only — only the stitcher and admin can fill sizes for this design.</div>}
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
                  <span style={{ fontFamily:T.mono, fontSize:11, color:T.steelLt }}>Shrinkage:
                    <input disabled={!canEdit} value={c.shrinkage||""} onChange={e=>updColor(c.id,"shrinkage",e.target.value)} placeholder="e.g. 3%" style={{ background:canEdit?T.bg:T.card, border:`1px solid ${T.border}`, color:T.accent||T.gold, fontFamily:T.mono, fontSize:11, width:70, padding:"2px 6px", marginLeft:4, borderRadius:4 }} />
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
          ? <div style={{ fontFamily:T.mono, fontSize:13, color:T.gold, fontWeight:700, lineHeight:1.7 }}>
              {design.sleeveType==="Both"
                ? <>GRAND TOTAL: {totalPieces(design)} pcs (Full {totalPiecesFull(design)} + Half {totalPiecesHalf(design)})<br/>Fabric: Full {totalMetersFull(design)}m + Half {totalMetersHalf(design)}m = {totalMeters(design)}m</>
                : <>GRAND TOTAL: {totalPieces(design)} pcs &nbsp;·&nbsp; Fabric: {totalMeters(design)} m</>}
            </div>
          : <div style={{ fontFamily:T.mono, fontSize:13, color:T.gold, fontWeight:700, lineHeight:1.7 }}>
              {design.sleeveType==="Both" && <>Full {totalPiecesFull(design)} + Half {totalPiecesHalf(design)} = {totalPieces(design)} pcs<br/></>}
              Total {totalPieces(design)} = Sample {totalSample} + Dispatch {totalPieces(design)-totalSample}<br/>
              Fabric: {design.sleeveType==="Both" ? <>Full {totalMetersFull(design)}m + Half {totalMetersHalf(design)}m = {totalMeters(design)}m</> : <>{(totalMeters(design)-sampleMeters(design)).toFixed(1)} net + {sampleMeters(design).toFixed(1)} sample = {totalMeters(design)} m</>}
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
function SupplierBills({ design, onUpdate, role, allSuppliers = [], creditNotes = [], locks = [], setLocks, currentUser }) {
  // is bill pe kitne credit note lage (supplier CN, bill no se match)
  function cnForBill(b) {
    const bn = String(b.billNo||"").trim();
    if (!bn) return null;
    let qty=0, amt=0; const nos=[];
    (creditNotes||[]).filter(c => c.partyType==="supplier" && (c.party||"").trim().toLowerCase()===String(b.supplier||"").trim().toLowerCase())
      .forEach(c => (c.lines||[]).forEach(l => {
        if (String(l.billNo||"").trim() !== bn) return;
        qty += (+l.qty||0); amt += (+l.amount||0);
        if (c.cnNo && !nos.includes(c.cnNo)) nos.push(c.cnNo);
      }));
    return (qty||amt) ? { qty, amt, nos } : null;
  }
  const sectionId = "fabric_bills";
  const isLocked = getLock(locks, sectionId).locked;
  const canEdit = (role === "admin" || role === "team") && !isLocked;
  const [lightbox, setLightbox] = useState(null);
  const bills = design.supplierBills || [];
  function updBill(id,k,v){ if(!canEdit) return; onUpdate({ ...design, supplierBills:bills.map(b => { if(b.id!==id) return b; const nb={...b,[k]:v}; if(k==="qty"||k==="rate") nb.amount=((+nb.qty||0)*(+nb.rate||0))||""; return nb; }) }); }
  function addBill(){ onUpdate({ ...design, supplierBills:[...bills, { id:`B${Date.now()}`, designNo:design.designNo, billType:"Fabric", supplier:"", billNo:"", billDate:"", lrNo:"", transporter:"", transportCost:"", qty:"", rate:"", amount:"", hasGst:false, gstRate:"", gstType:"CGST+SGST", roundOff:"", photo:"" }] }); }
  function toggleGst(id, on){ if(!canEdit) return; onUpdate({ ...design, supplierBills:bills.map(b => b.id!==id ? b : { ...b, hasGst:on, gstRate: on ? (b.gstRate||"") : "" }) }); }
  function removeBill(id){ if(!window.confirm("Delete this bill?")) return; onUpdate({ ...design, supplierBills:bills.filter(b => b.id!==id) }); }
  function billPhoto(id,file){ if(!file) return; compressImage(file).then(src => updBill(id,"photo",src)).catch(()=>{}); }
  const totalAmt = bills.reduce((a,b) => a+billTotalWithGST(b), 0);
  const totalQty = bills.reduce((a,b) => a+(+b.qty||0), 0);
  return (
    <div>
      {setLocks && <div style={{ marginBottom:12, display:"flex", justifyContent:"flex-end" }}><LockControl sectionId={sectionId} label="Fabric Bills" locks={locks} setLocks={setLocks} currentUser={currentUser} role={role} /></div>}
      {isLocked && <div style={{ background:T.red+"11", border:`1px solid ${T.red}44`, borderRadius:8, padding:"8px 12px", marginBottom:12, fontFamily:T.mono, fontSize:10, color:T.red }}>🔒 This section is locked. Editing is disabled. Use "Request unlock" above to get a code from admin.</div>}
      {bills.map(b => (
        <div key={b.id} style={{ background:T.surface, borderRadius:8, padding:12, marginBottom:12, border:`1px solid ${b.billNo && b.billNo.trim() ? T.green : T.orange}`, display:"flex", gap:12, alignItems:"flex-start", flexWrap:"wrap" }}>
          <FabricBillPhoto bill={b} onPick={file => billPhoto(b.id, file)} />
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(120px,1fr))", gap:8, flex:1 }}>
            <Inp label="Type" value={b.billType||"Fabric"} onChange={v => updBill(b.id,"billType",v)} options={["Fabric","Trims"]} />
            <Inp label="Bill Date" type="date" value={b.billDate} onChange={v => updBill(b.id,"billDate",v)} />
            <div style={{ gridColumn:"1 / -1" }}><SupplierPicker value={b.supplier} onChange={v => updBill(b.id,"supplier",v)} allSuppliers={allSuppliers} /></div>
            <Inp label="Quantity (m)" type="number" value={b.qty} onChange={v => updBill(b.id,"qty",v)} />
            <Inp label="Rate" type="number" value={b.rate} onChange={v => updBill(b.id,"rate",v)} />
            <Inp label="Amount" type="number" value={b.amount} onChange={v => updBill(b.id,"amount",v)} />
            <Inp label="Bill No" value={b.billNo} onChange={v => updBill(b.id,"billNo",v)} />
            <Inp label="LR No" value={b.lrNo} onChange={v => updBill(b.id,"lrNo",v)} />
            <Inp label="Transporter" value={b.transporter||""} onChange={v => updBill(b.id,"transporter",v)} placeholder="transporter name" />
            <Inp label="Transport Cost (Rs.)" type="number" value={b.transportCost||""} onChange={v => updBill(b.id,"transportCost",v)} placeholder="freight cost" />
            <label style={{ gridColumn:"1 / -1", display:"flex", alignItems:"center", gap:8, fontFamily:T.mono, fontSize:11, color:T.text, cursor: canEdit?"pointer":"default", padding:"4px 0" }}>
              <input type="checkbox" checked={!!(b.hasGst || +b.gstRate>0)} onChange={e => toggleGst(b.id, e.target.checked)} disabled={!canEdit} style={{ width:16, height:16, accentColor:T.gold }} />
              GST लगेगा? (bina GST wale bill ke liye unchecked rakho)
            </label>
            {(b.hasGst || +b.gstRate>0) && <>
              <Inp label="GST %" value={b.gstRate||""} onChange={v => updBill(b.id,"gstRate",v)} options={["","5","12","18","28"]} />
              <Inp label="GST Type" value={b.gstType||"CGST+SGST"} onChange={v => updBill(b.id,"gstType",v)} options={["CGST+SGST","IGST"]} />
              <Inp label="Round Off (Rs.)" type="number" value={b.roundOff??""} onChange={v => updBill(b.id,"roundOff",v)} placeholder="auto" />
            </>}
          </div>
          {(+b.gstRate>0 && +b.amount>0) && (() => {
            const taxable = +b.amount||0, rate = +b.gstRate||0;
            const gst = taxable*rate/100; const rawTotal = taxable + gst;
            const autoRound = Math.round(rawTotal) - rawTotal;
            const roundOff = b.roundOff!==undefined && b.roundOff!=="" ? +b.roundOff : autoRound;
            const total = rawTotal + roundOff;
            return (
              <div style={{ width:"100%", background:T.bg, borderRadius:6, padding:"8px 12px", fontFamily:T.mono, fontSize:10, color:T.steelLt, display:"flex", gap:16, flexWrap:"wrap", alignItems:"center" }}>
                <span>Taxable: <b style={{color:T.text}}>Rs.{taxable.toFixed(2)}</b></span>
                {b.gstType==="IGST"
                  ? <span>IGST {rate}%: <b style={{color:T.gold}}>Rs.{gst.toFixed(2)}</b></span>
                  : <><span>CGST {(rate/2)}%: <b style={{color:T.gold}}>Rs.{(gst/2).toFixed(2)}</b></span><span>SGST {(rate/2)}%: <b style={{color:T.gold}}>Rs.{(gst/2).toFixed(2)}</b></span></>}
                <span>Round off: <b style={{color:T.steelLt}}>{roundOff>=0?"+":""}{roundOff.toFixed(2)}</b></span>
                {(b.roundOff===undefined||b.roundOff==="") && Math.abs(autoRound)>0.001 && <button onClick={()=>updBill(b.id,"roundOff",autoRound.toFixed(2))} style={{ background:T.gold, color:T.bg, border:"none", borderRadius:4, padding:"2px 8px", fontFamily:T.mono, fontSize:9, cursor:"pointer" }}>use auto {autoRound>=0?"+":""}{autoRound.toFixed(2)}</button>}
                <span>Total: <b style={{color:T.white}}>Rs.{total.toFixed(2)}</b></span>
              </div>
            );
          })()}
          {(() => {
            const cn = cnForBill(b);
            if (!cn) return null;
            const billQty = +b.qty||0, billAmt = billTotalWithGST(b);
            return (
              <div style={{ width:"100%", background:T.red+"12", border:`1px solid ${T.red}44`, borderRadius:6, padding:"8px 12px", fontFamily:T.mono, fontSize:10, color:T.red, display:"flex", gap:16, flexWrap:"wrap", alignItems:"center" }}>
                <span>↳ Credit Note{cn.nos.length?` (${cn.nos.join(", ")})`:""}: <b>−{cn.qty} m · −Rs.{cn.amt.toFixed(2)}</b></span>
                <span style={{ color:T.green }}>NET: <b>{+(billQty-cn.qty).toFixed(2)} m · Rs.{(billAmt-cn.amt).toFixed(2)}</b></span>
              </div>
            );
          })()}
          {canEdit && <div style={{ width:"100%", display:"flex", justifyContent:"flex-end" }}><Btn label="✕ Delete Bill" onClick={() => removeBill(b.id)} color={T.red+"22"} textColor={T.red} small /></div>}
        </div>
      ))}
      {canEdit && <Btn label="+ Add Fabric Supplier Bill" onClick={addBill} color={T.gold} textColor={T.bg} />}
      {bills.length === 0 && <div style={{ textAlign:"center", color:T.textDim, padding:30, fontFamily:T.mono, fontSize:12 }}>No bills added yet. Tap "+ Add Fabric Supplier Bill".</div>}
      {bills.length > 0 && (
        <div style={{ marginTop:14, background:T.surface, borderRadius:8, padding:"12px 16px", display:"flex", gap:24, flexWrap:"wrap" }}>
          <span style={{ fontFamily:T.mono, fontSize:12, color:T.gold, fontWeight:700 }}>TOTAL QTY: {totalQty} m</span>
          <span style={{ fontFamily:T.mono, fontSize:14, color:T.gold, fontWeight:900 }}>TOTAL (with GST): Rs.{totalAmt.toFixed(2)}</span>
        </div>
      )}
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
function ProcessRegister({ design, jobbers, challans = [], onUpdate, role }) {
  const isAdmin = role === "admin";
  const [showRate, setShowRate] = useState(true);
  const totalPcs = (design.colors||[]).reduce((a,c) => a+Object.values(c.sizes||{}).reduce((x,v) => x+(+v||0), 0), 0);
  const procs = design.processes || {};
  // Derive jobber + recd/sent dates per process from challans (linked, auto-fill)
  const fromChallan = {}; // process -> { jobberId, recdDate, sentDate, jobberName }
  (challans||[]).forEach(c => {
    if (c.status==="rejected") return;
    const lns = (c.lines && c.lines.length) ? c.lines : [{ designNo:c.designNo, process:c.process, qty:c.qty, receivedFrom:c.receivedFrom, sentToId:c.sendToId, receivedDate:c.receivedDate, sentDate:c.sentDate }];
    lns.forEach(l => {
      if (String(l.designNo)!==String(design.designNo)) return;
      const proc = PROCESSES.find(p => (l.process||"").toLowerCase().includes(p.toLowerCase()) || p.toLowerCase().includes((l.process||"").toLowerCase()));
      if (!proc || !l.process) return;
      // the jobber who DID this process is the challan's jobber
      fromChallan[proc] = { jobberId:c.jobberId, recdDate:l.receivedDate||c.receivedDate||"", sentDate:l.sentDate||c.sentDate||"", jobberName:(jobbers.find(j=>j.id===c.jobberId)||{}).name||"", receivedFrom:l.receivedFrom||c.receivedFrom||"", sentToName:(jobbers.find(j=>j.id===(l.sentToId||c.sendToId))||{}).name||"" };
    });
  });
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
            const auto = fromChallan[p] || {};
            const splits = proc.splits || [];
            const effJobberId = proc.jobber || auto.jobberId || "";
            const jobber = jobbers.find(j => j.id===effJobberId);
            const jName = jobber?.name || "—";
            const linkedFromChallan = !proc.jobber && !!auto.jobberId;
            const effRecd = proc.recdDate || auto.recdDate || "";
            const effDlvd = proc.dlvdDate || auto.sentDate || "";
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
                      ? <><select value={proc.jobber||""} onChange={e => onUpdate(p,"jobber",e.target.value)} style={{ background:T.bg, border:`1px solid ${linkedFromChallan?T.green:T.border}`, color:T.text, borderRadius:4, padding:"4px 6px", fontSize:11, width:"100%" }}>
                          <option value="">{linkedFromChallan?`↳ ${auto.jobberName} (from challan)`:"— select —"}</option>
                          <optgroup label={`Does ${p}`}>
                            {jobbers.filter(j => jobberDoesProcess(j,p)).map(j => <option key={j.id} value={j.id}>{j.name} ({codeForProcess(j,p)})</option>)}
                          </optgroup>
                          <optgroup label="All others">
                            {jobbers.filter(j => !jobberDoesProcess(j,p)).map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
                          </optgroup>
                        </select>
                        {linkedFromChallan && <div style={{ fontFamily:T.mono, fontSize:8, color:T.green, marginTop:2 }}>auto from challan · editable</div>}</>
                      : <span style={{ color:T.text, padding:"8px 10px", display:"block" }}>{jName}</span>
                    }
                    {(auto.receivedFrom || auto.sentToName || effRecd || effDlvd) && (
                      <div style={{ fontFamily:T.mono, fontSize:8, color:T.steelLt, marginTop:3, lineHeight:1.6, paddingLeft:2 }}>
                        {(auto.receivedFrom||effRecd) && <div>↳ from: <b style={{color:T.text}}>{auto.receivedFrom||"—"}</b>{effRecd?` · ${String(effRecd).split("-").reverse().join("-")}`:""}</div>}
                        {(auto.sentToName||effDlvd) && <div>→ to: <b style={{color:T.text}}>{auto.sentToName||"—"}</b>{effDlvd?` · ${String(effDlvd).split("-").reverse().join("-")}`:""}</div>}
                      </div>
                    )}
                  </td>
                  {isAdmin && (
                    <>
                      <td style={{ padding:"4px 6px" }}>{showRate ? <input type="number" value={proc.rate||""} onChange={e => onUpdate(p,"rate",e.target.value)} placeholder="0" style={{ background:T.bg, border:`1px solid ${T.border}`, color:T.gold, borderRadius:4, padding:"4px 6px", fontSize:11, width:60, fontFamily:T.mono }} /> : <span style={{ color:T.textDim, fontFamily:T.mono }}>••••</span>}</td>
                      <td style={{ padding:"8px 10px", fontFamily:T.mono, color:T.gold, fontWeight:700 }}>{showRate ? (code||"—") : "••••"}</td>
                      <td style={{ padding:"4px 6px" }}><input type="date" value={proc.recdDate||auto.recdDate||""} onChange={e => onUpdate(p,"recdDate",e.target.value)} style={{ background:T.bg, border:`1px solid ${(!proc.recdDate&&auto.recdDate)?T.green:T.border}`, color:T.text, borderRadius:4, padding:"4px 6px", fontSize:11 }} /></td>
                      <td style={{ padding:"4px 6px" }}><input type="date" value={proc.dlvdDate||auto.sentDate||""} onChange={e => onUpdate(p,"dlvdDate",e.target.value)} style={{ background:T.bg, border:`1px solid ${(!proc.dlvdDate&&auto.sentDate)?T.green:T.border}`, color:T.text, borderRadius:4, padding:"4px 6px", fontSize:11 }} /></td>
                      <td style={{ padding:"8px 10px", fontFamily:T.mono, color:T.steelLt }}>{daysBetween(effRecd, effDlvd) ?? "—"}</td>
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
    const dLines = (c.lines||[]).filter(l => String(l.designNo)===String(design.designNo) && !l.halfStitch);
    if (dLines.length) dLines.forEach(l => myCh.push({ ...l, date:c.date, challanNo:c.challanNo, jobberId:c.jobberId, status:c.status }));
    else if (!c.halfStitch && !(c.lines||[]).length) myCh.push({ designNo:c.designNo, process:c.process, qty:c.qty, rate:c.rate, amount:c.amount, date:c.date, challanNo:c.challanNo, jobberId:c.jobberId, status:c.status });
  });
  const chTotal = myCh.reduce((a,c)=>a+(+c.amount||0),0);
  const jn = id => (jobbers.find(j=>j.id===id)||{}).name || id || "—";
  let grand = 0;
  const fabricTotal = (design.supplierBills||[]).reduce((a,b) => a+(+b.amount||0), 0);
  const transportTotal = (design.supplierBills||[]).reduce((a,b) => a+(+b.transportCost||0), 0);
  grand += fabricTotal;
  grand += transportTotal;
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
            <td style={{ padding:"10px", color:T.steelLt }}>{[...new Set((design.supplierBills||[]).map(b=>b.supplier).filter(Boolean))].join(", ") || design.supplier || "—"}</td>
            <td style={{ padding:"10px", color:T.steelLt }}>{(design.supplierBills||[])[0]?.billDate||"—"}</td>
            <td style={{ padding:"10px", color:T.steelLt }}>{(design.supplierBills||[])[0]?.billNo||"—"}</td>
            <td colSpan={2} style={{ padding:"10px", color:T.steelLt }}>—</td>
            <td style={{ padding:"10px", color:T.white, fontFamily:T.mono }}>Rs.{fabricTotal.toFixed(2)}</td>
            <td colSpan={2} style={{ padding:"10px", color:T.steelLt, fontFamily:T.mono }}>Fabric/pc: Rs.{totalPcs>0?Math.ceil(fabricTotal/totalPcs):0}</td>
          </tr>
          {transportTotal>0 && (
            <tr style={{ borderBottom:`1px solid ${T.border}` }}>
              <td style={{ padding:"10px", color:T.text, fontWeight:600 }}>Transport / Freight</td>
              <td colSpan={5} style={{ padding:"10px", color:T.steelLt }}>{(design.supplierBills||[]).filter(b=>+b.transportCost>0).map(b=>b.transporter||"transport").join(", ")||"—"}</td>
              <td style={{ padding:"10px", color:T.white, fontFamily:T.mono }}>Rs.{transportTotal.toFixed(2)}</td>
              <td colSpan={2} style={{ padding:"10px", color:T.steelLt, fontFamily:T.mono }}>Transport/pc: Rs.{totalPcs>0?Math.ceil(transportTotal/totalPcs):0}</td>
            </tr>
          )}
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
          {/* ── Trims / Accessories (design creation ke rates: Label, Button, Tag, + Other) ── */}
          {(design.specs||[]).filter(sp => +sp.rate > 0).map((sp,i) => {
            const amt = +((+sp.rate) * totalPcs).toFixed(2);
            grand += amt;
            return (
              <tr key={"trim"+i} style={{ borderBottom:`1px solid ${T.border}`, background:T.card }}>
                <td style={{ padding:"10px", color:T.text, fontWeight:600 }}>{sp.key}{sp.text?<span style={{ color:T.steelLt, fontWeight:400, fontSize:11 }}> · {sp.text}</span>:null}</td>
                <td style={{ padding:"10px", color:T.steelLt }}>—</td>
                <td style={{ padding:"10px", color:T.steelLt }}>—</td>
                <td style={{ padding:"10px", color:T.steelLt }}>—</td>
                <td style={{ padding:"10px", color:T.gold, fontFamily:T.mono }}>Rs.{sp.rate}</td>
                <td style={{ padding:"10px", color:T.text, fontFamily:T.mono }}>{totalPcs}</td>
                <td style={{ padding:"10px", color:T.white, fontFamily:T.mono }}>Rs.{amt}</td>
                <td style={{ padding:"10px", color:T.steelLt }}>—</td>
                <td style={{ padding:"10px", color:T.steelLt }}>—</td>
              </tr>
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
function rowToB(r) {
  return { id:r.id, customer:r.customer||"", designNo:r.design_no||"", color:r.color||"", sizes:r.sizes||{}, bookingDate:r.booking_date||"", deliveryDate:r.delivery_date||"", notes:r.notes||"", total:r.total||0, createdBy:r.created_by||"", createdAtStr:r.created_at_str||"",
    orderType:r.order_type||"app", orderNo:r.order_no||"", externalRef:r.external_ref||"", agent:r.agent||"", source:r.source||"", sourcePlace:r.source_place||"",
    advanceAmount:r.advance_amount||0, advanceType:r.advance_type||"", advanceDate:r.advance_date||"", advanceRef:r.advance_ref||"",
    lines:r.lines||[], customerId:r.customer_id||"",
    company:r.company||"", mobile:r.mobile||"", whatsapp:r.whatsapp||"", email:r.email||"", gstin:r.gstin||"",
    billingAddress:r.billing_address||"", shippingAddress:r.shipping_address||"", salesExec:r.sales_exec||"",
    transport:r.transport||"", destination:r.destination||"", paymentTerms:r.payment_terms||"",
    status:r.status||"Pending", priority:r.priority||"Normal", specialInstructions:r.special_instructions||"", hasDelivery:!!r.has_delivery };
}
function bToRow(b) {
  return { id:b.id, customer:b.customer||"", customer_id:b.customerId||"", design_no:b.designNo||"", color:b.color||"", sizes:b.sizes||{}, booking_date:b.bookingDate||"", delivery_date:b.deliveryDate||"", notes:b.notes||"", total:b.total||0, created_by:b.createdBy||"", created_at_str:b.createdAtStr||"",
    order_type:b.orderType||"app", order_no:b.orderNo||"", external_ref:b.externalRef||"", agent:b.agent||"", source:b.source||"", source_place:b.sourcePlace||"",
    advance_amount:b.advanceAmount||0, advance_type:b.advanceType||"", advance_date:b.advanceDate||"", advance_ref:b.advanceRef||"",
    lines:b.lines||[],
    company:b.company||"", mobile:b.mobile||"", whatsapp:b.whatsapp||"", email:b.email||"", gstin:b.gstin||"",
    billing_address:b.billingAddress||"", shipping_address:b.shippingAddress||"", sales_exec:b.salesExec||"",
    transport:b.transport||"", destination:b.destination||"", payment_terms:b.paymentTerms||"",
    status:b.status||"Pending", priority:b.priority||"Normal", special_instructions:b.specialInstructions||"", has_delivery:!!b.hasDelivery };
}

// ── Bills + Payments converters ───────────────────────────────────────────────
function billToRow(b) {
  return { id:b.id, jobber_id:b.jobberId||"", bill_no:b.billNo||"", bill_date:b.billDate||"", lines:b.lines||[], gross:b.gross||0, gst_pct:b.gstPct??5, gst_amt:b.gstAmt||0, round_off:b.roundOff||0, total:b.total||0, has_gst:!!b.hasGst, created_by:b.createdBy||"", created_at_str:b.createdAtStr||"", status:b.status||"approved" };
}
function rowToBill(r) {
  return { id:r.id, jobberId:r.jobber_id||"", billNo:r.bill_no||"", billDate:r.bill_date||"", lines:r.lines||[], gross:r.gross||0, gstPct:r.gst_pct??5, gstAmt:r.gst_amt||0, roundOff:r.round_off||0, total:r.total||0, hasGst:!!r.has_gst, createdBy:r.created_by||"", createdAtStr:r.created_at_str||"", status:r.status||"approved" };
}
// Credit note: party_type "jobber" or "supplier"; party = jobberId or supplier name
function cnToRow(c) {
  return { id:c.id, party_type:c.partyType||"jobber", party:c.party||"", cn_no:c.cnNo||"", cn_date:c.cnDate||"", reason:c.reason||"", lines:c.lines||[], total:c.total||0, created_by:c.createdBy||"", created_at_str:c.createdAtStr||"" };
}
function rowToCn(r) {
  return { id:r.id, partyType:r.party_type||"jobber", party:r.party||"", cnNo:r.cn_no||"", cnDate:r.cn_date||"", reason:r.reason||"", lines:r.lines||[], total:r.total||0, createdBy:r.created_by||"", createdAtStr:r.created_at_str||"" };
}
function cnDesignNos(c) { return [...new Set((c.lines||[]).map(l=>String(l.designNo)).filter(Boolean))]; }
function cnBillNos(c) { return [...new Set((c.lines||[]).map(l=>String(l.billNo||"")).filter(Boolean))]; }
// Fabric bill amount WITH GST (taxable + GST). Cost sheet uses without-GST; ledger/supplier balance uses this.
function billTotalWithGST(b) {
  const taxable = +b.amount||0;
  const rate = +b.gstRate||0;
  const rawTotal = taxable + (taxable*rate/100);
  const roundOff = (b.roundOff!==undefined && b.roundOff!=="") ? +b.roundOff : (Math.round(rawTotal)-rawTotal);
  return rawTotal + roundOff;
}
function payToRow(p) {
  return { id:p.id, jobber_id:p.jobberId||"", date:p.date||"", amount:p.amount||0, mode:p.mode||"", channel:p.channel||"bank", note:p.note||"", created_by:p.createdBy||"", created_at_str:p.createdAtStr||"", confirmed:!!p.confirmed, confirm_text:p.confirmText||"", confirm_date:p.confirmDate||"" };
}
function rowToPay(r) {
  return { id:r.id, jobberId:r.jobber_id||"", date:r.date||"", amount:r.amount||0, mode:r.mode||"", channel:r.channel||"bank", note:r.note||"", createdBy:r.created_by||"", createdAtStr:r.created_at_str||"", confirmed:!!r.confirmed, confirmText:r.confirm_text||"", confirmDate:r.confirm_date||"" };
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
  return { id:n.id, ts:n.ts||"", who:n.who||"", message:n.message||"", design_id:n.designId||"", for_user:n.forUser||"", read_by:n.readBy||[] };
}
function rowToNotif(r) {
  return { id:r.id, ts:r.ts||"", who:r.who||"", message:r.message||"", designId:r.design_id||"", forUser:r.for_user||"", readBy:r.read_by||[] };
}

// Build a minimal placeholder design from a challan (admin completes details later)
function makePlaceholderDesign(challan, currentUser) {
  return {
    id:`D${Date.now()}`, designNo: challan.designNo||"", lotNo:"", sleeveType:"Full",
    brand:"RUDE INC", style:"", fabric:"", supplier:"",
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
  return { id:c.id, jobber_id:c.jobberId||"", design_no:c.designNo||"", process:c.process||"", qty:c.qty||0, rate:c.rate||0, amount:c.amount||0, lines:c.lines||[], date:c.date||"", received_date:c.receivedDate||"", sent_date:c.sentDate||"", received_from:c.receivedFrom||"", challan_no:c.challanNo||"", photo:c.photo||"", status:c.status||"pending", billed:!!c.billed, bill_id:c.billId||"", send_to_id:c.sendToId||"", is_split:!!c.isSplit, gst_pct:c.gstPct??0, half_stitch:!!c.halfStitch, created_by:c.createdBy||"", created_at_str:c.createdAtStr||"", edit_req_pending:!!c.editReqPending, edit_approved:!!c.editApproved, edited_once:!!c.editedOnce, edit_reason:c.editReason||"" };
}
function rowToChallan(r) {
  const c = { id:r.id, jobberId:r.jobber_id||"", designNo:r.design_no||"", process:r.process||"", qty:r.qty||0, rate:r.rate||0, amount:r.amount||0, lines:r.lines||[], date:r.date||"", receivedDate:r.received_date||"", sentDate:r.sent_date||"", receivedFrom:r.received_from||"", challanNo:r.challan_no||"", photo:r.photo||"", status:r.status||"pending", billed:!!r.billed, billId:r.bill_id||"", sendToId:r.send_to_id||"", isSplit:!!r.is_split, gstPct:r.gst_pct??0, halfStitch:!!r.half_stitch, createdBy:r.created_by||"", createdAtStr:r.created_at_str||"", editReqPending:!!r.edit_req_pending, editApproved:!!r.edit_approved, editedOnce:!!r.edited_once, editReason:r.edit_reason||"" };
  // back-compat: if no lines array but has single design, synthesize one line
  if ((!c.lines || c.lines.length===0) && c.designNo) c.lines = [{ designNo:c.designNo, process:c.process, qty:c.qty, rate:c.rate, amount:c.amount }];
  return c;
}
// helpers for multi-design challans
function challanDesigns(c) { return (c.lines && c.lines.length) ? [...new Set(c.lines.map(l=>String(l.designNo)).filter(Boolean))] : (c.designNo?[String(c.designNo)]:[]); }
function challanTotal(c) { if (c.halfStitch) return 0; return (c.lines && c.lines.length) ? c.lines.reduce((a,l)=>a+(+l.amount||0),0) : (+c.amount||0); }
function challanTotalWithGST(c) { if (c.halfStitch) return 0; const base = challanTotal(c); const rate = +c.gstPct||0; return base + (base*rate/100); }
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
function recordNotification(who, message, designId, forUser) {
  const entry = { id:`NOT${Date.now()}${Math.floor(Math.random()*1000)}`, ts:nowStr(), who:who||"", message:message||"", designId:designId||"", forUser:forUser||"", readBy:[] };
  if (_notifSink) _notifSink(entry);
  dbUpsert("notifications", notifToRow(entry), true);
}

function BookingsPanel({ bookings, setBookings, designs, showToast, currentUser }) {
  const [view, setView] = useState("list");
  const [selId, setSelId] = useState(null);
  const [summaryTab, setSummaryTab] = useState("customer");
  const [searchQ, setSearchQ] = useState("");
  const [customers, setCustomers] = useState([]);
  const [editId, setEditId] = useState(null);
  const [detailedPrint, setDetailedPrint] = useState(false);
  const [cutDesign, setCutDesign] = useState("");

  useEffect(() => { loadCustList(); }, []);
  async function loadCustList() {
    try { const r = await dbSelect("customers"); setCustomers((r||[]).map(c=>({ id:c.id, name:c.name||"", gstin:c.gst||"", address:c.address||"", phone:c.phone||"", transport:c.transport||"", paymentTerms:c.payment_terms||"" }))); } catch(e) {}
  }

  const STATUSES=["Pending","Production","Stitching","Packing","Ready","Dispatched","Delivered","Cancelled"];
  const SOURCES=["","WhatsApp","Fair/Exhibition","Phone Call","Email","Walk-in","Agent/Distributor","Other"];
  const ADV=["","Cash","Cheque","Online"];
  const DEFAULT_NOTE="* Forward order — MRP may vary ±₹100–200.";

  function daysLeft(d){ if(!d) return null; const x=new Date(d),n=new Date(); n.setHours(0,0,0,0); x.setHours(0,0,0,0); return Math.round((x-n)/86400000); }
  function alertColor(dl){ if(dl===null) return null; if(dl<0) return "#7B1D1D"; if(dl<=3) return T.red; if(dl<=10) return T.orange; return T.green; }
  function alertLabel(dl){ if(dl===null) return ""; if(dl<0) return `⛔ ${Math.abs(dl)}d overdue`; if(dl===0) return "🔴 Due today"; if(dl<=3) return `🔴 ${dl}d`; if(dl<=10) return `🟡 ${dl}d`; return `🟢 ${dl}d`; }

  function nextOrderNo(){
    const t=new Date(), p=`${String(t.getDate()).padStart(2,"0")}${String(t.getMonth()+1).padStart(2,"0")}${t.getFullYear()}`;
    return `${p}-${String(bookings.filter(b=>(b.orderNo||"").startsWith(p)).length+1).padStart(3,"0")}`;
  }
  function blankLine(){ return { id:`L${Date.now()}${Math.random().toString(36).slice(2,5)}`, designNo:"", colour:"", mrp:"", remark:"", sizes:{}, deliveryDate:"", hasDelivery:false, status:"Pending" }; }
  function blankForm(){ return { orderType:"app", orderNo:nextOrderNo(), externalRef:"", agent:"", source:"", sourcePlace:"",
    customer:"", customerId:"", company:"", mobile:"", whatsapp:"", email:"", gstin:"", billingAddress:"", shippingAddress:"",
    salesExec:"", transport:"", destination:"", paymentTerms:"", status:"Pending", priority:"Normal",
    bookingDate:new Date().toISOString().slice(0,10), advanceAmount:"", advanceType:"", advanceDate:"", advanceRef:"",
    specialInstructions:"", notes:"", lines:[blankLine()] }; }
  const [form, setForm] = useState(blankForm);
  const [custNew, setCustNew] = useState(false);
  const [extraSizes, setExtraSizes] = useState([]);

  const activeSizes = [...SIZES, ...extraSizes];

  // ---- line helpers ----
  function addLine(){ setForm(f=>({...f, lines:[...f.lines, blankLine()]})); }
  function remLine(id){ setForm(f=>({...f, lines:f.lines.length>1?f.lines.filter(l=>l.id!==id):f.lines})); }
  function updLine(id,k,v){ setForm(f=>({...f, lines:f.lines.map(l=>l.id!==id?l:{...l,[k]:v})})); }
  function updSize(id,sz,v){ setForm(f=>({...f, lines:f.lines.map(l=>l.id!==id?l:{...l, sizes:{...l.sizes,[sz]:v}})})); }
  // colour field me comma se kai colours ho sakte hain (e.g. "1,2,3") — total un sab ka
  function colourList(l){ return String(l.colour||"").split(",").map(c=>c.trim()).filter(Boolean); }
  function colourCount(l){ const n=colourList(l).length; return n>0?n:1; }
  function lineSizeSum(l){ return activeSizes.reduce((a,s)=>a+(+(l.sizes||{})[s]||0),0); }
  function lineTotal(l){ return lineSizeSum(l)*colourCount(l); }
  function orderTotal(lines){ return (lines||[]).reduce((a,l)=>a+lineTotal(l),0); }
  // sort lines: design, then colour (numeric-aware)
  function sortedLines(lines){
    const key=v=>{ const n=parseFloat(String(v).replace(/[^\d.]/g,"")); return isNaN(n)?Infinity:n; };
    return [...(lines||[])].sort((a,b)=>{
      const da=key(a.designNo), db=key(b.designNo);
      if(da!==db) return da-db;
      if(String(a.designNo)!==String(b.designNo)) return String(a.designNo).localeCompare(String(b.designNo));
      const ca=key(a.colour), cb=key(b.colour);
      if(ca!==cb) return ca-cb;
      return String(a.colour).localeCompare(String(b.colour));
    });
  }
  // auto-fill design details when typed
  function autoFillDesign(id, dn){
    updLine(id,"designNo",dn);
    const d=(designs||[]).find(x=>String(x.designNo).trim()===String(dn).trim());
    if(d){ setForm(f=>({...f, lines:f.lines.map(l=>l.id!==id?l:{...l, designNo:dn, mrp:l.mrp||d.p1MRP||d.p2MRP||""})})); }
  }

  // ---- customer ----
  function custSugg(){ const q=(form.customer||"").trim().toLowerCase(); if(!q) return []; return customers.filter(c=>(c.name||"").toLowerCase().includes(q)).slice(0,6); }
  function pickCustomer(c){ setForm(f=>({...f, customer:c.name, customerId:c.id, gstin:c.gstin||f.gstin, mobile:c.phone||f.mobile, billingAddress:c.address||f.billingAddress, transport:c.transport||f.transport, paymentTerms:c.paymentTerms||f.paymentTerms })); setCustNew(false); }
  async function saveCustomer(){
    const nm=(form.customer||"").trim(); if(!nm){ showToast("Customer naam likho","error"); return; }
    const ex=customers.find(c=>(c.name||"").trim().toLowerCase()===nm.toLowerCase());
    const id=ex?ex.id:`C${Date.now()}`;
    const row={ id, name:nm, gst:form.gstin||null, address:form.billingAddress||null, phone:form.mobile||null, transport:form.transport||null, payment_terms:form.paymentTerms||null };
    await dbUpsert("customers", row);
    setCustomers(p=> ex ? p.map(c=>c.id===id?{...c,name:nm,gstin:form.gstin,address:form.billingAddress,phone:form.mobile,transport:form.transport,paymentTerms:form.paymentTerms}:c) : [...p,{id,name:nm,gstin:form.gstin,address:form.billingAddress,phone:form.mobile,transport:form.transport,paymentTerms:form.paymentTerms}]);
    setForm(f=>({...f,customerId:id})); setCustNew(false); showToast("Customer saved ✓");
  }

  async function saveOrder(){
    if(!(form.customer||"").trim()){ showToast("Customer zaroori hai","error"); return; }
    const no=form.orderType==="app"?form.orderNo:(form.externalRef||form.orderNo);
    if(!no){ showToast("Order no zaroori hai","error"); return; }
    if(bookings.find(b=>b.id!==editId && (b.orderNo||"")===form.orderNo && form.orderType==="app")){ showToast("Order no already exists!","error"); return; }
    const lines=sortedLines(form.lines).filter(l=>l.designNo||lineTotal(l)>0);
    const b={ ...form, lines, id:editId||`BK${Date.now()}`, total:orderTotal(lines), createdBy:currentUser, createdAtStr:nowStr() };
    await dbUpsert("bookings", bToRow(b));
    if(editId) setBookings(p=>p.map(x=>x.id===editId?b:x)); else setBookings(p=>[b,...p]);
    recordActivity(currentUser, editId?"Edited order":"New order", `${b.orderNo}`, `${b.customer} · ${b.total} pcs`);
    showToast(editId?"Order updated ✓":"Order saved ✓");
    setForm(blankForm()); setEditId(null); setView("list");
  }
  async function delOrder(id){ if(!window.confirm("Delete this order?")) return; await dbDelete("bookings",id); setBookings(p=>p.filter(b=>b.id!==id)); setView("list"); showToast("Deleted"); }
  function startEdit(b){ setForm({...blankForm(), ...b, lines:(b.lines&&b.lines.length?b.lines:[blankLine()])}); setEditId(b.id); setView("new"); }
  function duplicateOrder(b){ setForm({...blankForm(), ...b, orderNo:nextOrderNo(), id:undefined, lines:(b.lines||[]).map(l=>({...l,id:`L${Date.now()}${Math.random().toString(36).slice(2,5)}`}))}); setEditId(null); setView("new"); showToast("Duplicated — save karo"); }

  // sizes actually used in an order (for print)
  function usedSizes(lines){ return activeSizes.filter(s=>(lines||[]).some(l=>+(l.sizes||{})[s]>0)); }

  const th={ padding:"7px 6px", fontFamily:T.mono, fontSize:9, color:T.steelLt, textTransform:"uppercase", border:`1px solid ${T.border}`, background:T.surface, textAlign:"center", whiteSpace:"nowrap" };
  const td={ padding:"3px 4px", border:`1px solid ${T.border}`, textAlign:"center" };
  const cellIn={ background:T.bg, border:"none", color:T.text, fontFamily:T.mono, fontSize:12, width:38, padding:"6px 2px", textAlign:"center", outline:"none" };
  const txtIn={ background:T.bg, border:"none", color:T.text, fontFamily:T.mono, fontSize:12, padding:"6px 6px", width:"100%", boxSizing:"border-box", outline:"none" };

  // ═══════════ NEW / EDIT ORDER ═══════════
  if(view==="new") return (
    <div>
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14, flexWrap:"wrap" }}>
        <Btn label="← Back" onClick={()=>{ setView("list"); setForm(blankForm()); setEditId(null); }} color={T.surface} textColor={T.steelLt} small />
        <div style={{ fontFamily:T.mono, fontWeight:700, fontSize:15, color:T.gold }}>{editId?"Edit Order":"New Order"}</div>
      </div>

      {/* ORDER INFO */}
      <div style={{ background:T.card, borderRadius:12, padding:16, marginBottom:12, border:`1px solid ${T.border}` }}>
        <div style={{ fontFamily:T.mono, fontSize:9, color:T.gold, textTransform:"uppercase", letterSpacing:1, marginBottom:10 }}>Order Info</div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:10 }}>
          {["app","external"].map(t=>(
            <button key={t} onClick={()=>setForm(f=>({...f,orderType:t}))} style={{ background:form.orderType===t?T.gold:T.surface, color:form.orderType===t?"#fff":T.steelLt, border:`1px solid ${form.orderType===t?T.gold:T.border}`, borderRadius:20, padding:"5px 16px", fontFamily:T.mono, fontSize:11, fontWeight:700, cursor:"pointer" }}>{t==="app"?"App Order":"External Order"}</button>
          ))}
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))", gap:8 }}>
          <Inp label="Order No" value={form.orderNo} onChange={v=>setForm(f=>({...f,orderNo:v}))} />
          <Inp label="Order Date" type="date" value={form.bookingDate} onChange={v=>setForm(f=>({...f,bookingDate:v}))} />
          <Inp label="Status" value={form.status} onChange={v=>setForm(f=>({...f,status:v}))} options={STATUSES} />
          <Inp label="Priority" value={form.priority} onChange={v=>setForm(f=>({...f,priority:v}))} options={["Normal","Urgent"]} />
          {form.orderType==="external" && <>
            <Inp label="External Ref No" value={form.externalRef} onChange={v=>setForm(f=>({...f,externalRef:v}))} />
            <Inp label="Agent" value={form.agent} onChange={v=>setForm(f=>({...f,agent:v}))} />
            <Inp label="Source" value={form.source} onChange={v=>setForm(f=>({...f,source:v}))} options={SOURCES} />
            <Inp label="Place" value={form.sourcePlace} onChange={v=>setForm(f=>({...f,sourcePlace:v}))} />
          </>}
        </div>
      </div>

      {/* CUSTOMER */}
      <div style={{ background:T.card, borderRadius:12, padding:16, marginBottom:12, border:`1px solid ${T.border}` }}>
        <div style={{ fontFamily:T.mono, fontSize:9, color:T.gold, textTransform:"uppercase", letterSpacing:1, marginBottom:10 }}>Customer Details</div>
        <div style={{ position:"relative", marginBottom:8 }}>
          <Inp label="Customer Name *" value={form.customer} onChange={v=>{ setForm(f=>({...f,customer:v,customerId:""})); }} placeholder="type karo…" />
          {custSugg().length>0 && (
            <div style={{ position:"absolute", top:"100%", left:0, right:0, background:T.card, border:`1px solid ${T.gold}`, borderRadius:8, zIndex:30, boxShadow:"0 8px 24px rgba(90,60,140,.2)" }}>
              {custSugg().map(c=><div key={c.id} onClick={()=>pickCustomer(c)} style={{ padding:"9px 12px", cursor:"pointer", borderBottom:`1px solid ${T.border}`, fontSize:13, color:T.text }}><b>{c.name}</b>{c.gstin?<span style={{color:T.steelLt,fontSize:11}}> · {c.gstin}</span>:null}</div>)}
            </div>
          )}
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))", gap:8, marginBottom:10 }}>
          <Inp label="Company" value={form.company} onChange={v=>setForm(f=>({...f,company:v}))} />
          <Inp label="Mobile" value={form.mobile} onChange={v=>setForm(f=>({...f,mobile:v}))} />
          <Inp label="Email" value={form.email} onChange={v=>setForm(f=>({...f,email:v}))} />
          <Inp label="Sales Executive" value={form.salesExec} onChange={v=>setForm(f=>({...f,salesExec:v}))} />
        </div>
        <label style={{ display:"flex", alignItems:"center", gap:6, fontFamily:T.mono, fontSize:11, color:T.text, cursor:"pointer", marginBottom:8 }}>
          <input type="checkbox" checked={!!form.diffWhatsapp} onChange={e=>setForm(f=>({...f,diffWhatsapp:e.target.checked}))} style={{ width:15, height:15, accentColor:T.gold }} />
          WhatsApp number mobile se alag hai
        </label>
        {form.diffWhatsapp && <div style={{ marginBottom:10, maxWidth:200 }}><Inp label="WhatsApp Number" value={form.whatsapp} onChange={v=>setForm(f=>({...f,whatsapp:v}))} /></div>}

        <div style={{ background:T.bg, borderRadius:8, padding:12, border:`1px solid ${T.border}`, marginBottom:10 }}>
          <div style={{ fontFamily:T.mono, fontSize:9, color:T.steelLt, textTransform:"uppercase", letterSpacing:1, marginBottom:8 }}>Billing</div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))", gap:8 }}>
            <div style={{ gridColumn:"1 / -1" }}><Inp label="Address" value={form.billingAddress} onChange={v=>setForm(f=>({...f,billingAddress:v}))} /></div>
            <Inp label="GST" value={form.gstin} onChange={v=>setForm(f=>({...f,gstin:v.toUpperCase()}))} />
            <Inp label="Transport" value={form.transport} onChange={v=>setForm(f=>({...f,transport:v}))} />
            <Inp label="Destination" value={form.destination} onChange={v=>setForm(f=>({...f,destination:v}))} />
            <Inp label="Payment Terms" value={form.paymentTerms} onChange={v=>setForm(f=>({...f,paymentTerms:v}))} placeholder="e.g. 30 days" />
          </div>
        </div>

        <div style={{ background:T.bg, borderRadius:8, padding:12, border:`1px solid ${T.border}` }}>
          <div style={{ fontFamily:T.mono, fontSize:9, color:T.steelLt, textTransform:"uppercase", letterSpacing:1, marginBottom:8 }}>Shipping</div>
          <label style={{ display:"flex", alignItems:"center", gap:6, fontFamily:T.mono, fontSize:11, color:T.text, cursor:"pointer", marginBottom:8 }}>
            <input type="checkbox" checked={form.shipSameAsBilling!==false} onChange={e=>setForm(f=>({...f,shipSameAsBilling:e.target.checked, shippingAddress:e.target.checked?f.billingAddress:f.shippingAddress}))} style={{ width:15, height:15, accentColor:T.gold }} />
            Same as billing address
          </label>
          {form.shipSameAsBilling===false && <Inp label="Shipping Address" value={form.shippingAddress} onChange={v=>setForm(f=>({...f,shippingAddress:v}))} />}
        </div>
        <div style={{ marginTop:10 }}><Btn label="💾 Save Customer" onClick={saveCustomer} color={T.surface} textColor={T.gold} small /></div>
      </div>

      {/* ORDER ITEMS TABLE */}
      <div style={{ background:T.card, borderRadius:12, padding:16, marginBottom:12, border:`1px solid ${T.border}` }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10, flexWrap:"wrap", gap:8 }}>
          <div style={{ fontFamily:T.mono, fontSize:9, color:T.gold, textTransform:"uppercase", letterSpacing:1 }}>Order Items</div>
          <div style={{ display:"flex", gap:6 }}>
            <Btn label="+ Size" onClick={()=>{ const s=window.prompt("Naya size (e.g. 11XL):"); if(s&&!activeSizes.includes(s.toUpperCase())) setExtraSizes(p=>[...p,s.toUpperCase()]); }} color={T.surface} textColor={T.steelLt} small />
            <Btn label="+ Add Line" onClick={addLine} small />
          </div>
        </div>
        <div style={{ overflowX:"auto" }}>
          <table style={{ borderCollapse:"collapse", width:"100%", minWidth:900 }}>
            <thead><tr>
              <th style={{...th, width:28}}>#</th>
              <th style={{...th, minWidth:80}}>Design</th>
              <th style={{...th, minWidth:80}}>Colour</th>
              <th style={{...th, minWidth:70}}>MRP</th>
              <th style={{...th, minWidth:90}}>Remark</th>
              {activeSizes.map(s=><th key={s} style={{...th, width:40}}>{s}</th>)}
              <th style={{...th, width:52}}>Total</th>
              <th style={{...th, width:34}}></th>
            </tr></thead>
            <tbody>
              {form.lines.map((l,i)=>(
                <tr key={l.id} style={{ background: i%2?T.surface:T.bg }}>
                  <td style={{...td, fontFamily:T.mono, fontSize:11, color:T.steelLt}}>{i+1}</td>
                  <td style={td}><input value={l.designNo} onChange={e=>autoFillDesign(l.id,e.target.value)} list="bk-designs" placeholder="design" style={txtIn} /></td>
                  <td style={td}><input value={l.colour} onChange={e=>updLine(l.id,"colour",e.target.value)} placeholder="colour" style={txtIn} /></td>
                  <td style={td}><input type="number" value={l.mrp} onChange={e=>updLine(l.id,"mrp",e.target.value)} placeholder="₹" style={txtIn} /></td>
                  <td style={td}><input value={l.remark} onChange={e=>updLine(l.id,"remark",e.target.value)} placeholder="remark" style={txtIn} /></td>
                  {activeSizes.map(s=>(
                    <td key={s} style={td}><input type="number" value={(l.sizes||{})[s]||""} onChange={e=>updSize(l.id,s,e.target.value)} style={cellIn} /></td>
                  ))}
                  <td style={{...td, fontFamily:T.mono, fontSize:13, fontWeight:700, color:T.gold}}>{lineTotal(l)||""}</td>
                  <td style={td}><span onClick={()=>remLine(l.id)} style={{ color:T.red, cursor:"pointer", fontSize:14 }}>✕</span></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr style={{ background:T.surface }}>
              <td colSpan={5} style={{...td, textAlign:"right", fontFamily:T.mono, fontSize:11, color:T.steelLt, paddingRight:10}}>TOTAL</td>
              {activeSizes.map(s=><td key={s} style={{...td, fontFamily:T.mono, fontSize:11, color:T.steelLt}}>{form.lines.reduce((a,l)=>a+(+(l.sizes||{})[s]||0)*colourCount(l),0)||""}</td>)}
              <td style={{...td, fontFamily:T.mono, fontSize:14, fontWeight:900, color:T.gold}}>{orderTotal(form.lines)}</td>
              <td style={td}></td>
            </tr></tfoot>
          </table>
        </div>
        <datalist id="bk-designs">{(designs||[]).map(d=><option key={d.id} value={d.designNo} />)}</datalist>
      </div>

      {/* DELIVERY + ADVANCE + NOTES */}
      <div style={{ background:T.card, borderRadius:12, padding:16, marginBottom:12, border:`1px solid ${T.border}` }}>
        <div style={{ fontFamily:T.mono, fontSize:9, color:T.gold, textTransform:"uppercase", letterSpacing:1, marginBottom:10 }}>Delivery · Advance · Notes</div>
        <div style={{ display:"flex", gap:10, flexWrap:"wrap", marginBottom:10, alignItems:"center" }}>
          <label style={{ display:"flex", alignItems:"center", gap:6, fontFamily:T.mono, fontSize:11, color:T.text, cursor:"pointer" }}>
            <input type="checkbox" checked={!!form.hasDelivery} onChange={e=>setForm(f=>({...f,hasDelivery:e.target.checked}))} style={{ width:15, height:15, accentColor:T.gold }} />
            Delivery Date
          </label>
          {form.hasDelivery && <Inp label="Date" type="date" value={form.deliveryDate||""} onChange={v=>setForm(f=>({...f,deliveryDate:v}))} />}
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))", gap:8, marginBottom:10 }}>
          <Inp label="Advance Type" value={form.advanceType} onChange={v=>setForm(f=>({...f,advanceType:v}))} options={ADV} />
          <Inp label="Advance Amount" type="number" value={form.advanceAmount} onChange={v=>setForm(f=>({...f,advanceAmount:v}))} />
          <Inp label="Advance Date" type="date" value={form.advanceDate} onChange={v=>setForm(f=>({...f,advanceDate:v}))} />
          <Inp label="Ref / Cheque No" value={form.advanceRef} onChange={v=>setForm(f=>({...f,advanceRef:v}))} />
        </div>
        <Inp label="Special Instructions" value={form.specialInstructions} onChange={v=>setForm(f=>({...f,specialInstructions:v}))} placeholder="koi khaas hidayat…" />
      </div>

      <div style={{ display:"flex", gap:10, flexWrap:"wrap", marginBottom:30 }}>
        <Btn label={editId?"Update Order":"Save Order"} onClick={saveOrder} />
        <Btn label="Cancel" onClick={()=>{ setView("list"); setForm(blankForm()); setEditId(null); }} color={T.surface} textColor={T.steelLt} small />
      </div>
    </div>
  );

  // ═══════════ ORDER DETAIL ═══════════
  async function updLineStatus(bookingId, lineId, status){
    const b=bookings.find(x=>x.id===bookingId); if(!b) return;
    const nb={...b, lines:(b.lines||[]).map(l=>l.id===lineId?{...l,status}:l)};
    setBookings(p=>p.map(x=>x.id===bookingId?nb:x));
    await dbUpsert("bookings", bToRow(nb));
  }
  async function toggleCompleted(bookingId, val){
    const b=bookings.find(x=>x.id===bookingId); if(!b) return;
    const nb={...b, completed:val, lines: val ? (b.lines||[]).map(l=>({...l,status:"Delivered"})) : b.lines };
    setBookings(p=>p.map(x=>x.id===bookingId?nb:x));
    await dbUpsert("bookings", bToRow(nb));
    if(val) showToast("Order marked completed ✓");
  }
  function isDoneStatus(st){ return st==="Dispatched"||st==="Delivered"||st==="Cancelled"; }

  if(view==="detail"){
    const b=bookings.find(x=>x.id===selId);
    if(!b) return <Btn label="← Back" onClick={()=>setView("list")} />;
    const lines=sortedLines(b.lines||[]);
    const cols=usedSizes(lines);
    const dl=b.hasDelivery?daysLeft(b.deliveryDate):null;
    const ac=alertColor(dl);
    return (
      <div>
        <div style={{ display:"flex", gap:8, marginBottom:14, alignItems:"center", flexWrap:"wrap" }} className="no-print">
          <Btn label="← Back" onClick={()=>setView("list")} color={T.surface} textColor={T.steelLt} small />
          <div style={{ flex:1, fontFamily:T.mono, fontWeight:700, fontSize:15, color:T.gold }}>{b.orderNo}{b.externalRef?` · ${b.externalRef}`:""}</div>
          <label style={{ display:"flex", alignItems:"center", gap:6, fontFamily:T.mono, fontSize:11, color:T.text, cursor:"pointer" }}>
            <input type="checkbox" checked={detailedPrint} onChange={e=>setDetailedPrint(e.target.checked)} style={{ width:15,height:15,accentColor:T.gold }} />
            Detailed
          </label>
          <Btn label="🖨 Print / PDF" onClick={()=>window.print()} small />
          <Btn label="✏ Edit" onClick={()=>startEdit(b)} small />
          <Btn label="⧉ Duplicate" onClick={()=>duplicateOrder(b)} color={T.surface} textColor={T.steelLt} small />
          <Btn label="🗑" onClick={()=>delOrder(b.id)} color={T.red+"22"} textColor={T.red} small />
        </div>
        <label className="no-print" style={{ display:"flex", alignItems:"center", gap:6, fontFamily:T.mono, fontSize:12, color:T.text, cursor:"pointer", marginBottom:12 }}>
          <input type="checkbox" checked={!!b.completed} onChange={e=>toggleCompleted(b.id,e.target.checked)} style={{ width:16, height:16, accentColor:T.green }} />
          ✅ Mark whole order Completed (saari designs done)
        </label>

        <div style={{ background:T.card, borderRadius:12, padding:18, border:`1px solid ${T.border}` }}>
          <div style={{ display:"flex", justifyContent:"space-between", flexWrap:"wrap", gap:12, marginBottom:14, paddingBottom:12, borderBottom:`1px solid ${T.border}` }}>
            <div>
              <div style={{ fontFamily:T.mono, fontSize:17, fontWeight:900, color:T.text }}>{b.customer}</div>
              {b.company && <div style={{ fontSize:12, color:T.steelLt }}>{b.company}</div>}
              <div style={{ fontFamily:T.mono, fontSize:11, color:T.steelLt, marginTop:4 }}>
                {b.mobile?`📞 ${b.mobile}  `:""}{b.gstin?`GST: ${b.gstin}`:""}
              </div>
              {b.billingAddress && <div style={{ fontSize:11, color:T.steelLt, marginTop:2 }}>{b.billingAddress}</div>}
            </div>
            <div style={{ textAlign:"right", fontFamily:T.mono, fontSize:11, color:T.steelLt }}>
              <div style={{ fontSize:13, color:T.gold, fontWeight:700 }}>{b.orderNo}</div>
              <div>{b.bookingDate}</div>
              {b.status && <div>Status: <b style={{color:T.text}}>{b.status}</b></div>}
              {b.priority==="Urgent" && <div style={{ color:T.red, fontWeight:700 }}>⚡ URGENT</div>}
              {b.transport && <div>Transport: {b.transport}</div>}
              {b.destination && <div>Dest: {b.destination}</div>}
              {b.paymentTerms && <div>Payment: {b.paymentTerms}</div>}
              {b.hasDelivery && b.deliveryDate && <div style={{ color:ac }}>🗓 {b.deliveryDate} {alertLabel(dl)}</div>}
            </div>
          </div>

          <div style={{ overflowX:"auto" }}>
            <table style={{ borderCollapse:"collapse", width:"100%" }}>
              <thead><tr>
                <th style={th}>Design</th>
                <th style={th}>Colour</th>
                <th style={th} className="no-print">Status</th>
                {detailedPrint && <th style={th}>MRP</th>}
                {detailedPrint && <th style={th}>Remark</th>}
                {cols.map(s=><th key={s} style={th}>{s}</th>)}
                <th style={th}>Total</th>
              </tr></thead>
              <tbody>
                {lines.map((l,i)=>(
                  <tr key={l.id||i} style={{ background: i%2?T.surface:T.bg, opacity: isDoneStatus(l.status)?0.45:1 }}>
                    <td style={{...td, fontFamily:T.mono, fontWeight:700, color:T.gold}}>{l.designNo}</td>
                    <td style={{...td, fontFamily:T.mono, color:T.text}}>{l.colour}</td>
                    <td style={td} className="no-print">
                      <select value={l.status||"Pending"} onChange={e=>updLineStatus(b.id,l.id,e.target.value)} style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:5, color:T.text, fontFamily:T.mono, fontSize:11, padding:"4px 6px" }}>
                        {STATUSES.map(s=><option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    {detailedPrint && <td style={{...td, fontFamily:T.mono, color:T.text}}>{l.mrp?`₹${l.mrp}`:"—"}</td>}
                    {detailedPrint && <td style={{...td, fontSize:11, color:T.steelLt}}>{l.remark||"—"}</td>}
                    {cols.map(s=><td key={s} style={{...td, fontFamily:T.mono, color:T.text}}>{(l.sizes||{})[s]||""}</td>)}
                    <td style={{...td, fontFamily:T.mono, fontWeight:700, color:T.gold}}>{lineTotal(l)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr style={{ background:T.surface }}>
                <td colSpan={detailedPrint?4:2} style={{...td, textAlign:"right", fontFamily:T.mono, fontSize:11, color:T.steelLt, paddingRight:10}}>TOTAL</td>
                {cols.map(s=><td key={s} style={{...td, fontFamily:T.mono, fontSize:11, color:T.steelLt}}>{lines.reduce((a,l)=>a+(+(l.sizes||{})[s]||0)*colourCount(l),0)||""}</td>)}
                <td style={{...td, fontFamily:T.mono, fontSize:14, fontWeight:900, color:T.gold}}>{orderTotal(lines)}</td>
              </tr></tfoot>
            </table>
          </div>

          {(+b.advanceAmount>0) && <div style={{ marginTop:12, fontFamily:T.mono, fontSize:12, color:T.green }}>💰 Advance: ₹{b.advanceAmount} · {b.advanceType}{b.advanceDate?` · ${b.advanceDate}`:""}{b.advanceRef?` · ${b.advanceRef}`:""}</div>}
          {b.specialInstructions && <div style={{ marginTop:10, fontSize:12, color:T.text }}>📝 {b.specialInstructions}</div>}
          <div style={{ marginTop:14, paddingTop:10, borderTop:`1px solid ${T.border}`, fontFamily:T.mono, fontSize:10, color:T.steelLt, fontStyle:"italic" }}>{DEFAULT_NOTE}</div>
        </div>
      </div>
    );
  }

  // ═══════════ SUMMARY / CUTTING ═══════════
  // auto-mark completed when every line is Dispatched/Delivered/Cancelled (guarded against loops)
  const autoCompleteDone = useRef(new Set());
  useEffect(() => {
    bookings.forEach(b => {
      if (b.completed || autoCompleteDone.current.has(b.id)) return;
      const lns = b.lines||[];
      if (lns.length>0 && lns.every(l=>isDoneStatus(l.status))) {
        autoCompleteDone.current.add(b.id);
        toggleCompleted(b.id, true);
      }
    });
  }, [bookings]);

  if(view==="completed"){
    return (
      <div>
        <div style={{ display:"flex", gap:8, marginBottom:14, flexWrap:"wrap" }} className="no-print">
          <Btn label="← Back to All Orders" onClick={()=>setView("list")} color={T.surface} textColor={T.steelLt} small />
          <div style={{ fontFamily:T.mono, fontWeight:700, fontSize:14, color:T.gold, alignSelf:"center" }}>Completed Orders</div>
        </div>
        {completedBookings.length===0 && <div style={{ textAlign:"center", color:T.textDim, padding:40, fontFamily:T.mono }}>Koi completed order nahi hai.</div>}
        {completedBookings.map(b=>(
          <div key={b.id} style={{ background:T.card, borderRadius:10, padding:"12px 16px", marginBottom:10, border:`1px solid ${T.border}`, display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, flexWrap:"wrap" }}>
            <div onClick={()=>{ setSelId(b.id); setView("detail"); }} style={{ cursor:"pointer", flex:1 }}>
              <div style={{ fontFamily:T.mono, fontWeight:700, color:T.gold, fontSize:13 }}>{b.orderNo}</div>
              <div style={{ fontWeight:700, color:T.text, fontSize:14 }}>{b.customer}</div>
              <div style={{ fontFamily:T.mono, fontSize:11, color:T.steelLt, marginTop:2 }}>{orderTotal(b.lines)} pcs · ✅ Completed</div>
            </div>
            <div style={{ display:"flex", gap:6 }}>
              <Btn label="↩ Reopen" onClick={()=>toggleCompleted(b.id,false)} color={T.surface} textColor={T.steelLt} small />
              <Btn label="🗑 Delete" onClick={()=>delOrder(b.id)} color={T.red+"22"} textColor={T.red} small />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if(view==="summary"){
    const allLines=[];
    bookings.forEach(b=>(b.lines||[]).forEach(l=>allLines.push({...l, customer:b.customer, orderNo:b.orderNo})));
    const cutLines=cutDesign.trim()?allLines.filter(l=>String(l.designNo).trim().toLowerCase()===cutDesign.trim().toLowerCase()):[];
    const byColour={};
    cutLines.forEach(l=>{
      const cs=String(l.colour||"").split(",").map(x=>x.trim()).filter(Boolean);
      (cs.length?cs:["—"]).forEach(c=>{
        if(!byColour[c]) byColour[c]={colour:c,sizes:{},total:0};
        activeSizes.forEach(s=>{ byColour[c].sizes[s]=(byColour[c].sizes[s]||0)+(+(l.sizes||{})[s]||0); });
        byColour[c].total+=activeSizes.reduce((a,s)=>a+(+(l.sizes||{})[s]||0),0);
      });
    });
    const cutCols=activeSizes.filter(s=>Object.values(byColour).some(c=>c.sizes[s]>0));

    return (
      <div>
        <div style={{ display:"flex", gap:8, marginBottom:14, flexWrap:"wrap" }} className="no-print">
          <button onClick={()=>setView("list")} style={{ background:T.surface, color:T.steelLt, border:"none", borderRadius:20, padding:"6px 16px", fontFamily:T.mono, fontSize:11, fontWeight:700, cursor:"pointer" }}>All Orders</button>
          <button onClick={()=>setView("completed")} style={{ background:T.surface, color:T.steelLt, border:"none", borderRadius:20, padding:"6px 16px", fontFamily:T.mono, fontSize:11, fontWeight:700, cursor:"pointer" }}>Completed</button>
          <button onClick={()=>setSummaryTab("customer")} style={{ background:summaryTab==="customer"?T.gold:T.surface, color:summaryTab==="customer"?"#fff":T.steelLt, border:"none", borderRadius:20, padding:"6px 16px", fontFamily:T.mono, fontSize:11, fontWeight:700, cursor:"pointer" }}>By Customer</button>
          <button onClick={()=>setSummaryTab("cutting")} style={{ background:summaryTab==="cutting"?T.gold:T.surface, color:summaryTab==="cutting"?"#fff":T.steelLt, border:"none", borderRadius:20, padding:"6px 16px", fontFamily:T.mono, fontSize:11, fontWeight:700, cursor:"pointer" }}>Cutting Report</button>
        </div>

        {summaryTab==="cutting" && (
          <div>
            <div style={{ display:"flex", gap:8, marginBottom:14, alignItems:"center", flexWrap:"wrap" }} className="no-print">
              <input value={cutDesign} onChange={e=>setCutDesign(e.target.value)} placeholder="Design number daalo…" list="bk-designs2" style={{ flex:1, minWidth:180, background:T.surface, border:`2px solid ${T.gold}`, borderRadius:8, color:T.text, fontFamily:T.mono, fontSize:14, padding:"10px 14px", outline:"none" }} />
              <datalist id="bk-designs2">{[...new Set(allLines.map(l=>l.designNo))].filter(Boolean).map(d=><option key={d} value={d} />)}</datalist>
              {cutLines.length>0 && <Btn label="🖨 Print" onClick={()=>window.print()} small />}
            </div>
            {!cutDesign.trim() && <div style={{ textAlign:"center", color:T.textDim, padding:40, fontFamily:T.mono, fontSize:12 }}>Design number daalo — us design ka poora order colour-wise dikhega</div>}
            {cutDesign.trim() && cutLines.length===0 && <div style={{ textAlign:"center", color:T.textDim, padding:40, fontFamily:T.mono }}>Is design ka koi order nahi mila.</div>}
            {cutLines.length>0 && (
              <div style={{ background:T.card, borderRadius:12, padding:18, border:`1px solid ${T.border}` }}>
                <div style={{ fontFamily:T.mono, fontSize:16, fontWeight:900, color:T.gold, marginBottom:12 }}>CUTTING SHEET — DESIGN {cutDesign}</div>
                <div style={{ overflowX:"auto" }}>
                  <table style={{ borderCollapse:"collapse", width:"100%" }}>
                    <thead><tr><th style={th}>Colour</th>{cutCols.map(s=><th key={s} style={th}>{s}</th>)}<th style={th}>Total</th></tr></thead>
                    <tbody>
                      {Object.values(byColour).sort((a,b)=>{ const n=v=>{const x=parseFloat(String(v).replace(/[^\d.]/g,"")); return isNaN(x)?Infinity:x;}; return n(a.colour)-n(b.colour)||String(a.colour).localeCompare(String(b.colour)); }).map((c,i)=>(
                        <tr key={c.colour} style={{ background:i%2?T.surface:T.bg }}>
                          <td style={{...td, fontFamily:T.mono, fontWeight:700, color:T.text}}>{c.colour}</td>
                          {cutCols.map(s=><td key={s} style={{...td, fontFamily:T.mono}}>{c.sizes[s]||""}</td>)}
                          <td style={{...td, fontFamily:T.mono, fontWeight:700, color:T.gold}}>{c.total}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot><tr style={{ background:T.surface }}>
                      <td style={{...td, textAlign:"right", fontFamily:T.mono, fontSize:11, color:T.steelLt}}>TOTAL</td>
                      {cutCols.map(s=><td key={s} style={{...td, fontFamily:T.mono, fontWeight:700, color:T.text}}>{Object.values(byColour).reduce((a,c)=>a+(c.sizes[s]||0),0)||""}</td>)}
                      <td style={{...td, fontFamily:T.mono, fontSize:15, fontWeight:900, color:T.gold}}>{Object.values(byColour).reduce((a,c)=>a+c.total,0)}</td>
                    </tr></tfoot>
                  </table>
                </div>
                <div style={{ marginTop:14, paddingTop:10, borderTop:`1px solid ${T.border}` }}>
                  <div style={{ fontFamily:T.mono, fontSize:9, color:T.steelLt, textTransform:"uppercase", marginBottom:6 }}>Orders in this sheet</div>
                  {[...new Set(cutLines.map(l=>`${l.customer}||${l.orderNo}`))].map(k=>{
                    const [cust,ord]=k.split("||");
                    const t=cutLines.filter(l=>l.customer===cust&&l.orderNo===ord).reduce((a,l)=>a+activeSizes.reduce((x,s)=>x+(+(l.sizes||{})[s]||0),0)*(String(l.colour||"").split(",").map(x=>x.trim()).filter(Boolean).length||1),0);
                    return <div key={k} style={{ fontFamily:T.mono, fontSize:11, color:T.text }}>· {cust} <span style={{color:T.steelLt}}>({ord})</span> — <b style={{color:T.gold}}>{t} pcs</b></div>;
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {summaryTab==="customer" && (() => {
          const byC={};
          bookings.forEach(b=>{ const k=b.customer||"—"; if(!byC[k]) byC[k]={customer:k,orders:[],total:0}; byC[k].orders.push(b); byC[k].total+=orderTotal(b.lines); });
          return Object.values(byC).map(c=>(
            <div key={c.customer} style={{ background:T.card, borderRadius:12, padding:16, marginBottom:10, border:`1px solid ${T.border}` }}>
              <div style={{ fontFamily:T.mono, fontWeight:700, fontSize:15, color:T.text, marginBottom:8 }}>{c.customer} <span style={{ color:T.gold }}>· {c.total} pcs</span></div>
              {c.orders.map(b=>(
                <div key={b.id} onClick={()=>{ setSelId(b.id); setView("detail"); }} style={{ background:T.surface, borderRadius:8, padding:10, marginBottom:6, cursor:"pointer" }}>
                  <div style={{ fontFamily:T.mono, fontSize:12, color:T.gold, fontWeight:700 }}>{b.orderNo} · {b.bookingDate} · {orderTotal(b.lines)} pcs</div>
                  <div style={{ fontFamily:T.mono, fontSize:11, color:T.steelLt, marginTop:2 }}>{[...new Set((b.lines||[]).map(l=>l.designNo))].filter(Boolean).join(", ")}</div>
                </div>
              ))}
            </div>
          ));
        })()}
      </div>
    );
  }

  // ═══════════ LIST ═══════════
  const q=searchQ.trim().toLowerCase();
  const activeBookings = bookings.filter(b=>!b.completed);
  const completedBookings = bookings.filter(b=>b.completed);
  const filtered=q?activeBookings.filter(b=>(b.customer||"").toLowerCase().includes(q)||(b.orderNo||"").toLowerCase().includes(q)||(b.lines||[]).some(l=>String(l.designNo).toLowerCase().includes(q))):activeBookings;
  return (
    <div>
      <div style={{ display:"flex", gap:8, marginBottom:14, flexWrap:"wrap", alignItems:"center" }}>
        <button onClick={()=>setView("list")} style={{ background:T.gold, color:"#fff", border:"none", borderRadius:20, padding:"6px 16px", fontFamily:T.mono, fontSize:11, fontWeight:700, cursor:"pointer" }}>All Orders</button>
        <button onClick={()=>setView("completed")} style={{ background:T.surface, color:T.steelLt, border:"none", borderRadius:20, padding:"6px 16px", fontFamily:T.mono, fontSize:11, fontWeight:700, cursor:"pointer" }}>Completed</button>
        <button onClick={()=>{ setSummaryTab("customer"); setView("summary"); }} style={{ background:T.surface, color:T.steelLt, border:"none", borderRadius:20, padding:"6px 16px", fontFamily:T.mono, fontSize:11, fontWeight:700, cursor:"pointer" }}>Summary</button>
        <button onClick={()=>{ setSummaryTab("cutting"); setView("summary"); }} style={{ background:T.surface, color:T.steelLt, border:"none", borderRadius:20, padding:"6px 16px", fontFamily:T.mono, fontSize:11, fontWeight:700, cursor:"pointer" }}>Cutting</button>
        <input value={searchQ} onChange={e=>setSearchQ(e.target.value)} placeholder="Search customer / design / order…" style={{ flex:1, minWidth:170, background:T.surface, border:`1px solid ${T.border}`, borderRadius:8, color:T.text, fontFamily:T.mono, fontSize:13, padding:"8px 12px", outline:"none" }} />
        <Btn label="+ New Order" onClick={()=>{ setForm(blankForm()); setEditId(null); setView("new"); }} />
      </div>

      {filtered.length===0 && <div style={{ textAlign:"center", color:T.textDim, padding:40, fontFamily:T.mono }}>No orders yet.</div>}
      {filtered.map(b=>{
        const dl=b.hasDelivery?daysLeft(b.deliveryDate):null; const ac=alertColor(dl);
        return (
          <div key={b.id} onClick={()=>{ setSelId(b.id); setView("detail"); }} style={{ background:T.card, borderRadius:10, padding:"12px 16px", marginBottom:10, border:`1px solid ${ac||T.border}`, cursor:"pointer", display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, flexWrap:"wrap" }}>
            <div>
              <div style={{ fontFamily:T.mono, fontWeight:700, color:T.gold, fontSize:13 }}>{b.orderNo}{b.externalRef?` · ${b.externalRef}`:""}</div>
              <div style={{ fontWeight:700, color:T.text, fontSize:14, marginTop:2 }}>{b.customer}{b.priority==="Urgent"?<span style={{color:T.red,fontSize:11}}> ⚡</span>:null}</div>
              <div style={{ fontFamily:T.mono, fontSize:11, color:T.steelLt, marginTop:2 }}>{b.bookingDate} · {orderTotal(b.lines)} pcs · {(b.lines||[]).length} lines{b.status?` · ${b.status}`:""}</div>
            </div>
            {ac && <div style={{ fontFamily:T.mono, fontSize:11, fontWeight:700, color:ac }}>{alertLabel(dl)}</div>}
          </div>
        );
      })}
    </div>
  );
}

// ── Samples Tab (Booking ke andar) — agent-wise grouped sample tracking ───────
// ── Samples Tab — bilkul kaagaz jaisa: Agent/Distributor + Date header, ek table ──
function SamplesTab({ showToast, currentUser, onBack }) {
  const [rows, setRows] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [savedId, setSavedId] = useState(null);
  const [editingId, setEditingId] = useState(null);   // row currently unlocked for editing
  const [newRowId, setNewRowId] = useState(null);      // freshly added row, always editable until first save
  const [header, setHeader] = useState({ agent:"", date:new Date().toISOString().slice(0,10) });

  useEffect(() => { load(); }, []);
  async function load() {
    const r = await dbSelect("samples");
    setRows((r||[]).map(rowToS));
  }
  function rowToS(r){ return { id:r.id, agent:r.agent||"", designNo:r.design_no||"", givenQty:r.given_qty||0, receivedQty:r.received_qty||0, remark:r.remark||"", colourBreakup:r.colour_breakup||[], createdBy:r.created_by||"" }; }
  function sToRow(s){ return { id:s.id, agent:s.agent||"", design_no:s.designNo||"", given_qty:+s.givenQty||0, received_qty:+s.receivedQty||0, remark:s.remark||"", colour_breakup:s.colourBreakup||[], created_by:s.createdBy||currentUser }; }

  function colourTotal(cb){ return (cb||[]).reduce((a,c)=>a+(+c.qty||0),0); }
  function balance(s){ return Math.max(0, (+s.givenQty||0)-(+s.receivedQty||0)); }

  async function addLine(){
    if(!header.agent.trim()){ showToast("Pehle Agent/Distributor naam likho","error"); return; }
    const s={ id:`SM${Date.now()}`, agent:header.agent, designNo:"", givenQty:0, receivedQty:0, remark:"", colourBreakup:[], createdBy:currentUser };
    await dbUpsert("samples", sToRow(s));
    setRows(p=>[...p, s]);
    setNewRowId(s.id); setEditingId(s.id); setOpenId(s.id);
  }
  async function updRow(id, patch){
    const s=rows.find(x=>x.id===id); if(!s) return;
    const ns={...s,...patch};
    if(patch.colourBreakup) ns.givenQty = colourTotal(patch.colourBreakup);
    await dbUpsert("samples", sToRow(ns));
    setRows(p=>p.map(x=>x.id===id?ns:x));
    setSavedId(id); setTimeout(()=>setSavedId(cur=>cur===id?null:cur), 1500);
  }
  async function delRow(id){ if(!window.confirm("Delete this line?")) return; await dbDelete("samples", id); setRows(p=>p.filter(x=>x.id!==id)); }

  function addColour(id){ const s=rows.find(x=>x.id===id); updRow(id,{ colourBreakup:[...(s.colourBreakup||[]), {colour:"",size:"",qty:""}] }); setOpenId(id); }
  function updColour(id, idx, k, v){ const s=rows.find(x=>x.id===id); const cb=(s.colourBreakup||[]).map((c,i)=>i===idx?{...c,[k]:v}:c); updRow(id,{ colourBreakup:cb }); }
  function remColour(id, idx){ const s=rows.find(x=>x.id===id); const cb=(s.colourBreakup||[]).filter((c,i)=>i!==idx); updRow(id,{ colourBreakup:cb }); }

  // list of distinct agents that already have samples
  const agentList = [...new Set(rows.map(r=>r.agent).filter(Boolean))].sort();
  const [activeAgent, setActiveAgent] = useState(null);
  const [newAgentName, setNewAgentName] = useState("");

  async function openAgent(name){
    if(!name.trim()) return;
    setHeader(h=>({...h, agent:name.trim()}));
    setActiveAgent(name.trim());
    setNewAgentName("");
  }

  // ── AGENT PICKER (list of agents, or start a new one) ──
  if (!activeAgent) {
    return (
      <div>
        <div style={{ display:"flex", gap:8, marginBottom:14, alignItems:"center" }} className="no-print">
          {onBack && <Btn label="← Back" onClick={onBack} color={T.surface} textColor={T.steelLt} small />}
          <div style={{ fontFamily:T.mono, fontWeight:700, fontSize:14, color:T.gold }}>Samples — by Agent/Distributor</div>
        </div>

        <div style={{ background:T.card, borderRadius:12, padding:16, marginBottom:16, border:`1px solid ${T.gold}` }}>
          <div style={{ fontFamily:T.mono, fontSize:9, color:T.steelLt, textTransform:"uppercase", marginBottom:8 }}>Naya Agent / Distributor</div>
          <div style={{ display:"flex", gap:8 }}>
            <input value={newAgentName} onChange={e=>setNewAgentName(e.target.value)} placeholder="Naam type karo…" style={{ flex:1, background:T.bg, border:`1px solid ${T.border}`, borderRadius:6, color:T.text, fontFamily:T.mono, fontSize:14, padding:"8px 12px", outline:"none" }} onKeyDown={e=>{ if(e.key==="Enter") openAgent(newAgentName); }} />
            <Btn label="Open" onClick={()=>openAgent(newAgentName)} small />
          </div>
        </div>

        {agentList.length>0 && (
          <div>
            <div style={{ fontFamily:T.mono, fontSize:9, color:T.steelLt, textTransform:"uppercase", marginBottom:8 }}>Existing Records</div>
            {agentList.map(a => {
              const arows = rows.filter(r=>r.agent===a);
              const totBal = arows.reduce((sum,r)=>sum+balance(r),0);
              return (
                <div key={a} onClick={()=>openAgent(a)} style={{ background:T.card, borderRadius:10, padding:"12px 16px", marginBottom:8, border:`1px solid ${T.border}`, cursor:"pointer", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <div style={{ fontWeight:700, color:T.text, fontFamily:T.mono }}>{a}</div>
                  <div style={{ fontFamily:T.mono, fontSize:11, color:T.steelLt }}>{arows.length} design line{arows.length!==1?"s":""}{totBal>0 ? <span style={{color:T.red, fontWeight:700}}> · {totBal} balance pending</span> : <span style={{color:T.green}}> · all clear ✓</span>}</div>
                </div>
              );
            })}
          </div>
        )}
        {agentList.length===0 && <div style={{ textAlign:"center", color:T.textDim, padding:20, fontFamily:T.mono, fontSize:12 }}>Koi agent record nahi hai abhi.</div>}
      </div>
    );
  }

  // rows for the currently open agent only
  const sheetRows = rows.filter(s => s.agent===activeAgent);

  const th={ padding:"8px 10px", fontFamily:T.mono, fontSize:9, color:T.steelLt, textTransform:"uppercase", border:`1px solid ${T.border}`, background:T.surface, textAlign:"center" };
  const td={ padding:"7px 10px", border:`1px solid ${T.border}`, textAlign:"center", verticalAlign:"top" };
  const txtIn={ background:T.bg, border:`1px solid ${T.border}`, borderRadius:5, color:T.text, fontFamily:T.mono, fontSize:12, padding:"5px 7px", outline:"none" };

  return (
    <div>
      <div style={{ display:"flex", gap:8, marginBottom:14, alignItems:"center" }} className="no-print">
        <Btn label="← All Agents" onClick={()=>setActiveAgent(null)} color={T.surface} textColor={T.steelLt} small />
        <div style={{ fontFamily:T.mono, fontWeight:700, fontSize:14, color:T.gold }}>Samples</div>
        <Btn label="🖨 Print / PDF" onClick={()=>window.print()} color={T.surface} textColor={T.steelLt} small />
      </div>

      <div style={{ background:T.card, borderRadius:12, padding:18, border:`1px solid ${T.border}` }}>
        <div style={{ display:"flex", justifyContent:"space-between", flexWrap:"wrap", gap:12, marginBottom:16, paddingBottom:12, borderBottom:`2px solid ${T.gold}` }}>
          <div style={{ flex:1, minWidth:200 }}>
            <label style={{ fontFamily:T.mono, fontSize:9, color:T.steelLt, textTransform:"uppercase" }}>Agent / Distributor</label>
            <div style={{ fontFamily:T.mono, fontSize:18, fontWeight:900, color:T.text, marginTop:4 }}>{activeAgent}</div>
          </div>
          <div>
            <label style={{ fontFamily:T.mono, fontSize:9, color:T.steelLt, textTransform:"uppercase" }}>Date</label>
            <input type="date" value={header.date} onChange={e=>setHeader(h=>({...h,date:e.target.value}))} style={{ ...txtIn, display:"block", marginTop:4 }} />
          </div>
        </div>

        <div style={{ overflowX:"auto" }}>
          <table style={{ borderCollapse:"collapse", width:"100%", minWidth:640 }}>
            <thead><tr>
              <th style={{...th, width:40}}>Sr No</th>
              <th style={{...th, minWidth:170}}>Design Number</th>
              <th style={th}>Qty Given</th>
              <th style={th}>Qty Rcvd</th>
              <th style={th}>Balance if any</th>
              <th style={{...th, minWidth:140}}>Remarks</th>
              <th style={{...th, width:36}} className="no-print"></th>
            </tr></thead>
            <tbody>
              {sheetRows.map((s,i) => {
                const bal=balance(s); const open=openId===s.id;
                const unlocked = editingId===s.id || newRowId===s.id;
                const visibleColours = (open ? (s.colourBreakup||[]) : (s.colourBreakup||[]).filter(c=>String(c.colour||"").trim()||String(c.size||"").trim()||String(c.qty||"").trim()));
                return (
                  <tr key={s.id} style={{ background: bal===0 && +s.receivedQty>0 ? T.green+"10" : (i%2?T.surface:T.bg), opacity: unlocked?1:0.92 }}>
                    <td style={{...td, fontFamily:T.mono, color:T.steelLt}}>{i+1}{savedId===s.id && <div className="no-print" style={{ color:T.green, fontSize:9, marginTop:2 }}>✓ Saved</div>}</td>
                    <td style={{...td, textAlign:"left"}}>
                      <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                        {(s.colourBreakup||[]).length>0 && <span onClick={()=>setOpenId(open?null:s.id)} className="no-print" style={{ cursor:"pointer", color:T.gold, fontWeight:700 }}>{open?"[−]":"[+]"}</span>}
                        {unlocked
                          ? <input value={s.designNo} onChange={e=>updRow(s.id,{designNo:e.target.value})} placeholder="design no" style={{...txtIn, fontWeight:700, color:T.gold, width:90}} className="no-print" />
                          : <span className="no-print" style={{ fontWeight:700, color:T.gold, fontFamily:T.mono }}>{s.designNo||"—"}</span>}
                        <span className="print-only" style={{ fontWeight:700, color:T.gold, display:"none" }}>{s.designNo}</span>
                      </div>
                      {(unlocked || visibleColours.length>0) && (
                        <div style={{ marginTop:6 }}>
                          {(unlocked ? (s.colourBreakup||[]) : visibleColours).map((c,ci) => (
                            <div key={ci} style={{ display:"flex", gap:4, alignItems:"center", marginBottom:3, fontSize:12 }}>
                              <span style={{ color:T.steelLt, fontFamily:T.mono, fontSize:11 }}>{ci+1})</span>
                              {unlocked ? <>
                                <input value={c.colour} onChange={e=>updColour(s.id,ci,"colour",e.target.value)} placeholder="colour" style={{...txtIn, width:70}} className="no-print" />
                                <input value={c.size} onChange={e=>updColour(s.id,ci,"size",e.target.value)} placeholder="size" style={{...txtIn, width:50}} className="no-print" />
                                <span style={{ color:T.steelLt }} className="no-print">-</span>
                                <input type="number" value={c.qty} onChange={e=>updColour(s.id,ci,"qty",e.target.value)} placeholder="qty" style={{...txtIn, width:45}} className="no-print" />
                                <span onClick={()=>remColour(s.id,ci)} className="no-print" style={{ color:T.red, cursor:"pointer" }}>✕</span>
                              </> : <span className="no-print" style={{ color:T.text, fontFamily:T.mono }}>{c.colour} {c.size?`${c.size}-`:""}{c.qty}</span>}
                              <span className="print-only" style={{ display:"none", color:T.text }}>{c.colour} {c.size?`${c.size}-`:""}{c.qty}</span>
                            </div>
                          ))}
                          {unlocked && <span onClick={()=>addColour(s.id)} className="no-print" style={{ color:T.gold, cursor:"pointer", fontSize:11, fontWeight:700 }}>+ Add colour</span>}
                        </div>
                      )}
                    </td>
                    <td style={{...td, fontFamily:T.mono, fontWeight:700, color:T.gold}}>{s.givenQty||""}</td>
                    <td style={td} className="no-print">{unlocked ? <input type="number" value={s.receivedQty||""} onChange={e=>updRow(s.id,{receivedQty:e.target.value})} style={{...txtIn, width:55}} /> : (s.receivedQty||"—")}</td>
                    <td style={{...td, display:"none"}} className="print-only">{s.receivedQty||""}</td>
                    <td style={{...td, fontFamily:T.mono, fontWeight:700, color: bal>0?T.red:T.green}}>{bal||""}</td>
                    <td style={td} className="no-print">{unlocked ? <input value={s.remark} onChange={e=>updRow(s.id,{remark:e.target.value})} style={{...txtIn, width:"100%", boxSizing:"border-box"}} /> : <span style={{fontFamily:T.mono, fontSize:12}}>{s.remark||"—"}</span>}</td>
                    <td style={{...td, display:"none"}} className="print-only">{s.remark||""}</td>
                    <td style={td} className="no-print">
                      {unlocked
                        ? <span onClick={()=>{ setEditingId(null); setNewRowId(cur=>cur===s.id?null:cur); setOpenId(null); showToast("Saved & locked ✓"); }} style={{ color:T.green, cursor:"pointer", fontWeight:700, fontSize:11 }}>🔒 Done</span>
                        : <span onClick={()=>{ setEditingId(s.id); setOpenId(s.id); }} style={{ color:T.gold, cursor:"pointer", fontWeight:700, fontSize:11 }}>✏ Edit</span>}
                      <span onClick={()=>delRow(s.id)} style={{ color:T.red, cursor:"pointer", marginLeft:8 }}>🗑</span>
                    </td>
                  </tr>
                );
              })}
              {sheetRows.length===0 && <tr><td colSpan={7} style={{...td, color:T.textDim, padding:24}}>Koi sample entry nahi. "+ Add New Sample" dabao.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="no-print" style={{ marginTop:14 }}>
          <Btn label="+ Add New Sample" onClick={addLine} />
        </div>
      </div>
    </div>
  );
}

function BarcodePanel({ design, jobbers, onUpdate }) {
  const bills = (design.supplierBills || []).filter(b => (b.billType||"Fabric")==="Fabric");
  const colors = design.colors || [];
  const saved = design.barcodeBlocks || null;           // colour-wise (new)
  const legacy = design.barcodeBlock || {};             // old single block (fallback)

  const [sameBill, setSameBill] = useState(saved ? !!saved.sameBill : true);
  const [commonBillId, setCommonBillId] = useState(saved?.commonBillId || legacy.billId || (bills[0]?.id || ""));
  // per-colour rows: { billId, meters, rate, initials, cityLetter, billNo, billDate }
  const [rows, setRows] = useState(() => {
    const byIdx = saved?.rows || {};
    const o = {};
    colors.forEach((c,ci) => { o[ci] = byIdx[ci] || { billId:"", meters:"", rate:"", initials:"", cityLetter:"", billNo:"", billDate:"" }; });
    return o;
  });

  // supplier name -> city (auto city letter)
  const [supCity, setSupCity] = useState({});
  useEffect(() => { loadSuppliers().then(list => { const m={}; (list||[]).forEach(s => { if(s.name) m[s.name.trim().toLowerCase()] = s.city||""; }); setSupCity(m); }); }, []);

  function billFields(bill) {
    if (!bill) return { rate:"", initials:"", cityLetter:"", billNo:"", billDate:"" };
    const city = supCity[(bill.supplier||"").trim().toLowerCase()] || "";
    return {
      rate: bill.rate || "",
      initials: initialsOf(bill.supplier || design.supplier),
      cityLetter: city ? city.trim()[0].toUpperCase() : "",
      billNo: bill.billNo || "",
      billDate: bill.billDate || "",
    };
  }

  // auto-fill a colour row from its bill (meters stay manual)
  function applyBill(ci, billId) {
    const bill = bills.find(b => b.id === billId);
    setRows(r => ({ ...r, [ci]: { ...(r[ci]||{}), billId, ...billFields(bill) } }));
  }
  function updRow(ci, k, v) { setRows(r => ({ ...r, [ci]: { ...(r[ci]||{}), [k]: v } })); }

  // when "same bill" is on, keep every colour's bill fields synced to the common bill
  useEffect(() => {
    if (!sameBill || !commonBillId) return;
    const bill = bills.find(b => b.id === commonBillId);
    setRows(r => {
      const o = { ...r };
      colors.forEach((c,ci) => { o[ci] = { ...(o[ci]||{}), billId:commonBillId, ...billFields(bill), meters:(o[ci]||{}).meters||"" }; });
      return o;
    });
  }, [sameBill, commonBillId, supCity, bills.length]);

  function save() {
    onUpdate({
      ...design,
      barcodeBlocks: { sameBill, commonBillId, rows },
      barcodeBlock: rows[0] ? { ...rows[0], billId: rows[0].billId } : legacy,   // keep old field in sync (CSV/preview)
      productionDate: design.productionDate || new Date().toISOString().slice(0,10),
    });
  }

  if (!design.mrpFinalized) {
    return <div style={{ background:T.orange+"22", border:`1px solid ${T.orange}`, borderRadius:8, padding:16, fontFamily:T.mono, fontSize:12, color:T.orange }}>⚠ Barcode is locked until MRP is finalized. Set the MRP first.</div>;
  }
  if (colors.length === 0) {
    return <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:8, padding:16, fontFamily:T.mono, fontSize:12, color:T.textDim }}>Is design me koi colour nahi hai. Pehle Fill Sizes me colour add karo.</div>;
  }

  // design ka total = saare colour rows ke meters ka jod (ek bill me kai design ho sakti hain, isliye rows se)
  const designTotalMeters = colors.reduce((a,c,ci) => a + (+((rows[ci]||{}).meters)||0), 0);

  const topLine = buildBarcodeTop(design, jobbers, design.productionDate);
  const billLabel = b => `${b.supplier||"—"} · Bill ${b.billNo||"—"} · ${b.qty||b.meters||0}m${b.billDate?" · "+b.billDate:""}`;
  const selS = { background:T.surface, border:`1px solid ${T.border}`, color:T.text, borderRadius:6, padding:"7px 10px", fontSize:12, width:"100%", boxSizing:"border-box" };
  const inS  = { background:T.surface, border:`1px solid ${T.border}`, color:T.text, borderRadius:5, padding:"6px 8px", fontFamily:T.mono, fontSize:12, width:"100%", boxSizing:"border-box" };
  const lb   = { fontFamily:T.mono, fontSize:8, color:T.steelLt, textTransform:"uppercase", display:"block", marginBottom:2 };

  return (
    <div>
      <div style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, marginBottom:10, textTransform:"uppercase" }}>Fabric Trace (below barcode) — colour-wise · bill se auto · meters manual · sab editable<br/><span style={{ color:T.gold }}>Design total: {designTotalMeters} m — trace me aise aayega: {designTotalMeters}(colour ke meters)</span></div>

      {bills.length === 0 && (
        <div style={{ background:T.orange+"18", border:`1px solid ${T.orange}`, borderRadius:8, padding:12, fontFamily:T.mono, fontSize:11, color:T.orange, marginBottom:14 }}>
          ⚠ Is design me koi fabric bill nahi hai. Pehle Supplier Bills me fabric bill add karo.
        </div>
      )}

      <label style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10, fontFamily:T.mono, fontSize:12, color:T.text, cursor:"pointer" }}>
        <input type="checkbox" checked={sameBill} onChange={e=>setSameBill(e.target.checked)} style={{ width:16, height:16, accentColor:T.gold }} />
        Same bill for all colours (sab colour ka ek hi bill)
      </label>

      {sameBill && (
        <div style={{ maxWidth:420, marginBottom:14 }}>
          <label style={lb}>Bill (is design ke bills me se)</label>
          <select value={commonBillId} onChange={e=>setCommonBillId(e.target.value)} style={selS}>
            <option value="">— bill chuno —</option>
            {bills.map(b => <option key={b.id} value={b.id}>{billLabel(b)}</option>)}
          </select>
        </div>
      )}

      <div style={{ overflowX:"auto", marginBottom:16 }}>
        <table style={{ width:"100%", borderCollapse:"collapse", minWidth:700 }}>
          <thead><tr style={{ background:T.surface }}>
            {["Colour", ...(sameBill?[]:["Bill (chuno)"]), "Meters *", "Rate", "Initials", "City", "Bill No", "Bill Date", "Trace code"].map(h =>
              <th key={h} style={{ padding:"7px 8px", fontFamily:T.mono, fontSize:8, color:T.steelLt, textAlign:"left", textTransform:"uppercase", border:`1px solid ${T.border}` }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {colors.map((c,ci) => {
              const r = rows[ci] || {};
              const trace = buildFabricBlock(r, designTotalMeters);
              const td = { padding:"5px 6px", border:`1px solid ${T.border}` };
              return (
                <tr key={ci} style={{ background: ci%2 ? T.card : T.surface }}>
                  <td style={{...td, fontFamily:T.mono, fontSize:12, color:T.gold, fontWeight:700, whiteSpace:"nowrap"}}>{c.colorNo||`C${ci+1}`}{c.colorName?` (${c.colorName})`:""}</td>
                  {!sameBill && (
                    <td style={{...td, minWidth:190}}>
                      <select value={r.billId||""} onChange={e=>applyBill(ci, e.target.value)} style={selS}>
                        <option value="">— bill chuno —</option>
                        {bills.map(b => <option key={b.id} value={b.id}>{billLabel(b)}</option>)}
                      </select>
                    </td>
                  )}
                  <td style={{...td, width:76}}><input type="number" value={r.meters||""} onChange={e=>updRow(ci,"meters",e.target.value)} placeholder="meters" style={{...inS, borderColor: r.meters?T.border:T.orange}} /></td>
                  <td style={{...td, width:70}}><input type="number" value={r.rate||""} onChange={e=>updRow(ci,"rate",e.target.value)} style={inS} /></td>
                  <td style={{...td, width:66}}><input value={r.initials||""} onChange={e=>updRow(ci,"initials",e.target.value.toUpperCase())} style={inS} /></td>
                  <td style={{...td, width:48}}><input value={r.cityLetter||""} onChange={e=>updRow(ci,"cityLetter",e.target.value.toUpperCase().slice(0,1))} placeholder="A" style={inS} /></td>
                  <td style={{...td, width:66}}><input value={r.billNo||""} onChange={e=>updRow(ci,"billNo",e.target.value)} style={inS} /></td>
                  <td style={{...td, width:120}}><input type="date" value={r.billDate||""} onChange={e=>updRow(ci,"billDate",e.target.value)} style={inS} /></td>
                  <td style={{...td, fontFamily:T.mono, fontSize:11, color:T.green, fontWeight:700, whiteSpace:"nowrap"}}>{trace||"—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ display:"flex", gap:10, marginBottom:20, alignItems:"flex-end", flexWrap:"wrap" }}>
        <Inp label="Production Date (auto today, editable)" type="date" value={design.productionDate || new Date().toISOString().slice(0,10)} onChange={v => onUpdate({ ...design, productionDate:v })} style={{ maxWidth:220 }} />
        <Btn label="Save Barcode Data" onClick={save} />
      </div>

      {/* preview — first colour */}
      <div style={{ background:"#fff", borderRadius:10, padding:"20px 24px", maxWidth:420, margin:"0 auto", boxShadow:"0 4px 20px #0006" }}>
        <div style={{ textAlign:"center", fontFamily:T.mono, fontSize:9, color:"#888", marginBottom:4 }}>preview — {colors[0]?.colorNo||"C1"}{colors[0]?.colorName?` (${colors[0].colorName})`:""}</div>
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
        <div style={{ textAlign:"center", fontFamily:T.mono, fontSize:11, fontWeight:700, color:"#000", letterSpacing:0.5 }}>{buildFabricBlock(rows[0]||{}, designTotalMeters) || "—"}</div>
      </div>

      <div style={{ marginTop:18, background:T.surface, borderRadius:8, padding:14 }}>
        <div style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, marginBottom:8, textTransform:"uppercase" }}>Plain Text (for printing / copy)</div>
        <div style={{ fontFamily:T.mono, fontSize:13, color:T.gold, marginBottom:6 }}>ABOVE: {topLine||"—"}</div>
        {colors.map((c,ci) => (
          <div key={ci} style={{ fontFamily:T.mono, fontSize:12, color:T.steelLt, marginBottom:3 }}>
            BELOW · {c.colorNo||`C${ci+1}`}{c.colorName?` (${c.colorName})`:""}: <b style={{color:T.text}}>{buildFabricBlock(rows[ci]||{}, designTotalMeters)||"—"}</b>
          </div>
        ))}
      </div>
    </div>
  );
}
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
    rows.push({ kind:"move", date:m.date||m.sentDate||m.receivedDate||"", process:m.halfStitch?"Half Stitch":"Movement", jobber:m.jobber||"", from:m.receivedFrom||"", to:m.sentTo||"", qty:m.qty||"", recd:m.receivedDate||"", dlvd:m.sentDate||"", days:daysBetween(m.receivedDate,m.sentDate), remark:m.remark||"" });
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
function DesignDetail({ design, jobbers, onBack, onUpdate, showToast, role, currentUser, currentJobber, onAddJobber, L = (x)=>x, onSendLot, people, challans = [], creditNotes = [], locks = [], setLocks }) {
  const isAdmin = role === "admin";
  const isTeam = role === "team";
  const isJobber = role === "jobber";
  const DTABS = isJobber
    ? ["Fill Sizes","Job Sheet","Process & Flow","Photos"]
    : ["Job Sheet","Fill Sizes","Process & Flow","Customer Orders","Photos","Movement","Supplier Bills",...(isAdmin?["Cost Sheet","MRP","Barcode","Pending Approvals"]:[])];
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
      {dt==="Process & Flow" && (
        <div id="rpt-procflow">
          {isAdmin && <Section title="Process Register & Cost Code" action={<PdfBtn targetId="rpt-procflow" title={`Process & Flow ${design.designNo}`} />}><ProcessRegister design={design} jobbers={jobbers} challans={challans} onUpdate={updProcess} role={role} /></Section>}
          <Section title="Production Flow — full journey"><ProductionFlow design={design} jobbers={jobbers} /></Section>
        </div>
      )}
      {dt==="Fill Sizes" && <Section title="Job Register — Fill Cut Sizes" action={<PdfBtn targetId="rpt-sizes" title={`Job Register ${designLabel(design)}`} />}><div id="rpt-sizes"><SizeEditor design={design} onUpdate={save} role={role} onConfirmLock={confirmLock} L={L} onSendLot={onSendLot} people={people||jobbers} currentJobber={currentJobber} /></div></Section>}
      {dt==="Customer Orders" && <Section title="Customer Orders"><CustomerOrders design={design} onUpdate={save} role={role} /></Section>}
      {dt==="Photos" && <Section title="Reference Photos & Shirt Details"><ReferencePhotos design={design} onUpdate={save} role={role} /></Section>}
      {dt==="Movement" && <Section title="Movement Log"><MovementLog design={design} jobbers={jobbers} onAdd={addMovement} role={role} /></Section>}
      {dt==="Supplier Bills" && <Section title="Fabric Supplier Bills"><SupplierBills design={design} onUpdate={save} role={role} allSuppliers={(design.supplierBills||[]).map(b=>b.supplier).filter(Boolean)} creditNotes={creditNotes} locks={locks} setLocks={setLocks} currentUser={currentUser} /></Section>}
      {dt==="Cost Sheet" && isAdmin && <Section title="Design Cost Sheet" action={<PdfBtn targetId="rpt-cost" title={`Cost Sheet ${design.designNo}`} />}><div id="rpt-cost"><DesignCostSheet design={design} jobbers={jobbers} challans={challans} /></div></Section>}
      {dt==="MRP" && isAdmin && <Section title="MRP & Product Codes"><MRPPanel design={design} onUpdate={save} /></Section>}
      {dt==="Barcode" && isAdmin && <Section title="Barcode Generator"><BarcodePanel design={design} jobbers={jobbers} onUpdate={save} /></Section>}
      {dt==="Pending Approvals" && isAdmin && <Section title="Pending Approvals"><PendingApprovals design={design} jobbers={jobbers} onApprove={approveEntry} onReject={rejectEntry} /></Section>}
    </div>
  );
}

// ── Process Assignment dropdown (filtered by process, show-all toggle, Other) ──
function ProcessAssignRow({ procName, jobbers, value, autoValue, onChange, onAddJobber }) {
  const [showAll, setShowAll] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPrefix, setNewPrefix] = useState("");
  const list = showAll ? jobbers : jobbers.filter(j => jobberDoesProcess(j, procName));
  const effValue = value || autoValue || "";
  const linkedFromChallan = !value && !!autoValue;
  const autoName = autoValue ? (jobbers.find(j=>j.id===autoValue)||{}).name||"" : "";
  async function addNew() {
    if (!newName.trim()) return;
    const created = await onAddJobber({ name:newName.trim(), process:procName, prefix:newPrefix.trim() });
    if (created) onChange(created.id);
    setAdding(false); setNewName(""); setNewPrefix("");
  }
  return (
    <div style={{ background:T.surface, borderRadius:8, padding:12, border:`1px solid ${linkedFromChallan?T.green:T.border}` }}>
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
        <>
        <select value={effValue} onChange={e => { if (e.target.value === "__other__") { setAdding(true); } else { onChange(e.target.value); } }} style={{ background:T.bg, border:`1px solid ${linkedFromChallan?T.green:T.border}`, color:T.text, borderRadius:6, padding:"7px 10px", fontSize:12, width:"100%" }}>
          <option value="">{linkedFromChallan?`↳ ${autoName} (from challan)`:"— not assigned yet —"}</option>
          {list.map(j => <option key={j.id} value={j.id}>{j.name}{j.prefix?` (${j.prefix})`:""}</option>)}
          <option value="__other__">+ Other (add new jobber)</option>
        </select>
        {linkedFromChallan && <div style={{ fontFamily:T.mono, fontSize:8, color:T.green, marginTop:3 }}>auto from challan · editable</div>}
        </>
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
function DesignForm({ onSave, onCancel, existing, jobbers = [], onAddJobber, designs = [], creditNotes = [], challans = [] }) {
  const blank = { designNo:"", lotNo:"", brand:"RUDE INC", style:"", fabric:"", supplier:"", p1Code:"", p1MRP:"", p2Code:"", p2MRP:"", fit:"Slim Fit", collarType:"Round Collar", shrinkageLen:"", shrinkageWid:"", placket:"Inside", washType:"Normal", specs: SPEC_KEYS.map(k => ({ key:k, text:"", thumb:"" })), ratio:{}, trims:"", drawingAvg:"", manualAvg:{ smxxl:"", x3to5:"", bigLabel:"6XL+", big:"" }, dateProgram:"", dateCut:"", mainThumb:"", notes:"", keywords:"", instructions:"", customSizes:[], photos:[], colors:[], activeColors:["S","M","L","XL","XXL"], processes:{}, movements:[], jobberEntries:[], supplierBills:[], customerOrders:[], status:"New", mrpFinalized:false };
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
  function addFabricBill() { setD(f => ({...f, supplierBills:[...(f.supplierBills||[]), {id:`B${Date.now()}`, billType:"Fabric", supplier:"", billNo:"", billDate:"", lrNo:"", qty:"", rate:"", amount:"", hasGst:false, photo:"", appliesTo:[]}]})); }
  // swatch (colour) meters for any design number — used to auto-fill fabric-used meters
  function swatchMetersOf(dno){ const t=String(dno||"").trim(); if(!t) return null; if(String(d.designNo||"").trim()===t) return (d.colors||[]).reduce((a,c)=>a+(+c.meters||0),0); const dd=(designs||[]).find(x=>String(x.designNo).trim()===t); return dd?(dd.colors||[]).reduce((a,c)=>a+(+c.meters||0),0):null; }
  function updFabricBill(id,k,v) { setD(f => ({...f, supplierBills:(f.supplierBills||[]).map(b => { if(b.id!==id) return b; const nb={...b,[k]:v}; if(k==="qty"||k==="rate") nb.amount=((+nb.qty||0)*(+nb.rate||0))||""; return nb; })})); }
  function removeFabricBill(id) { setD(f => ({...f, supplierBills:(f.supplierBills||[]).filter(b => b.id!==id)})); }
  function addBillDesign(billId) { setD(f => ({...f, supplierBills:(f.supplierBills||[]).map(b => b.id===billId ? {...b, appliesTo:[...(b.appliesTo||[]), {designNo:"", meters:""}]} : b)})); }
  function updBillDesign(billId, idx, k, v) { setD(f => ({...f, supplierBills:(f.supplierBills||[]).map(b => b.id!==billId ? b : {...b, appliesTo:(b.appliesTo||[]).map((x,i)=>{
    if(i!==idx) return x;
    const nx={...x,[k]:v};
    if(k==="designNo"){ const sm=swatchMetersOf(v); if(sm!=null && (nx.meters===""||nx.meters==null)) nx.meters=sm; }   // auto meters from swatch
    if(k==="meters"||k==="rate") nx.amount=((+nx.meters||0)*(+nx.rate||0))||"";
    return nx;
  })} )})); }
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
  function ensureSpecs(arr) {
    const base = SPEC_KEYS.map(k => (arr||[]).find(x=>x.key===k) || { key:k, text:"", thumb:"", rate:"" });
    const extra = (arr||[]).filter(x => x && x.custom && !SPEC_KEYS.includes(x.key));
    return [...base, ...extra];
  }
  function addCustomSpec() { setD(f => ({ ...f, specs: [...ensureSpecs(f.specs), { key:`Other ${(ensureSpecs(f.specs).filter(x=>x.custom).length)+1}`, text:"", thumb:"", rate:"", custom:true }] })); }
  function updSpecKey(oldKey, newKey) { setD(f => ({ ...f, specs: ensureSpecs(f.specs).map(sp => sp.key===oldKey ? {...sp, key:newKey} : sp) })); }
  function removeSpec(key) { setD(f => ({ ...f, specs: ensureSpecs(f.specs).filter(sp => !(sp.custom && sp.key===key)) })); }
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
          <Inp label="Sample No" value={d.sampleNo||""} onChange={upd("sampleNo")} placeholder="e.g. S-12" />
          <Inp label="Brand" value={d.brand} onChange={upd("brand")} />
          <Inp label="Style" value={d.style} onChange={upd("style")} />
          <Inp label="Fabric" value={d.fabric} onChange={upd("fabric")} />
          <Inp label="Supplier" value={d.supplier} onChange={upd("supplier")} />
          <Inp label="Fit" value={d.fit} onChange={upd("fit")} options={FITS} />
          <Inp label="Sleeve Type" value={d.sleeveType||"Full"} onChange={upd("sleeveType")} options={["Full","Half","Both"]} />
          <div>
            <div style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, marginBottom:4, textTransform:"uppercase" }}>Total Meters (all colours)</div>
            <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:6, padding:"9px 11px", fontFamily:T.mono, fontSize:14, fontWeight:700, color:T.gold }}>
              {(() => { const full=(d.colors||[]).reduce((a,c)=>a+(+c.meters||0),0); const half=(d.colors||[]).reduce((a,c)=>a+(+c.metersHalf||0),0); const tot=full+half; return tot? `${tot} m${half?` (${full}+${half})`:""}` : "—"; })()}
            </div>
          </div>
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
              <div style={{ flex:1, display:"flex", flexDirection:"column", gap:6 }}>
                {sp.custom
                  ? <div style={{ display:"flex", gap:6, alignItems:"flex-end" }}>
                      <div style={{ flex:1 }}><Inp label="Name (apna naam likho)" value={sp.key} onChange={v => updSpecKey(sp.key, v)} placeholder="e.g. Packing" /></div>
                      <Btn label="✕" onClick={() => removeSpec(sp.key)} color={T.red+"22"} textColor={T.red} small />
                    </div>
                  : null}
                <Inp label={sp.custom ? "Details" : sp.key} value={sp.text} onChange={v => updSpec(sp.key,"text",v)} placeholder="details (optional)" />
                <Inp label="Rate / piece (Rs.)" type="number" value={sp.rate||""} onChange={v => updSpec(sp.key,"rate",v)} placeholder="cost sheet me judega" />
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop:10 }}>
          <Btn label="+ Other (naya item + rate)" onClick={addCustomSpec} color={T.gold} textColor={T.bg} small />
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
                <PhotoUpload value={c.swatch} onChange={v => updColor(c.id,"swatch",v)} size={56} small={true} />
                <div style={{ flex:1 }}>
                  <Inp label={`Color ${ci+1}`} value={c.colorName} onChange={v => updColor(c.id,"colorName",v)} placeholder="e.g. Navy Blue" />
                  <div style={{ marginTop:6 }}>
                    <Inp label="Color No" value={c.colorNo||""} onChange={v => updColor(c.id,"colorNo",v)} placeholder="201" />
                  </div>
                  <div style={{ marginTop:6 }}><Inp label={d.sleeveType==="Both"?"Full Sleeve Meters":"Meters"} value={c.meters} onChange={v => updColor(c.id,"meters",v)} type="number" /></div>
                  {d.sleeveType==="Both" && <div style={{ marginTop:6 }}><Inp label="Half Sleeve Meters" value={c.metersHalf||""} onChange={v => updColor(c.id,"metersHalf",v)} type="number" /></div>}
                  <div style={{ marginTop:6, display:"flex", gap:8, flexWrap:"wrap" }}>
                    <div style={{ flex:1, minWidth:90 }}><Inp label="Shrinkage" value={c.shrinkage||""} onChange={v => updColor(c.id,"shrinkage",v)} placeholder="e.g. 3%" /></div>
                    <div style={{ flex:1, minWidth:90 }}><Inp label="Sample Shrinkage" value={c.sampleShrinkage||""} onChange={v => updColor(c.id,"sampleShrinkage",v)} placeholder="e.g. 2%" /></div>
                  </div>
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
                <div style={{ gridColumn:"1 / -1" }}><SupplierPicker value={b.supplier} onChange={v => updFabricBill(b.id,"supplier",v)} allSuppliers={designs.flatMap(dd=>(dd.supplierBills||[]).map(x=>x.supplier).filter(Boolean))} /></div>
                <Inp label="Quantity (m)" type="number" value={b.qty} onChange={v => updFabricBill(b.id,"qty",v)} />
                <Inp label="Rate" type="number" value={b.rate} onChange={v => updFabricBill(b.id,"rate",v)} />
                <Inp label="Amount" type="number" value={b.amount} onChange={v => updFabricBill(b.id,"amount",v)} />
                <Inp label="Bill No" value={b.billNo} onChange={v => updFabricBill(b.id,"billNo",v)} />
                <Inp label="LR No" value={b.lrNo} onChange={v => updFabricBill(b.id,"lrNo",v)} />
                <Inp label="Transporter" value={b.transporter||""} onChange={v => updFabricBill(b.id,"transporter",v)} placeholder="transporter name" />
                <Inp label="Transport Cost (Rs.)" type="number" value={b.transportCost||""} onChange={v => updFabricBill(b.id,"transportCost",v)} placeholder="freight cost" />
                <label style={{ gridColumn:"1 / -1", display:"flex", alignItems:"center", gap:8, fontFamily:T.mono, fontSize:11, color:T.text, cursor:"pointer", padding:"4px 0" }}>
                  <input type="checkbox" checked={!!(b.hasGst || +b.gstRate>0)} onChange={e => { const on=e.target.checked; updFabricBill(b.id,"hasGst",on); if(!on) updFabricBill(b.id,"gstRate",""); }} style={{ width:16, height:16, accentColor:T.gold }} />
                  GST लगेगा? (bina GST wale bill ke liye unchecked rakho)
                </label>
                {(b.hasGst || +b.gstRate>0) && <>
                  <Inp label="GST %" value={b.gstRate||""} onChange={v => updFabricBill(b.id,"gstRate",v)} options={["","5","12","18","28"]} />
                  <Inp label="GST Type" value={b.gstType||"CGST+SGST"} onChange={v => updFabricBill(b.id,"gstType",v)} options={["CGST+SGST","IGST"]} />
                  <Inp label="Round Off (Rs.)" type="number" value={b.roundOff??""} onChange={v => updFabricBill(b.id,"roundOff",v)} placeholder="auto" />
                </>}
              </div>
              {/* GST breakdown — amount entered is taxable (before GST); GST added on top */}
              {(+b.gstRate>0 && +b.amount>0) && (() => {
                const taxable = +b.amount||0, rate = +b.gstRate||0;
                const gst = taxable*rate/100;
                const rawTotal = taxable + gst;
                const autoRound = Math.round(rawTotal) - rawTotal; // suggested round off
                const roundOff = b.roundOff!==undefined && b.roundOff!=="" ? +b.roundOff : autoRound;
                const total = rawTotal + roundOff;
                return (
                  <div style={{ background:T.bg, borderRadius:6, padding:"8px 12px", marginBottom:8, fontFamily:T.mono, fontSize:10, color:T.steelLt, display:"flex", gap:16, flexWrap:"wrap", alignItems:"center" }}>
                    <span>Taxable: <b style={{color:T.text}}>Rs.{taxable.toFixed(2)}</b></span>
                    {b.gstType==="IGST"
                      ? <span>IGST {rate}%: <b style={{color:T.gold}}>Rs.{gst.toFixed(2)}</b></span>
                      : <><span>CGST {(rate/2)}%: <b style={{color:T.gold}}>Rs.{(gst/2).toFixed(2)}</b></span><span>SGST {(rate/2)}%: <b style={{color:T.gold}}>Rs.{(gst/2).toFixed(2)}</b></span></>}
                    <span>Round off: <b style={{color:T.steelLt}}>{roundOff>=0?"+":""}{roundOff.toFixed(2)}</b></span>
                    {(b.roundOff===undefined||b.roundOff==="") && Math.abs(autoRound)>0.001 && <button onClick={()=>updFabricBill(b.id,"roundOff",autoRound.toFixed(2))} style={{ background:T.gold, color:T.bg, border:"none", borderRadius:4, padding:"2px 8px", fontFamily:T.mono, fontSize:9, cursor:"pointer" }}>use auto {autoRound>=0?"+":""}{autoRound.toFixed(2)}</button>}
                    <span>Total: <b style={{color:T.white}}>Rs.{total.toFixed(2)}</b></span>
                  </div>
                );
              })()}
              {/* This bill also covers other designs (split meters) */}
              <div style={{ background:T.bg, borderRadius:6, padding:10, marginTop:8, marginBottom:8 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
                  <span style={{ fontFamily:T.mono, fontSize:9, color:T.steelLt, textTransform:"uppercase" }}>This bill also covers other designs (split meters)</span>
                  <Btn label="+ add design" onClick={() => addBillDesign(b.id)} small color={T.surface} textColor={T.gold} style={{ border:`1px solid ${T.border}` }} />
                </div>
                {(() => {
                  const thisSw = (d.colors||[]).reduce((a,c)=>a+(+c.meters||0),0);
                  const thisMatch = Math.abs((+b.qty||0)-thisSw)<0.01 && thisSw>0;
                  return (
                    <div style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, marginBottom:6 }}>
                      This design ({d.designNo||"current"}): bill <b style={{color:T.gold}}>{b.qty||0} m</b> · swatch <b style={{color: thisMatch?T.green:T.red}}>{thisSw} m</b> {thisSw>0 && (thisMatch?"✓":"⚠")}
                      {(b.appliesTo||[]).length>0 && <span> &nbsp;· grand total: <b style={{color:T.gold}}>{((+b.qty||0)+(b.appliesTo||[]).reduce((a,x)=>a+(+x.meters||0),0))} m</b></span>}
                    </div>
                  );
                })()}
                {(b.appliesTo||[]).map((ad,adi) => {
                  const sw = swatchMetersOf(ad.designNo);
                  const rowMatch = sw!=null && sw>0 && Math.abs((+ad.meters||0)-sw)<0.01;
                  return (
                  <div key={adi} style={{ display:"flex", gap:8, alignItems:"flex-end", marginBottom:6, flexWrap:"wrap", border:`1px solid ${sw==null?T.border:(rowMatch?T.green:T.red)}`, borderRadius:6, padding:6 }}>
                    <div style={{ display:"flex", flexDirection:"column", gap:3, flex:"2 1 130px" }}>
                      <label style={{ fontFamily:T.mono, fontSize:8, color:T.steelLt, textTransform:"uppercase" }}>Other Design No</label>
                      <input value={ad.designNo} onChange={e => updBillDesign(b.id,adi,"designNo",e.target.value)} list={`designs-${b.id}`} placeholder="design no" style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:5, color:T.text, fontFamily:T.sans, fontSize:12, padding:"6px 8px", width:"100%", boxSizing:"border-box" }} />
                    </div>
                    <div style={{ display:"flex", flexDirection:"column", gap:3, width:88 }}>
                      <label style={{ fontFamily:T.mono, fontSize:8, color:T.steelLt, textTransform:"uppercase" }}>Meters {sw!=null && <span style={{color: rowMatch?T.green:T.gold}}>(swatch {sw})</span>}</label>
                      <input type="number" value={ad.meters} onChange={e => updBillDesign(b.id,adi,"meters",e.target.value)} style={{ background:T.surface, border:`1px solid ${sw==null?T.border:(rowMatch?T.green:T.red)}`, borderRadius:5, color:T.text, fontFamily:T.mono, fontSize:12, padding:"6px 8px", width:"100%", boxSizing:"border-box" }} />
                    </div>
                    <div style={{ display:"flex", flexDirection:"column", gap:3, width:76 }}>
                      <label style={{ fontFamily:T.mono, fontSize:8, color:T.steelLt, textTransform:"uppercase" }}>Rate</label>
                      <input type="number" value={ad.rate||""} onChange={e => updBillDesign(b.id,adi,"rate",e.target.value)} placeholder="rate" style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:5, color:T.text, fontFamily:T.mono, fontSize:12, padding:"6px 8px", width:"100%", boxSizing:"border-box" }} />
                    </div>
                    <div style={{ display:"flex", flexDirection:"column", gap:3, width:84 }}>
                      <label style={{ fontFamily:T.mono, fontSize:8, color:T.steelLt, textTransform:"uppercase" }}>Amount</label>
                      <div style={{ fontFamily:T.mono, fontSize:12, color:T.gold, padding:"6px 8px" }}>{ad.amount?("Rs."+ad.amount):"—"}</div>
                    </div>
                    {sw!=null && !rowMatch && +ad.meters!==sw && <Btn label={`use ${sw}m`} onClick={() => updBillDesign(b.id,adi,"meters",String(sw))} small color={T.gold} textColor={T.bg} />}
                    <Btn label="✕" onClick={() => removeBillDesign(b.id,adi)} color={T.red+"22"} textColor={T.red} small />
                  </div>
                  );
                })}
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
          const otherDesignQty = (d.supplierBills||[]).filter(b=>(b.billType||"Fabric")==="Fabric").reduce((a,b)=>a+(b.appliesTo||[]).reduce((x,ad)=>x+(+ad.meters||0),0),0);
          const diff = +(fabricBillQty - colourMeters).toFixed(2);
          const match = Math.abs(diff) < 0.01;
          return (
            <div style={{ marginTop:14, background:match?T.bg:T.red+"22", borderRadius:8, padding:"12px 16px", border:`2px solid ${match?T.green:T.red}` }}>
              <div style={{ fontFamily:T.mono, fontSize:12, color:T.steelLt }}>
                This design bill: <b style={{color:T.gold}}>{fabricBillQty} m</b> &nbsp;·&nbsp; This design swatch: <b style={{color:match?T.green:T.red}}>{colourMeters} m</b>
                {otherDesignQty>0 && <span> &nbsp;·&nbsp; Allocated to other designs: <b style={{color:T.gold}}>{otherDesignQty} m</b> &nbsp;·&nbsp; grand bill: <b style={{color:T.gold}}>{fabricBillQty+otherDesignQty} m</b></span>}
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
                <thead><tr style={{ background:T.surface }}>{["Date","CN No","Against Bill","Against","Reason","Amount (this design)"].map(h => <th key={h} style={{ padding:"6px 8px", fontFamily:T.mono, fontSize:8, color:T.steelLt, textAlign:"left", textTransform:"uppercase", border:`1px solid ${T.border}` }}>{h}</th>)}</tr></thead>
                <tbody>
                  {linked.map((c,i) => {
                    const amtThis = (c.lines||[]).filter(l=>String(l.designNo)===dn).reduce((a,l)=>a+(+l.amount||0),0);
                    const billThis = [...new Set((c.lines||[]).filter(l=>String(l.designNo)===dn).map(l=>l.billNo).filter(Boolean))].join(", ");
                    const against = c.partyType==="supplier" ? `Supplier: ${c.party}` : `Jobber: ${(jobbers.find(j=>j.id===c.party)||{}).name||c.party}`;
                    return (
                      <tr key={c.id||i} style={{ background:i%2===0?T.card:T.surface }}>
                        <td style={{ padding:"6px 8px", color:T.steelLt, fontFamily:T.mono, border:`1px solid ${T.border}` }}>{c.cnDate}</td>
                        <td style={{ padding:"6px 8px", color:T.gold, fontFamily:T.mono, border:`1px solid ${T.border}` }}>{c.cnNo}</td>
                        <td style={{ padding:"6px 8px", color:T.text, fontFamily:T.mono, border:`1px solid ${T.border}` }}>{billThis||"—"}</td>
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
              <textarea
                value={p.note||""}
                onChange={e => setD(f => ({ ...f, photos:(f.photos||[]).map(x => x.id===p.id ? { ...x, note:e.target.value } : x) }))}
                placeholder="Describe this photo…"
                rows={2}
                style={{ width:"100%", boxSizing:"border-box", background:T.bg, border:"none", borderTop:`1px solid ${T.border}`, color:T.text, fontFamily:T.sans, fontSize:11, padding:"6px 8px", resize:"vertical", outline:"none" }}
              />
            </div>
          ))}
        </div>
      </Section>
      </div>
      <div {...dragHandle("process")}>
        {handleBar}
      <Section title="Process Assignments (optional — can fill later)">
        {(d.createdByJobberId || d.processes?._createdByJobberId) && <div style={{ background:T.green+"15", border:`1px solid ${T.green}`, borderRadius:8, padding:"8px 12px", marginBottom:10, fontFamily:T.mono, fontSize:11, color:T.green }}>✓ Created by jobber: {(jobbers.find(j=>j.id===(d.createdByJobberId||d.processes?._createdByJobberId))||{}).name||"jobber"} — auto-assigned to Stitch (editable below)</div>}
        <div style={{ fontFamily:T.mono, fontSize:10, color:T.textDim, marginBottom:12 }}>Assign a jobber for each process now, or leave blank — it can be set later, or auto-fills when a jobber logs their work.</div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))", gap:12 }}>
          {PROCESSES.filter(p => p!=="Fabric" && p!=="Cut to Pack" && p!=="Other").map(pn => {
            // auto-fill from challans: find a challan line for THIS design + this process.
            // The person who DOES the process is whoever the work was SENT TO (sentToId); if none, the challan creator.
            let challanJobberId = "";
            (challans||[]).forEach(c => {
              if (c.status==="rejected") return;
              if (!challanDesigns(c).includes(String(d.designNo))) return;
              const lns = (c.lines&&c.lines.length)?c.lines:[{designNo:c.designNo,process:c.process,sentToId:c.sendToId}];
              lns.forEach(l => {
                if (String(l.designNo)!==String(d.designNo)) return;
                const lp = (l.process||"").toLowerCase();
                if (lp.includes(pn.toLowerCase()) || pn.toLowerCase().includes(lp)) {
                  challanJobberId = l.sentToId || c.sendToId || c.jobberId;
                }
              });
            });
            return <ProcessAssignRow key={pn} procName={pn} jobbers={jobbers} value={d.processes?.[pn]?.jobber} autoValue={challanJobberId} onChange={id => assignProc(pn, id)} onAddJobber={onAddJobber} />;
          })}
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

// ── Fabric Stock (all designs: bought vs cut, remaining) ──────────────────────
// Bought (per design) = own fabric-bill meters + meters allocated to it from other bills (appliesTo).
// Colour-wise (Option A): design bought is split across colours by their swatch-meter share.
// Used = fill-sizes pieces × NET average. <=1.25m leftover → stock 0 (shown separately as info).
function FabricStock({ designs }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState({}); // designNo -> expanded?
  const SCRAP = 1.25;

  function boughtMeters(dn) {
    const t = String(dn||"").trim();
    let m = 0;
    (designs||[]).forEach(dd => {
      if (String(dd.designNo).trim() === t)
        (dd.supplierBills||[]).filter(b=>(b.billType||"Fabric")==="Fabric").forEach(b => { m += (+b.qty||0); });
      (dd.supplierBills||[]).filter(b=>(b.billType||"Fabric")==="Fabric").forEach(b =>
        (b.appliesTo||[]).forEach(ad => { if (String(ad.designNo).trim() === t) m += (+ad.meters||0); }));
    });
    return +m.toFixed(2);
  }

  const rows = (designs||[])
    .filter(d => String(d.designNo||"").trim())
    .map(d => {
      const designBought = boughtMeters(d.designNo);
      const avg = +fabricAverageNet(d) || 0;
      const cols = (d.colors||[]);
      const swatchTotal = cols.reduce((a,c)=>a+(+c.meters||0)+(+c.metersHalf||0),0);
      // colour-wise breakdown
      const colours = cols.map((c,ci) => {
        const cMeters = (+c.meters||0)+(+c.metersHalf||0);
        const share = swatchTotal>0 ? cMeters/swatchTotal : 0;
        const cBought = +(designBought*share).toFixed(2);
        const cPcs = Object.values(c.sizes||{}).reduce((x,v)=>x+(+v||0),0) + Object.values(c.sizesHalf||{}).reduce((x,v)=>x+(+v||0),0);
        const cUsed = +(cPcs*avg).toFixed(2);
        const cRemainRaw = +(cBought - cUsed).toFixed(2);
        const cFully = cBought>0 && cRemainRaw <= SCRAP;
        const cRemain = cFully ? 0 : cRemainRaw;
        const cLeft = cFully && cRemainRaw>0.01 ? cRemainRaw : 0;
        return { name:c.colorName||c.colorNo||`Colour ${ci+1}`, bought:cBought, pcs:cPcs, used:cUsed, remain:cRemain, left:cLeft, fully:cFully, hasBill:cBought>0 };
      });
      const pcs = totalPieces(d);
      const consumed = +colours.reduce((a,c)=>a+c.used,0).toFixed(2);
      const remain = +colours.reduce((a,c)=>a+c.remain,0).toFixed(2);
      const leftover = +colours.reduce((a,c)=>a+c.left,0).toFixed(2);
      const fullyCut = designBought>0 && +(designBought-consumed).toFixed(2) <= SCRAP;
      return { dn:d.designNo, style:d.style||"", bought:designBought, pcs, avg, consumed, remain, leftover, fullyCut, hasBill:designBought>0, colours };
    })
    .filter(r => !q.trim() || String(r.dn).toLowerCase().includes(q.trim().toLowerCase()) || (r.style||"").toLowerCase().includes(q.trim().toLowerCase()));

  const totBought = rows.reduce((a,r)=>a+r.bought,0);
  const totRemain = rows.reduce((a,r)=>a+r.remain,0);
  const totLeft = rows.reduce((a,r)=>a+r.leftover,0);
  const th = { padding:"8px 10px", fontFamily:T.mono, fontSize:9, color:T.steelLt, textAlign:"left", textTransform:"uppercase", border:`1px solid ${T.border}` };
  const td = { padding:"8px 10px", fontFamily:T.mono, fontSize:12, color:T.text, border:`1px solid ${T.border}` };
  const tdc = { padding:"6px 10px 6px 24px", fontFamily:T.mono, fontSize:11, color:T.steelLt, border:`1px solid ${T.border}` };

  return (
    <div>
      <div style={{ display:"flex", gap:12, marginBottom:14, flexWrap:"wrap" }}>
        <div style={{ background:T.card, borderRadius:10, padding:"12px 18px", borderLeft:`3px solid ${T.gold}`, minWidth:130 }}>
          <div style={{ fontFamily:T.mono, fontSize:22, fontWeight:900, color:T.gold }}>{totBought.toFixed(1)} m</div>
          <div style={{ fontSize:11, color:T.steelLt }}>Total fabric bought</div>
        </div>
        <div style={{ background:T.card, borderRadius:10, padding:"12px 18px", borderLeft:`3px solid ${T.green}`, minWidth:130 }}>
          <div style={{ fontFamily:T.mono, fontSize:22, fontWeight:900, color:T.green }}>{totRemain.toFixed(1)} m</div>
          <div style={{ fontSize:11, color:T.steelLt }}>Fabric stock remaining</div>
        </div>
        <div style={{ background:T.card, borderRadius:10, padding:"12px 18px", borderLeft:`3px solid ${T.steelLt}`, minWidth:130 }}>
          <div style={{ fontFamily:T.mono, fontSize:22, fontWeight:900, color:T.steelLt }}>{totLeft.toFixed(1)} m</div>
          <div style={{ fontSize:11, color:T.steelLt }}>Leftover scraps (info)</div>
        </div>
      </div>
      <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search design no / style…" style={{ background:T.surface, border:`2px solid ${T.gold}`, borderRadius:8, color:T.text, fontFamily:T.mono, fontSize:14, padding:"10px 14px", width:"100%", boxSizing:"border-box", outline:"none", marginBottom:14 }} />
      <div style={{ overflowX:"auto" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", minWidth:680 }}>
          <thead><tr style={{ background:T.surface }}>
            {["Design No","Style","Bought (m)","Cut pcs","Net avg","Used (m)","Stock (m)","Leftover (info)","Status"].map(h => <th key={h} style={th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {rows.map((r,i) => (
              <Fragment key={r.dn+i}>
                <tr onClick={()=>setOpen(o=>({...o,[r.dn]:!o[r.dn]}))} style={{ background: r.fullyCut ? T.green+"18" : (i%2===0?T.card:T.surface), cursor:"pointer" }}>
                  <td style={{...td, color:T.gold, fontWeight:700}}>{(open[r.dn]?"▼ ":"▶ ")}{r.dn}</td>
                  <td style={td}>{r.style||"—"}</td>
                  <td style={td}>{r.bought||"—"}</td>
                  <td style={td}>{r.pcs||0}</td>
                  <td style={td}>{r.avg?r.avg.toFixed(2):"—"}</td>
                  <td style={td}>{r.consumed||0}</td>
                  <td style={{...td, color: r.remain===0?T.green:(r.remain<0?T.red:T.text), fontWeight:700}}>{r.remain}</td>
                  <td style={{...td, color:T.steelLt}}>{r.leftover>0?r.leftover:"—"}</td>
                  <td style={td}>{!r.hasBill ? <span style={{color:T.textDim}}>no bill</span> : r.fullyCut ? <span style={{color:T.green}}>✓ fully cut</span> : <span style={{color:T.orange}}>in stock</span>}</td>
                </tr>
                {open[r.dn] && r.colours.map((c,ci) => (
                  <tr key={r.dn+"-c"+ci} style={{ background:T.bg }}>
                    <td style={tdc}>↳ {c.name}</td>
                    <td style={tdc}></td>
                    <td style={tdc}>{c.bought||"—"}</td>
                    <td style={tdc}>{c.pcs||0}</td>
                    <td style={tdc}>{r.avg?r.avg.toFixed(2):"—"}</td>
                    <td style={tdc}>{c.used||0}</td>
                    <td style={{...tdc, color: c.remain===0?T.green:(c.remain<0?T.red:T.text), fontWeight:700}}>{c.remain}</td>
                    <td style={{...tdc, color:T.steelLt}}>{c.left>0?c.left:"—"}</td>
                    <td style={tdc}>{!c.hasBill ? "—" : c.fully ? <span style={{color:T.green}}>✓</span> : <span style={{color:T.orange}}>in stock</span>}</td>
                  </tr>
                ))}
                {open[r.dn] && r.colours.length===0 && (
                  <tr style={{ background:T.bg }}><td colSpan={9} style={{...tdc, color:T.textDim}}>Is design me colour details nahi hain.</td></tr>
                )}
              </Fragment>
            ))}
            {rows.length===0 && <tr><td colSpan={9} style={{...td, textAlign:"center", color:T.textDim, padding:24}}>No designs found.</td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{ fontFamily:T.mono, fontSize:9, color:T.textDim, marginTop:10 }}>Design pe click karke colour-wise details kholo. Stock = bought − (fill-sizes pcs × net avg). Colour ka bought swatch-meters ke hisaab se banta hai. 1.25m ya kam bache = stock 0 (bacha hua "Leftover" me sirf jaankari ke liye).</div>
    </div>
  );
}

// ── Barcode / Stock (colour+size wise: cut − damage = stock, + barcode value + CSV) ──
// Barcode value = DesignNo-ColourNo-Size (Half sleeve gets "-H"). Damage editable, saved inside colour (jsonb).
function BarcodeStock({ designs, setDesigns, showToast }) {
  const [q, setQ] = useState("");
  const [openD, setOpenD] = useState({});

  function ratioStr(d){ const r=d.ratio||{}; const v=Object.values(r).filter(x=>x!==""&&x!=null); return v.join(" "); }
  function mrpOf(d){ return d.p1MRP||d.p2MRP||""; }
  function productOf(sleeve){ return sleeve==="Half" ? "HALF SLEEVE" : "FULL SLEEVE"; }

  async function setDamage(designId, colorIdx, sleeve, size, val) {
    let updated=null;
    const next=(designs||[]).map(d => {
      if(d.id!==designId) return d;
      const colors=(d.colors||[]).map((c,ci) => {
        if(ci!==colorIdx) return c;
        const key = sleeve==="Half" ? "damageSizesHalf" : "damageSizes";
        return { ...c, [key]: { ...(c[key]||{}), [size]: val } };
      });
      updated={ ...d, colors }; return updated;
    });
    setDesigns(next);
    if(updated){ try { await dbUpsert("designs", dToRow(updated)); } catch(e){ showToast && showToast("Save failed"); } }
  }

  const allRows=[];
  (designs||[]).filter(d=>String(d.designNo||"").trim()).forEach(d => {
    (d.colors||[]).forEach((c,ci) => {
      const cNo=c.colorNo||c.colorName||`C${ci+1}`;
      const cName=c.colorName||"";
      [["Full",c.sizes||{},c.damageSizes||{}],["Half",c.sizesHalf||{},c.damageSizesHalf||{}]].forEach(([sleeve,sizes,dmgs]) => {
        Object.keys(sizes||{}).forEach(sz => {
          const cut=+sizes[sz]||0;
          if(cut<=0) return;
          const dmg=+dmgs[sz]||0;
          const stock=Math.max(0, cut-dmg);
          const bc=`${d.designNo}-${cNo}-${sz}`+(sleeve==="Half"?"-H":"");
          allRows.push({ designId:d.id, dn:d.designNo, ci, cNo, cName, sleeve, size:sz, cut, dmg, stock, barcode:bc,
            style:d.style||"", fit:d.fit||"", fabric:d.fabric||"", brand:d.brand||"", product:productOf(sleeve), ratio:ratioStr(d), mrp:mrpOf(d) });
        });
      });
    });
  });

  const designNos=[...new Set(allRows.map(r=>r.dn))].filter(dn => !q.trim() || String(dn).toLowerCase().includes(q.trim().toLowerCase()));

  function exportCSV() {
    const cols=["DesignNo","Size","ColourNo","ColourName","Sleeve","Style","Fit","Fabric","Product","Ratio","Brand","Barcode","MRP","Cut","Damage","Stock"];
    const esc=v=>{ const s=String(v==null?"":v); return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; };
    const lines=[cols.join(",")];
    allRows.filter(r=>r.stock>0).forEach(r => lines.push([r.dn,r.size,r.cNo,r.cName,r.sleeve,r.style,r.fit,r.fabric,r.product,r.ratio,r.brand||"RUDE INC",r.barcode,r.mrp,r.cut,r.dmg,r.stock].map(esc).join(",")));
    const blob=new Blob([lines.join("\n")],{type:"text/csv;charset=utf-8;"});
    const url=URL.createObjectURL(blob); const a=document.createElement("a");
    a.href=url; a.download=`barcodes_${new Date().toISOString().slice(0,10)}.csv`; a.click(); URL.revokeObjectURL(url);
    showToast && showToast("CSV downloaded ✓");
  }

  const totCut=allRows.reduce((a,r)=>a+r.cut,0), totDmg=allRows.reduce((a,r)=>a+r.dmg,0), totStock=allRows.reduce((a,r)=>a+r.stock,0);
  const th={ padding:"7px 9px", fontFamily:T.mono, fontSize:9, color:T.steelLt, textAlign:"left", textTransform:"uppercase", border:`1px solid ${T.border}` };
  const td={ padding:"6px 9px", fontFamily:T.mono, fontSize:12, color:T.text, border:`1px solid ${T.border}` };

  return (
    <div>
      <div style={{ display:"flex", gap:12, marginBottom:14, flexWrap:"wrap", alignItems:"center" }}>
        <div style={{ background:T.card, borderRadius:10, padding:"10px 16px", borderLeft:`3px solid ${T.gold}` }}>
          <div style={{ fontFamily:T.mono, fontSize:20, fontWeight:900, color:T.gold }}>{totCut}</div><div style={{ fontSize:10, color:T.steelLt }}>Total cut</div></div>
        <div style={{ background:T.card, borderRadius:10, padding:"10px 16px", borderLeft:`3px solid ${T.red}` }}>
          <div style={{ fontFamily:T.mono, fontSize:20, fontWeight:900, color:T.red }}>{totDmg}</div><div style={{ fontSize:10, color:T.steelLt }}>Damage/short</div></div>
        <div style={{ background:T.card, borderRadius:10, padding:"10px 16px", borderLeft:`3px solid ${T.green}` }}>
          <div style={{ fontFamily:T.mono, fontSize:20, fontWeight:900, color:T.green }}>{totStock}</div><div style={{ fontSize:10, color:T.steelLt }}>In stock</div></div>
        <button onClick={exportCSV} style={{ marginLeft:"auto", background:T.gold, color:"#fff", border:"none", borderRadius:8, padding:"10px 18px", fontFamily:T.mono, fontSize:13, fontWeight:700, cursor:"pointer" }}>⬇ Export CSV (BarTender)</button>
      </div>
      <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search design no…" style={{ background:T.surface, border:`2px solid ${T.gold}`, borderRadius:8, color:T.text, fontFamily:T.mono, fontSize:14, padding:"10px 14px", width:"100%", boxSizing:"border-box", outline:"none", marginBottom:14 }} />

      {designNos.length===0 && <div style={{ color:T.textDim, fontFamily:T.mono, fontSize:12, padding:20 }}>No designs with cut sizes found.</div>}

      {designNos.map(dn => {
        const rows=allRows.filter(r=>r.dn===dn);
        const dCut=rows.reduce((a,r)=>a+r.cut,0), dStock=rows.reduce((a,r)=>a+r.stock,0);
        const isOpen=openD[dn]!==false;
        return (
          <div key={dn} style={{ marginBottom:14, border:`1px solid ${T.border}`, borderRadius:10, overflow:"hidden" }}>
            <div onClick={()=>setOpenD(o=>({...o,[dn]:o[dn]===false}))} style={{ background:T.surface, padding:"10px 14px", cursor:"pointer", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div style={{ fontFamily:T.mono, fontWeight:700, color:T.gold, fontSize:14 }}>{isOpen?"▼":"▶"} Design {dn}</div>
              <div style={{ fontFamily:T.mono, fontSize:11, color:T.steelLt }}>cut {dCut} · stock <b style={{color:T.green}}>{dStock}</b></div>
            </div>
            {isOpen && (
              <div style={{ overflowX:"auto" }}>
                <table style={{ width:"100%", borderCollapse:"collapse", minWidth:720 }}>
                  <thead><tr style={{ background:T.card }}>
                    {["Colour","Sleeve","Size","Barcode","Cut","Damage","Stock","MRP"].map(h=><th key={h} style={th}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {rows.map((r,i) => (
                      <tr key={r.barcode+i} style={{ background: r.stock===0 ? T.red+"14" : (i%2?T.surface:T.card) }}>
                        <td style={td}>{r.cNo}{r.cName?` (${r.cName})`:""}</td>
                        <td style={td}>{r.sleeve}</td>
                        <td style={td}>{r.size}</td>
                        <td style={{...td, color:T.gold, fontWeight:700}}>{r.barcode}</td>
                        <td style={td}>{r.cut}</td>
                        <td style={td}><input type="number" value={r.dmg||""} onChange={e=>setDamage(r.designId,r.ci,r.sleeve,r.size,e.target.value===""?0:+e.target.value)} placeholder="0" style={{ width:56, background:T.surface, border:`1px solid ${T.border}`, borderRadius:5, color:T.red, fontFamily:T.mono, fontSize:12, padding:"5px 7px", textAlign:"center" }} /></td>
                        <td style={{...td, color: r.stock===0?T.red:T.green, fontWeight:700}}>{r.stock}</td>
                        <td style={td}>{r.mrp?("Rs."+r.mrp):"—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
      <div style={{ fontFamily:T.mono, fontSize:9, color:T.textDim, marginTop:10 }}>Barcode = DesignNo-ColourNo-Size (Half sleeve = "-H"). Stock = Cut − Damage. Damage aap daalo (process me kharab pieces) — apne aap save ho jaata hai. CSV BarTender ke liye.</div>
    </div>
  );
}

// ── Fabric Purchases (master view across all designs + monthly totals) ────────
function FabricSupplierLedger({ designs, payments, setPayments, creditNotes, setCreditNotes, showToast, currentUser }) {
  const [sel, setSel] = useState("");
  const [search, setSearch] = useState("");
  const [showPay, setShowPay] = useState(false);
  const [showCN, setShowCN] = useState(false);
  const [yearFilter, setYearFilter] = useState("all");
  const [editPay, setEditPay] = useState(null);

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
            const billed = bills.reduce((a,b)=>a+billTotalWithGST(b),0);
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
    ...bills.filter(b=>yearFilter==="all"||yearOf(b.billDate)===yearFilter||yearOf(b.billDate)===null).map(b => ({ date:b.billDate||"", particulars:`Design ${b.designNo} — ${b.billType||"Fabric"}${b.billNo?` (Bill ${b.billNo})`:" (no bill no)"}`, ref:b.billNo||"", debit:billTotalWithGST(b), credit:0 })),
    ...myPays.filter(p=>yearFilter==="all"||yearOf(p.date)===yearFilter||yearOf(p.date)===null).map(p => ({ date:p.date||"", particulars:`Payment (${p.mode||p.channel})`, ref:p.note||"", debit:0, credit:+p.amount||0, payObj:p })),
    ...myCNs.filter(c=>yearFilter==="all"||yearOf(c.cnDate)===yearFilter||yearOf(c.cnDate)===null).map(c => ({ date:c.cnDate||"", particulars:`Credit Note — ${c.reason||"claim"} (Designs ${cnDesignNos(c).join(", ")}${cnBillNos(c).length?` · Bills ${cnBillNos(c).join(", ")}`:""})`, ref:c.cnNo||"", debit:0, credit:+c.total||0 })),
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
  async function saveEditedSupPay(updated) {
    await dbUpsert("payments", payToRow(updated));
    setPayments(prev => prev.map(x => x.id===updated.id ? updated : x));
    recordActivity(currentUser, "Edited supplier payment", sel, `Rs.${updated.amount}`);
    showToast("Payment updated ✓");
    setEditPay(null);
  }
  async function deleteSupPay(id) {
    if (!window.confirm("Delete this payment? This cannot be undone.")) return;
    await dbDelete("payments", id);
    setPayments(prev => prev.filter(x => x.id!==id));
    recordActivity(currentUser, "Deleted supplier payment", sel, "");
    showToast("Payment deleted");
  }

  return (
    <div>
      <div style={{ display:"flex", gap:10, alignItems:"center", marginBottom:16, flexWrap:"wrap" }}>
        <Btn label="← Back to suppliers" onClick={()=>setSel("")} color={T.surface} textColor={T.steelLt} small />
        <span style={{ color:T.white, fontWeight:700, fontSize:18 }}>{sel}</span>
        <select value={yearFilter} onChange={e=>setYearFilter(e.target.value==="all"?"all":+e.target.value)} style={{ background:T.surface, border:`1px solid ${T.border}`, color:T.text, borderRadius:6, padding:"6px 12px", fontFamily:T.mono, fontSize:12 }}>
          <option value="all">All years</option>
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
        <thead><tr style={{ background:T.surface }}>{["Date","Particulars","Bill No","Debit","Credit","Balance",""].map(h=><th key={h} style={{ padding:"8px 10px", fontFamily:T.mono, fontSize:9, color:T.steelLt, textAlign:"left", textTransform:"uppercase", border:`1px solid ${T.border}` }}>{h}</th>)}</tr></thead>
        <tbody>
          {withBal.length===0 && <tr><td colSpan={7} style={{ padding:16, textAlign:"center", color:T.textDim, fontFamily:T.mono, border:`1px solid ${T.border}` }}>No entries{yearFilter==="all"?"":` for ${yearFilter}`}.</td></tr>}
          {withBal.map((r,i)=>(
            <tr key={i} style={{ background:i%2===0?T.card:T.surface }}>
              <td style={{ padding:"8px 10px", color:T.steelLt, fontFamily:T.mono, border:`1px solid ${T.border}` }}>{r.date}</td>
              <td style={{ padding:"8px 10px", color:T.white, border:`1px solid ${T.border}` }}>{r.particulars}</td>
              <td style={{ padding:"8px 10px", color:T.gold, fontFamily:T.mono, border:`1px solid ${T.border}` }}>{r.ref||"—"}</td>
              <td style={{ padding:"8px 10px", color:T.white, fontFamily:T.mono, border:`1px solid ${T.border}` }}>{r.debit?`Rs.${r.debit.toFixed(2)}`:""}</td>
              <td style={{ padding:"8px 10px", color:T.green, fontFamily:T.mono, border:`1px solid ${T.border}` }}>{r.credit?`Rs.${r.credit.toFixed(2)}`:""}</td>
              <td style={{ padding:"8px 10px", color:r.balance>0?T.red:T.green, fontFamily:T.mono, fontWeight:700, border:`1px solid ${T.border}` }}>Rs.{r.balance.toFixed(2)}</td>
              <td style={{ padding:"6px 8px", border:`1px solid ${T.border}`, whiteSpace:"nowrap" }}>
                {r.payObj && <span style={{ display:"flex", gap:4 }}>
                  <Btn label="✎" onClick={()=>setEditPay(r.payObj)} color={T.gold+"22"} textColor={T.gold} small />
                  <Btn label="✕" onClick={()=>deleteSupPay(r.payObj.id)} color={T.red+"22"} textColor={T.red} small />
                </span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {editPay && <EditPaymentModal pay={editPay} onClose={()=>setEditPay(null)} onSave={saveEditedSupPay} />}

      {showPay && <FabricPayModal supplier={sel} onClose={()=>setShowPay(false)} onSave={savePayment} />}
      {showCN && <CreditNoteForm partyType="supplier" partyLabel={sel} designs={designs} creditNotes={creditNotes} currentUser={currentUser} onClose={()=>setShowCN(false)} onSave={async (cn) => {
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

function FabricPurchases({ designs, setDesigns, creditNotes = [], showToast, currentUser }) {
  const [view, setView] = useState(""); // "" = nothing shown, "suppliers", "monthly"
  const [openSupplier, setOpenSupplier] = useState("");
  const [showRecord, setShowRecord] = useState(false);
  const [amtMode, setAmtMode] = useState("withgst"); // "withgst"=combined total, "split"=fabric+gst+total, "without"=taxable only

  const all = [];
  designs.forEach(d => (d.supplierBills||[]).forEach(b => all.push({ ...b, designNo: b.designNo||d.designNo })));
  all.sort((a,b) => (b.billDate||"").localeCompare(a.billDate||""));
  const totQty = all.reduce((a,b)=>a+(+b.qty||0),0);
  const totAmt = all.reduce((a,b)=>a+(+b.amount||0),0);

  // ── supplier credit notes: meters + amount ghata ke NET purchase
  const supCNs = (creditNotes||[]).filter(c => c.partyType === "supplier");
  const cnQty = supCNs.reduce((a,c)=>a+(c.lines||[]).reduce((x,l)=>x+(+l.qty||0),0),0);
  const cnAmt = supCNs.reduce((a,c)=>a+(+c.total||0),0);
  const netQty = +(totQty - cnQty).toFixed(2);
  const netAmt = +(totAmt - cnAmt).toFixed(2);
  // CN per bill no (bill me dikhane ke liye)
  const cnByBill = {};
  supCNs.forEach(c => (c.lines||[]).forEach(l => {
    const k = String(l.billNo||"").trim(); if(!k) return;
    if(!cnByBill[k]) cnByBill[k] = { qty:0, amt:0, nos:[] };
    cnByBill[k].qty += (+l.qty||0); cnByBill[k].amt += (+l.amount||0);
    if(c.cnNo && !cnByBill[k].nos.includes(c.cnNo)) cnByBill[k].nos.push(c.cnNo);
  }));
  // CN per month (monthly net ke liye)
  const cnByMonth = {};
  supCNs.forEach(c => { const m = monthKey(c.cnDate)||"(no date)"; if(!cnByMonth[m]) cnByMonth[m]={qty:0,amt:0}; cnByMonth[m].qty += (c.lines||[]).reduce((x,l)=>x+(+l.qty||0),0); cnByMonth[m].amt += (+c.total||0); });

  // group by supplier
  const bySupplier = {};
  all.forEach(b => { const s = (b.supplier||"(no supplier)").trim(); if(!bySupplier[s]) bySupplier[s]=[]; bySupplier[s].push(b); });
  const supplierNames = Object.keys(bySupplier).sort();

  // group by month
  const byMonth = {};
  all.forEach(b => { const m = monthKey(b.billDate)||"(no date)"; if(!byMonth[m]) byMonth[m]={qty:0,amt:0,bills:[]}; byMonth[m].qty+=(+b.qty||0); byMonth[m].amt+=(+b.amount||0); byMonth[m].bills.push(b); });

  return (
    <div>
      {/* Summary + actions */}
      <div style={{ display:"flex", gap:14, marginBottom:18, flexWrap:"wrap", alignItems:"center" }}>
        <div style={{ background:T.surface, borderRadius:8, padding:"14px 18px", borderLeft:`3px solid ${T.gold}` }}>
          <div style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt }}>TOTAL FABRIC (all)</div>
          <div style={{ fontFamily:T.mono, fontSize:18, fontWeight:900, color:T.gold }}>{totQty} m · Rs.{totAmt.toFixed(0)}</div>
          {(cnQty>0||cnAmt>0) && <>
            <div style={{ fontFamily:T.mono, fontSize:11, color:T.red, marginTop:4 }}>less credit notes: −{cnQty} m · −Rs.{cnAmt.toFixed(0)}</div>
            <div style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, marginTop:6 }}>NET PURCHASE</div>
            <div style={{ fontFamily:T.mono, fontSize:18, fontWeight:900, color:T.green }}>{netQty} m · Rs.{netAmt.toFixed(0)}</div>
          </>}
        </div>
        <Btn label="+ Record Purchase" onClick={()=>setShowRecord(true)} color={T.green} textColor="#fff" />
      </div>

      {/* View toggles */}
      <div style={{ display:"flex", gap:10, marginBottom:16, flexWrap:"wrap" }}>
        <button onClick={()=>setView(view==="suppliers"?"":"suppliers")} style={{ background:view==="suppliers"?T.gold:T.surface, color:view==="suppliers"?T.bg:T.steelLt, border:`1px solid ${T.border}`, borderRadius:20, padding:"8px 18px", fontFamily:T.mono, fontSize:12, fontWeight:700, cursor:"pointer" }}>
          {view==="suppliers"?"▼ ":"▶ "}By Supplier
        </button>
        <button onClick={()=>setView(view==="monthly"?"":"monthly")} style={{ background:view==="monthly"?T.gold:T.surface, color:view==="monthly"?T.bg:T.steelLt, border:`1px solid ${T.border}`, borderRadius:20, padding:"8px 18px", fontFamily:T.mono, fontSize:12, fontWeight:700, cursor:"pointer" }}>
          {view==="monthly"?"▼ ":"▶ "}Monthly Summary
        </button>
        <button onClick={()=>setAmtMode(m=>m==="withgst"?"split":m==="split"?"without":"withgst")} style={{ background:T.accent||T.gold, color:"#fff", border:`1px solid ${T.border}`, borderRadius:20, padding:"8px 18px", fontFamily:T.mono, fontSize:12, fontWeight:700, cursor:"pointer" }}>
          Amount: {amtMode==="withgst"?"Total (with GST)":amtMode==="split"?"Split (Fabric + GST)":"Without GST"}
        </button>
      </div>

      {view==="" && <div style={{ textAlign:"center", color:T.textDim, padding:30, fontFamily:T.mono, fontSize:12 }}>Tap "By Supplier" or "Monthly Summary" above to view purchases.</div>}

      {/* BY SUPPLIER — expand each on tap */}
      {view==="suppliers" && (
        <div>
          {supplierNames.length===0 && <div style={{ textAlign:"center", color:T.textDim, padding:30, fontFamily:T.mono, fontSize:12 }}>No fabric bills yet.</div>}
          {supplierNames.map(s => {
            const bills = bySupplier[s];
            const sQty = bills.reduce((a,b)=>a+(+b.qty||0),0);
            const sAmt = bills.reduce((a,b)=>a+(amtMode==="without"?(+b.amount||0):billTotalWithGST(b)),0);
            const sTaxable = bills.reduce((a,b)=>a+(+b.amount||0),0);
            const sGst = sAmt - sTaxable;
            const open = openSupplier===s;
            return (
              <div key={s} style={{ marginBottom:10, border:`1px solid ${T.border}`, borderRadius:8, overflow:"hidden" }}>
                <div onClick={()=>setOpenSupplier(open?"":s)} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 16px", background:T.surface, cursor:"pointer" }}>
                  <span style={{ color:T.white, fontWeight:700, fontSize:14 }}>{open?"▼ ":"▶ "}{s}</span>
                  <span style={{ fontFamily:T.mono, fontSize:12, color:T.gold, fontWeight:700 }}>{sQty} m · {amtMode==="split"?`Fabric Rs.${sTaxable.toFixed(0)} + GST Rs.${sGst.toFixed(0)} = Rs.${sAmt.toFixed(0)}`:`Rs.${sAmt.toFixed(0)}`} · {bills.length} bill{bills.length>1?"s":""}</span>
                </div>
                {open && (
                  <div style={{ overflowX:"auto" }}>
                    <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11 }}>
                      <thead><tr style={{ background:T.card }}>{["Bill Date","Bill No","Design","Qty","Rate",...(amtMode==="split"?["Fabric","GST","Total"]:["Amount"]),"LR No","Transporter"].map(h => <th key={h} style={{ padding:"7px 9px", fontFamily:T.mono, fontSize:8, color:T.steelLt, textAlign:"left", textTransform:"uppercase", borderBottom:`1px solid ${T.border}`, whiteSpace:"nowrap" }}>{h}</th>)}</tr></thead>
                      <tbody>
                        {bills.map((b,i) => {
                          const tax = +b.amount||0; const tot = billTotalWithGST(b); const g = tot - tax;
                          return (
                          <tr key={b.id||i} style={{ borderBottom:`1px solid ${T.border}` }}>
                            <td style={{ padding:"7px 9px", color:T.steelLt }}>{b.billDate||"—"}</td>
                            <td style={{ padding:"7px 9px", color:T.gold, fontFamily:T.mono }}>{b.billNo||"—"}</td>
                            <td style={{ padding:"7px 9px", color:T.gold, fontFamily:T.mono }}>{b.designNo}</td>
                            <td style={{ padding:"7px 9px", color:T.text, fontFamily:T.mono }}>{b.qty||"—"}</td>
                            <td style={{ padding:"7px 9px", color:T.gold, fontFamily:T.mono }}>Rs.{b.rate||"—"}</td>
                            {amtMode==="split" ? <>
                              <td style={{ padding:"7px 9px", color:T.text, fontFamily:T.mono }}>Rs.{tax.toFixed(0)}</td>
                              <td style={{ padding:"7px 9px", color:T.steelLt, fontFamily:T.mono }}>Rs.{g.toFixed(0)}{+b.gstRate>0?` (${b.gstRate}%)`:""}</td>
                              <td style={{ padding:"7px 9px", color:T.white, fontFamily:T.mono, fontWeight:700 }}>Rs.{tot.toFixed(0)}</td>
                            </> : <td style={{ padding:"7px 9px", color:T.white, fontFamily:T.mono, fontWeight:700 }}>Rs.{amtMode==="without"?tax.toFixed(0):tot.toFixed(0)}</td>}
                            <td style={{ padding:"7px 9px", color:T.steelLt, fontFamily:T.mono }}>{b.lrNo||"—"}</td>
                            <td style={{ padding:"7px 9px", color:T.steelLt }}>{b.transporter||"—"}</td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* MONTHLY SUMMARY */}
      {view==="monthly" && (
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
          <thead><tr style={{ background:T.surface }}>{["Month","Quantity (m)","Amount","Credit Notes","NET (m)","NET Amount"].map(h => <th key={h} style={{ padding:"8px 10px", fontFamily:T.mono, fontSize:9, color:T.steelLt, textAlign:"left", textTransform:"uppercase", borderBottom:`1px solid ${T.border}` }}>{h}</th>)}</tr></thead>
          <tbody>
            {Object.keys(byMonth).length===0 && <tr><td colSpan={6} style={{ padding:30, textAlign:"center", color:T.textDim, fontFamily:T.mono }}>No fabric bills yet.</td></tr>}
            {Object.entries(byMonth).map(([m,v]) => {
              const cn = cnByMonth[m] || { qty:0, amt:0 };
              const nQty = +(v.qty - cn.qty).toFixed(2), nAmt = +(v.amt - cn.amt).toFixed(2);
              return (
              <tr key={m} style={{ borderBottom:`1px solid ${T.border}`, borderLeft:`4px solid ${monthColor(m==="(no date)"?"":(all.find(b=>monthKey(b.billDate)===m)?.billDate))}` }}>
                <td style={{ padding:"8px 10px", color:T.white, fontWeight:600 }}>{m}</td>
                <td style={{ padding:"8px 10px", color:T.gold, fontFamily:T.mono }}>{v.qty}</td>
                <td style={{ padding:"8px 10px", color:T.gold, fontFamily:T.mono, fontWeight:700 }}>Rs.{v.amt.toFixed(2)}</td>
                <td style={{ padding:"8px 10px", color:T.red, fontFamily:T.mono }}>{(cn.qty||cn.amt) ? `−${cn.qty} m · −Rs.${cn.amt.toFixed(0)}` : "—"}</td>
                <td style={{ padding:"8px 10px", color:T.green, fontFamily:T.mono, fontWeight:700 }}>{nQty}</td>
                <td style={{ padding:"8px 10px", color:T.green, fontFamily:T.mono, fontWeight:700 }}>Rs.{nAmt.toFixed(2)}</td>
              </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {showRecord && <RecordPurchaseModal designs={designs} setDesigns={setDesigns} showToast={showToast} currentUser={currentUser} onClose={()=>setShowRecord(false)} />}
    </div>
  );
}

// Supplier name picker: searchable dropdown from `suppliers` table + add-new (name/GSTIN/phone)
// ── Supplier cache (loads once from `suppliers` table, shared by all pickers) ──
let _supCache = null, _supLoading = null;
async function loadSuppliers(force) {
  if (_supCache && !force) return _supCache;
  if (!_supLoading) {
    _supLoading = dbSelect("suppliers").then(rows => {
      _supCache = (rows || []).slice().sort((a,b) => (a.name||"").localeCompare(b.name||""));
      _supLoading = null;
      return _supCache;
    });
  }
  return _supLoading;
}
function _nextSupCode(list) {
  let max = 100000;
  for (const s of list) { const n = parseInt(String(s.id||"").replace(/\D/g,""),10); if (!isNaN(n) && n>max) max=n; }
  return "S" + (max + 1);
}

// SupplierPicker: shows ONLY suppliers from the `suppliers` table.
// value/onChange stay string-based (supplier name) so existing bills keep working.
function SupplierPicker({ value, onChange, allSuppliers = [], label = "Supplier" }) {
  const [list, setList] = useState(_supCache || []);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [nw, setNw] = useState({ name:"", gst:"", state:"", phone:"", city:"" });
  const boxRef = useRef(null);

  useEffect(() => { let ok=true; loadSuppliers().then(r => { if(ok) setList(r); }); return ()=>{ok=false;}; }, []);
  useEffect(() => {
    function onDoc(e){ if(boxRef.current && !boxRef.current.contains(e.target)){ setOpen(false); setAdding(false); } }
    document.addEventListener("mousedown", onDoc); return ()=>document.removeEventListener("mousedown", onDoc);
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? list.filter(s => (s.name||"").toLowerCase().includes(q) || (s.gst||"").toLowerCase().includes(q) || (s.state||"").toLowerCase().includes(q))
    : list;
  const exactExists = list.some(s => (s.name||"").trim().toLowerCase() === q);

  function pick(s){ onChange(s.name); setQuery(""); setOpen(false); setAdding(false); }

  async function saveNew() {
    const name = (nw.name||query).trim();
    if (!name) { alert("Supplier ka naam likho."); return; }
    setBusy(true);
    const row = { id:_nextSupCode(list), name, gst:nw.gst.trim()||null, state:nw.state.trim()||null, phone:nw.phone.trim()||null, city:nw.city.trim()||null };
    const res = await dbUpsert("suppliers", row);
    setBusy(false);
    if (!res || res.ok === false) { alert("Add nahi hua: " + (res && res.msg ? res.msg : "error")); return; }
    const next = [...list, row].sort((a,b)=>(a.name||"").localeCompare(b.name||""));
    _supCache = next; setList(next);
    pick(row);
    setNw({ name:"", gst:"", state:"", phone:"", city:"" });
  }

  function setCityLocal(sup, city){ const next=list.map(s=>s.id===sup.id?{...s,city}:s); setList(next); _supCache=next; }
  async function saveCity(sup){ if(!sup) return; try{ await dbUpsert("suppliers", sup); }catch(e){} }

  const inpS = { background:T.surface, border:`1px solid ${T.border}`, borderRadius:6, color:T.text, fontFamily:T.sans, fontSize:13, padding:"8px 12px", width:"100%", boxSizing:"border-box" };
  const selName = value || "";
  const selSup = list.find(s => (s.name||"") === selName);

  return (
    <div ref={boxRef} style={{ position:"relative" }}>
      <label style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, textTransform:"uppercase", display:"block", marginBottom:4 }}>{label} *</label>
      <div onClick={()=>setOpen(o=>!o)} style={{ ...inpS, cursor:"pointer", display:"flex", justifyContent:"space-between", alignItems:"center", fontWeight: selName?700:400, color: selName?T.text:T.textDim }}>
        <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{selName || "Supplier chuno / dhundo…"}</span>
        <span style={{ color:T.gold, fontSize:11 }}>{open?"▲":"▼"}</span>
      </div>

      {selSup && (
        <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:5 }}>
          <span style={{ fontFamily:T.mono, fontSize:9, color:T.steelLt, whiteSpace:"nowrap" }}>🏙 CITY:</span>
          <input value={selSup.city||""} onChange={e=>setCityLocal(selSup, e.target.value)} onBlur={()=>saveCity(list.find(s=>s.id===selSup.id))} placeholder="city likho (barcode city-letter ke liye) — auto save" style={{ ...inpS, padding:"5px 8px", fontSize:12 }} />
        </div>
      )}
      {open && (
        <div style={{ position:"absolute", top:"100%", left:0, right:0, zIndex:60, marginTop:4, background:T.card, border:`1px solid ${T.gold}`, borderRadius:8, boxShadow:"0 10px 26px rgba(90,60,140,.18)", overflow:"hidden" }}>
          <div style={{ padding:8, background:T.bg }}>
            <input autoFocus value={query} onChange={e=>setQuery(e.target.value)} placeholder="Naam / GSTIN / state type karo…" style={inpS} />
          </div>

          {!adding && (
            <div style={{ maxHeight:240, overflowY:"auto" }}>
              {filtered.map(s => (
                <div key={s.id} onClick={()=>pick(s)} style={{ padding:"9px 12px", borderBottom:`1px solid ${T.border}`, cursor:"pointer" }}>
                  <div style={{ fontWeight:700, color:T.text, fontSize:13 }}>{s.name}</div>
                  <div style={{ fontSize:11, color:T.steelLt, marginTop:2 }}>{s.gst || "GSTIN nahi"}{s.state?"  •  "+s.state:""}</div>
                </div>
              ))}
              {filtered.length===0 && !query.trim() && <div style={{ padding:12, color:T.textDim, fontSize:12 }}>Koi supplier nahi.</div>}
              {query.trim() && !exactExists && (
                <div onClick={()=>{ setNw(n=>({ ...n, name:query.trim() })); setAdding(true); }} style={{ padding:"11px 12px", background:"#FBF3DC", color:T.gold, fontWeight:700, fontSize:13, cursor:"pointer" }}>
                  + Naya supplier add karo: “{query.trim()}”
                </div>
              )}
            </div>
          )}

          {adding && (
            <div style={{ padding:12, display:"flex", flexDirection:"column", gap:8, background:T.card }}>
              <div style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, textTransform:"uppercase" }}>Naya supplier</div>
              <input value={nw.name} onChange={e=>setNw({...nw,name:e.target.value})} placeholder="Supplier name *" style={inpS} />
              <input value={nw.gst} onChange={e=>setNw({...nw,gst:e.target.value.toUpperCase()})} placeholder="GSTIN (optional)" style={inpS} />
              <input value={nw.phone} onChange={e=>setNw({...nw,phone:e.target.value})} placeholder="Phone (optional)" style={inpS} />
              <input value={nw.state} onChange={e=>setNw({...nw,state:e.target.value})} placeholder="State (optional)" style={inpS} />
              <input value={nw.city} onChange={e=>setNw({...nw,city:e.target.value})} placeholder="City (optional — for barcode city letter)" style={inpS} />
              <div style={{ display:"flex", gap:8 }}>
                <button onClick={saveNew} disabled={busy} style={{ flex:1, background:T.gold, color:"#fff", border:"none", borderRadius:6, padding:"9px 0", fontWeight:700, fontSize:13, cursor:"pointer" }}>{busy?"Add ho raha…":"Add supplier"}</button>
                <button onClick={()=>setAdding(false)} style={{ flex:1, background:T.surface, color:T.text, border:`1px solid ${T.border}`, borderRadius:6, padding:"9px 0", fontWeight:700, fontSize:13, cursor:"pointer" }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RecordPurchaseModal({ designs, setDesigns, showToast, currentUser, onClose }) {
  const [designNo, setDesignNo] = useState("");
  const [form, setForm] = useState({ billType:"Fabric", supplier:"", billNo:"", billDate:new Date().toISOString().slice(0,10), lrNo:"", transporter:"", qty:"", rate:"" });
  const upd = k => v => setForm(f => ({ ...f, [k]:v }));
  const amount = (+form.qty||0)*(+form.rate||0);
  async function save() {
    const target = designs.find(d => String(d.designNo)===String(designNo).trim());
    if (!target) { showToast("This design number does not exist. Create the design first.", "error"); return; }
    // if the design already has a fabric supplier/bill, warn before adding another
    const existingBills = (target.supplierBills||[]).filter(b => b.supplier && b.supplier.trim());
    if (existingBills.length > 0) {
      const names = [...new Set(existingBills.map(b => b.supplier.trim()))].join(", ");
      if (!window.confirm(`Design ${target.designNo} already has a fabric supplier (${names}).\n\nDo you want to add another supplier/bill to this design?`)) return;
    }
    const bill = { id:`B${Date.now()}`, billType:form.billType, supplier:form.supplier, billNo:form.billNo, billDate:form.billDate, lrNo:form.lrNo, transporter:form.transporter, transportCost:form.transportCost||"", gstRate:form.gstRate||"", gstType:form.gstType||"CGST+SGST", qty:form.qty, rate:form.rate, amount:amount?String(amount):"", photo:"", appliesTo:[], designNo:target.designNo };
    const updated = { ...target, supplierBills:[...(target.supplierBills||[]), bill] };
    await dbUpsert("designs", dToRow(updated));
    setDesigns(p => p.map(x => x.id===target.id?updated:x));
    recordActivity(currentUser, "Recorded fabric purchase", `Design ${target.designNo}`, `${form.supplier} · Rs.${amount}`);
    showToast("Purchase recorded ✓");
    onClose();
  }
  return (
    <Modal title="Record Fabric Purchase" onClose={onClose}>
      <div style={{ fontFamily:T.mono, fontSize:10, color:T.textDim, marginBottom:12 }}>This adds a fabric bill to the chosen design (same as adding it inside the design).</div>
      <div style={{ display:"flex", flexDirection:"column", gap:4, marginBottom:12 }}>
        <label style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, textTransform:"uppercase" }}>Design No *</label>
        <input value={designNo} onChange={e=>setDesignNo(e.target.value)} list="rp-designs" placeholder="type or pick design no" style={{ background:T.surface, border:`1px solid ${T.gold}`, borderRadius:6, color:T.text, fontFamily:T.sans, fontSize:13, padding:"8px 12px", width:"100%", boxSizing:"border-box" }} />
        <datalist id="rp-designs">{designs.map(d => <option key={d.id} value={d.designNo} />)}</datalist>
        {(() => {
          const dn = String(designNo||"").trim();
          if (!dn) return null;
          const t = designs.find(d => String(d.designNo)===dn);
          if (!t) return <div style={{ fontFamily:T.mono, fontSize:10, color:T.red, marginTop:4 }}>⚠ No design with this number. It must already exist.</div>;
          const sup = [...new Set((t.supplierBills||[]).filter(b=>b.supplier&&b.supplier.trim()).map(b=>b.supplier.trim()))];
          if (sup.length>0) return <div style={{ fontFamily:T.mono, fontSize:10, color:T.orange, marginTop:4 }}>⚠ Already has supplier: {sup.join(", ")}. You'll be asked to confirm adding another.</div>;
          return <div style={{ fontFamily:T.mono, fontSize:10, color:T.green, marginTop:4 }}>✓ Design found — no supplier yet.</div>;
        })()}
      </div>
      <div style={{ marginBottom:14 }}>
        <SupplierPicker value={form.supplier} onChange={upd("supplier")} allSuppliers={designs.flatMap(d=>(d.supplierBills||[]).map(b=>b.supplier).filter(Boolean))} />
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:14 }}>
        <Inp label="Type" value={form.billType} onChange={upd("billType")} options={["Fabric","Trims"]} />
        <Inp label="Bill No" value={form.billNo} onChange={upd("billNo")} />
        <Inp label="Bill Date" type="date" value={form.billDate} onChange={upd("billDate")} />
        <Inp label="Qty (meters)" type="number" value={form.qty} onChange={upd("qty")} />
        <Inp label="Rate" type="number" value={form.rate} onChange={upd("rate")} />
        <Inp label="LR No" value={form.lrNo} onChange={upd("lrNo")} />
        <Inp label="Transporter" value={form.transporter} onChange={upd("transporter")} />
        <Inp label="Transport Cost (Rs.)" type="number" value={form.transportCost||""} onChange={upd("transportCost")} placeholder="freight" />
        <Inp label="GST %" value={form.gstRate||""} onChange={upd("gstRate")} options={["","5","12","18","28"]} />
        <Inp label="GST Type" value={form.gstType||"CGST+SGST"} onChange={upd("gstType")} options={["CGST+SGST","IGST"]} />
      </div>
      {(+form.gstRate>0 && amount>0) && (() => {
        const taxable = amount, rate = +form.gstRate||0;
        const gst = taxable*rate/100, total = taxable+gst;
        return (
          <div style={{ background:T.bg, borderRadius:6, padding:"8px 12px", marginBottom:12, fontFamily:T.mono, fontSize:10, color:T.steelLt, display:"flex", gap:16, flexWrap:"wrap" }}>
            <span>Taxable: <b style={{color:T.text}}>Rs.{taxable.toFixed(2)}</b></span>
            {form.gstType==="IGST"
              ? <span>IGST {rate}%: <b style={{color:T.gold}}>Rs.{gst.toFixed(2)}</b></span>
              : <><span>CGST {(rate/2)}%: <b style={{color:T.gold}}>Rs.{(gst/2).toFixed(2)}</b></span><span>SGST {(rate/2)}%: <b style={{color:T.gold}}>Rs.{(gst/2).toFixed(2)}</b></span></>}
            <span>Total: <b style={{color:T.white}}>Rs.{total.toFixed(2)}</b></span>
          </div>
        );
      })()}
      <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:14 }}>
        <div style={{ background:T.bg, borderRadius:8, padding:"8px 16px", border:`1px solid ${T.gold}44` }}>
          <span style={{ fontFamily:T.mono, fontSize:11, color:T.steelLt }}>AMOUNT: </span>
          <span style={{ fontFamily:T.mono, fontSize:16, color:T.gold, fontWeight:900 }}>Rs.{amount}</span>
        </div>
      </div>
      <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
        <Btn label="Cancel" onClick={onClose} color={T.surface} textColor={T.steelLt} />
        <Btn label="Save Purchase" onClick={save} disabled={!designNo||!form.supplier} color={T.green} textColor="#fff" />
      </div>
    </Modal>
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
  function setProcessNote(pn, note) {
    setForm(f => ({ ...f, processCodes: (f.processCodes||[]).map(x => x.process===pn ? {...x, note} : x) }));
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
                    ? (j.processCodes||[]).map(pc => <Badge key={pc.process} label={`${pc.process}${pc.code?` ${pc.code}`:""}${pc.note?` · ${pc.note}`:""}`} color={T.steel} />)
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
              {(form.processCodes||[]).some(x => (x.process||"").toLowerCase().includes("stitch")) && <div style={{ fontFamily:T.mono, fontSize:10, color:T.green, marginBottom:8 }}>✓ This jobber is a stitcher — they can create new designs.</div>}
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))", gap:8 }}>
                {PROCESSES.filter(p => p!=="Fabric").map(pn => {
                  const checked = (form.processCodes||[]).some(x => x.process===pn);
                  const code = (form.processCodes||[]).find(x => x.process===pn)?.code || "";
                  const note = (form.processCodes||[]).find(x => x.process===pn)?.note || "";
                  return (
                    <div key={pn} style={{ background:T.surface, borderRadius:6, padding:"8px 10px", border:`1px solid ${checked?T.gold+"66":T.border}` }}>
                      <label style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer", color:T.text, fontSize:12, marginBottom:checked?6:0 }}>
                        <input type="checkbox" checked={checked} onChange={() => toggleProcess(pn)} style={{ accentColor:T.gold, width:14, height:14 }} />
                        {pn}
                      </label>
                      {checked && <input value={code} onChange={e => setProcessCode(pn, e.target.value)} placeholder="code e.g. 13" style={{ background:T.bg, border:`1px solid ${T.border}`, borderRadius:4, color:T.gold, fontFamily:T.mono, fontSize:12, padding:"5px 8px", width:"100%", boxSizing:"border-box", marginBottom:6 }} />}
                      {checked && <input value={note} onChange={e => setProcessNote(pn, e.target.value)} placeholder="what under this? e.g. embroidery" style={{ background:T.bg, border:`1px solid ${T.border}`, borderRadius:4, color:T.text, fontFamily:T.sans, fontSize:11, padding:"5px 8px", width:"100%", boxSizing:"border-box" }} />}
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
  const [showApproved, setShowApproved] = useState(true); // default: show ALL challans
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
  async function removeChallanMovements(c) {
    // remove movements created by this challan (matched by challan number in remark) from all designs
    const chNo = c.challanNo||"";
    const dns = new Set(challanDesigns(c).map(String));
    for (const d of designs) {
      if (!(d.movements||[]).length) continue;
      const touches = (d.movements||[]).some(m => (chNo && (m.remark||"").includes(`Challan ${chNo}`)) );
      const designInChallan = dns.has(String(d.designNo));
      if (!touches && !designInChallan) continue;
      const kept = (d.movements||[]).filter(m => !(chNo && (m.remark||"").includes(`Challan ${chNo}`)));
      if (kept.length !== (d.movements||[]).length) {
        const u = { ...d, movements:kept };
        setDesigns(p => p.map(x => x.id===u.id?u:x));
        await dbUpsert("designs", dToRow(u));
      }
    }
  }
  async function reject(c) {
    const u = { ...c, status:"rejected" };
    await dbUpsert("challans", challanToRow(u));
    setChallans(p => p.map(x => x.id===c.id?u:x));
    await removeChallanMovements(c);
    showToast("Challan rejected — movements removed");
  }
  async function remove(c) {
    if (c.billed) { showToast("This challan is in a bill — locked. Delete/edit the bill first."); return; }
    // warn if a (pending) bill references this challan's designs
    const dns = new Set(challanDesigns(c).map(String));
    const inBill = (bills||[]).some(b => (b.lines||[]).some(l => dns.has(String(l.designNo)) && (l.challanNo||"")===(c.challanNo||"")));
    if (inBill) { showToast("A bill references this challan. Remove it from the bill first."); return; }
    if (!window.confirm(`Delete challan ${c.challanNo||""}?\n\nThis removes it everywhere — its movements, flow, cost-sheet and ledger effect all go too. Cannot be undone.`)) return;
    await dbDelete("challans", c.id);
    setChallans(p => p.filter(x => x.id!==c.id));
    await removeChallanMovements(c);
    recordActivity(currentUser, "Deleted challan", `Designs ${challanDesigns(c).join(", ")}`, "removed everywhere");
    showToast("Challan deleted — removed everywhere ✓");
  }
  const [editChallan, setEditChallan] = useState(null);
  async function saveEditedChallan(updated) {
    await dbUpsert("challans", challanToRow(updated));
    setChallans(p => p.map(x => x.id===updated.id?updated:x));
    recordActivity(currentUser, "Edited challan", `Designs ${challanDesigns(updated).join(", ")}`, `${challanQty(updated)} pcs`);
    showToast("Challan updated ✓");
    setEditChallan(null);
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
                      {l.remark && <span style={{ color:T.textDim, fontStyle:"italic", fontSize:11 }}>· {l.remark}</span>}
                    </div>
                  ))}
                  <div style={{ fontFamily:T.mono, fontSize:10, color:T.gold, marginTop:3 }}>
                    {c.halfStitch
                      ? <span style={{ color:T.orange }}>◐ Half Stitch (movement only) · {challanQty(c)} pcs</span>
                      : <>Challan total: Rs.{challanTotal(c)}{+c.gstPct>0?` + ${c.gstPct}% GST = Rs.${challanTotalWithGST(c).toFixed(0)}`:""} · {challanQty(c)} pcs</>}
                  </div>
                </td>
                <td style={{ padding:"8px", verticalAlign:"top" }}>{c.photo ? <img src={c.photo} alt="" onClick={()=>window.open().document.write(`<img src="${c.photo}" style="max-width:100%">`)} style={{ width:28, height:28, borderRadius:4, objectFit:"cover", cursor:"pointer" }} draggable={false} onContextMenu={e=>e.preventDefault()} /> : <span style={{ color:T.textDim }}>—</span>}</td>
                <td style={{ padding:"8px", verticalAlign:"top" }}>
                  <Badge label={c.status} color={c.status==="approved"?T.green:c.status==="rejected"?T.red:T.orange} />
                  {(() => { const lb = [...new Set(billsForChallan(c, bills).map(b=>b.billNo).filter(Boolean))]; return lb.length ? <div style={{ fontFamily:T.mono, fontSize:9, color:T.green, marginTop:3 }}>Bill: {lb.join(", ")}</div> : (c.billed && <Badge label="billed" color={T.steelLt} />); })()}
                </td>
                <td style={{ padding:"8px", whiteSpace:"nowrap", verticalAlign:"top" }}>
                  {isAdmin && c.status==="pending" && <><Btn label="✓" onClick={()=>approve(c)} color={T.green} textColor="#fff" small /> <Btn label="✕" onClick={()=>reject(c)} color={T.red+"22"} textColor={T.red} small /></>}
                  {isAdmin && !c.billed && <Btn label="✎" onClick={()=>setEditChallan(c)} color={T.gold+"22"} textColor={T.gold} small />}
                  {isAdmin && c.status!=="pending" && !c.billed && <Btn label="Del" onClick={()=>remove(c)} color={T.red+"22"} textColor={T.red} small />}
                  {c.billed && <span style={{ fontFamily:T.mono, fontSize:9, color:T.steelLt }}>locked (billed)</span>}
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
            const fd = (c.newDesignData||{})[dn];
            if (fd) {
              if (fd.supplier) nd.supplier = fd.supplier;
              const fcols = (fd.colors||[]);
              if (fcols.length) {
                nd.colors = fcols.map((col,i)=>({ id:col.id||`C${Date.now()}_${i}`, colorName:(col.name||"").trim(), colorNo:"", name:(col.name||"").trim(), sleeve:"", meters:String(col.meters||""), metersHalf:"", sizes:{}, sizesHalf:{}, samples:{}, sampleFabric:[], balance:"", shrinkage:"", sampleShrinkage:"", swatch:col.swatch||"" }));
              }
            }
            await dbUpsert("designs", dToRow(nd));
            setDesigns(p => [nd, ...p]);
            recordActivity(currentUser, "Created placeholder design (via challan)", `Design ${dn}`, "needs completion");
            recordNotification(currentUser, `New placeholder design ${dn} created via challan — complete its details`, nd.id);
          }
        }
        await dbUpsert("challans", challanToRow(c));
        setChallans(p => [c,...p]);
        // create a movement for EACH design line that has its own "Sent To"
        {
          for (const ln of (c.lines||[])) {
            const dn = String(ln.designNo);
            const lineSendTo = ln.sentToId || c.sendToId; // per-line, fallback to challan-level
            if (!lineSendTo) continue;
            const targetName = lineSendTo==="__office__" ? "Office / Admin" : ((jobbers.find(j=>j.id===lineSendTo)||{}).name||"");
            const design = designs.find(d => String(d.designNo)===dn);
            if (!design) continue;
            const lineQty = +ln.qty||0;
            const mv = { id:`MV${Date.now()}_${dn}_${Math.floor(Math.random()*1000)}`, date:ln.sentDate||c.date||new Date().toISOString().slice(0,10), receivedDate:ln.receivedDate||"", sentDate:ln.sentDate||c.date||"", jobber:jname(c.jobberId), receivedFrom:ln.receivedFrom||jname(c.jobberId), sentTo:targetName, sentToId:lineSendTo==="__office__"?"":lineSendTo, qty:lineQty, remark:`Challan ${c.challanNo||""}${ln.process?" · "+ln.process:""}${ln.halfStitch?" (Half Stitch)":""}`, halfStitch:!!ln.halfStitch, status:"sent" };
            const updated = { ...design, movements:[...(design.movements||[]), mv] };
            setDesigns(p => p.map(x => x.id===updated.id?updated:x));
            await dbUpsert("movements", mvToRow(mv, design.id));
            if (lineSendTo && lineSendTo!=="__office__") {
              recordNotification(jname(c.jobberId), `${jname(c.jobberId)} sent you Design ${dn}${ln.process?` for ${ln.process}`:""} — ${lineQty} pcs`, design.id, lineSendTo);
            }
          }
        }
        recordActivity(currentUser, "Added challan", `Designs ${challanDesigns(c).join(", ")}`, `${jname(c.jobberId)} · ${challanQty(c)} pcs`);
        showToast("Challan saved ✓");
        setShowForm(false);
      }} />}
      {editChallan && <EditChallanModal challan={editChallan} jobbers={jobbers} onClose={()=>setEditChallan(null)} onSave={saveEditedChallan} />}
    </div>
  );
}

function EditChallanModal({ challan, jobbers, onClose, onSave }) {
  const [date, setDate] = useState(challan.date||"");
  const [challanNo, setChallanNo] = useState(challan.challanNo||"");
  const [gstPct, setGstPct] = useState(String(challan.gstPct||""));
  const [lines, setLines] = useState((challan.lines && challan.lines.length ? challan.lines : [{ designNo:challan.designNo, process:challan.process, qty:challan.qty, rate:challan.rate, amount:challan.amount }]).map(l => ({ ...l })));
  function updLine(i,k,v){ setLines(p => p.map((l,idx)=>{ if(idx!==i) return l; const nl={...l,[k]:v}; if(k==="qty"||k==="rate") nl.amount=((+nl.qty||0)*(+nl.rate||0)); return nl; })); }
  const total = lines.reduce((a,l)=>a+(+l.amount||0),0);
  function doSave(){
    const builtLines = lines.map(l => ({ ...l, qty:+l.qty||0, rate:+l.rate||0, amount:(+l.qty||0)*(+l.rate||0) }));
    onSave({ ...challan, date, challanNo, gstPct:challan.halfStitch?0:(+gstPct||0), lines:builtLines, qty:builtLines.reduce((a,l)=>a+l.qty,0), amount:builtLines.reduce((a,l)=>a+l.amount,0) });
  }
  return (
    <Modal title={`Edit Challan ${challan.challanNo||""}`} onClose={onClose}>
      {challan.halfStitch && <div style={{ background:T.orange+"22", border:`1px solid ${T.orange}`, borderRadius:6, padding:"8px 12px", marginBottom:12, fontFamily:T.mono, fontSize:10, color:T.orange }}>Half-stitch challan — no rate/amount (movement only).</div>}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:14 }}>
        <Inp label="Challan No" value={challanNo} onChange={setChallanNo} />
        <Inp label="Date" type="date" value={date} onChange={setDate} />
        {!challan.halfStitch && <Inp label="GST %" value={gstPct} onChange={setGstPct} options={["","5","12","18"]} />}
      </div>
      <div style={{ fontFamily:T.mono, fontSize:10, color:T.gold, textTransform:"uppercase", marginBottom:8 }}>Design lines</div>
      {lines.map((l,i)=>(
        <div key={i} style={{ display:"grid", gridTemplateColumns:challan.halfStitch?"1fr 1fr 1fr":"1fr 1fr 80px 80px 90px", gap:8, marginBottom:8, alignItems:"end" }}>
          <Inp label="Design" value={l.designNo} onChange={v=>updLine(i,"designNo",v)} />
          <Inp label="Process" value={l.process} onChange={v=>updLine(i,"process",v)} />
          <Inp label="Qty" type="number" value={l.qty} onChange={v=>updLine(i,"qty",v)} />
          {!challan.halfStitch && <Inp label="Rate" type="number" value={l.rate} onChange={v=>updLine(i,"rate",v)} />}
          {!challan.halfStitch && <div style={{ fontFamily:T.mono, fontSize:13, color:T.gold, fontWeight:700, paddingBottom:8 }}>Rs.{(+l.amount||0)}</div>}
        </div>
      ))}
      {!challan.halfStitch && <div style={{ textAlign:"right", fontFamily:T.mono, fontSize:14, color:T.gold, fontWeight:900, marginBottom:14 }}>Total: Rs.{(total + total*(+gstPct||0)/100).toFixed(2)}{+gstPct>0?` (incl ${gstPct}% GST)`:""}</div>}
      <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
        <Btn label="Cancel" onClick={onClose} color={T.surface} textColor={T.steelLt} />
        <Btn label="Save Changes" onClick={doSave} color={T.gold} textColor={T.bg} />
      </div>
    </Modal>
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
  // For a jobber (fixedJobber set): show designs SENT to him, allow multiple challans (partial dispatch),
  // hide only when he has dispatched the full quantity he received, or design is Completed.
  const availableDesigns = (() => {
    if (!fixedJobber) return designs; // admin sees all
    // qty received by this jobber per design (challans whose sendToId === him)
    const received = {}; // designNo -> qty received
    const dispatched = {}; // designNo -> qty he sent onward (his challans that have a sendToId)
    (challans||[]).forEach(c => {
      if (c.status==="rejected") return;
      const lns = (c.lines && c.lines.length) ? c.lines : [{ designNo:c.designNo, qty:c.qty, sentToId:c.sendToId }];
      lns.forEach(l => {
        const dn=String(l.designNo);
        const sentTo = l.sentToId || c.sendToId;
        if (sentTo===fixedJobber) received[dn]=(received[dn]||0)+(+l.qty||0);   // sent TO me
        if (c.jobberId===fixedJobber && sentTo) dispatched[dn]=(dispatched[dn]||0)+(+l.qty||0); // I sent onward
      });
    });
    return designs.filter(d => {
      const dn = String(d.designNo);
      if (d.status==="Completed") return false;            // finished designs hidden
      const rec = received[dn]||0;
      if (rec<=0) return false;                              // only designs sent to him
      const disp = dispatched[dn]||0;
      return disp < rec;                                    // still has undispatched qty → keep showing
    });
  })();
  const [head, setHead] = useState({ jobberId: fixedJobber||"", date:new Date().toISOString().slice(0,10), receivedDate:"", sentDate:"", receivedFrom:"", challanNo:"", photo:"", sendToId:"", gstPct:"", halfStitch:false });
  const [lines, setLines] = useState([{ id:`L${Date.now()}`, designNo:"", process:"", qty:"", rate:"", isSplit:false, newDesign:false, receivedFrom:"Aashish Apparels", sentToId:"", receivedDate:"", sentDate:"", remark:"" }]);
  // Smart pre-fill (Option B): when a jobber picks a design, auto-fill the inward details
  // (received from = who sent it, received date = when it was sent to him) from the incoming lot.
  useEffect(() => {
    const me = fixedJobber || head.jobberId;
    if (!me) return;
    setLines(prev => prev.map(ln => {
      const dn = String(ln.designNo||"").trim();
      if (!dn) return ln;
      // find the most recent challan that sent this design TO me
      let incoming = null;
      (challans||[]).forEach(c => {
        if (c.sendToId===me && challanDesigns(c).includes(dn)) {
          if (!incoming || (c.date||"")>(incoming.date||"")) incoming = c;
        }
      });
      let nb = { ...ln };
      // received from (don't overwrite a manual edit other than the default)
      if (!ln.receivedFrom || ln.receivedFrom==="Aashish Apparels") {
        const fromName = incoming ? ((jobbers.find(j=>j.id===incoming.jobberId)||{}).name||"") : "";
        if (fromName) nb.receivedFrom = fromName;
      }
      // received date = when the lot was sent to me (incoming sentDate)
      if (!ln.receivedDate && incoming) {
        const incLine = (incoming.lines||[]).find(l=>String(l.designNo)===dn);
        nb.receivedDate = (incLine && (incLine.sentDate||incLine.receivedDate)) || incoming.sentDate || incoming.date || "";
      }
      return nb;
    }));
  }, [lines.map(l=>l.designNo).join(","), head.jobberId]);
  // auto-select challan's main jobber from the design's process assignment (design ↔ challan link)
  useEffect(() => {
    if (fixedJobber) return; // jobber's own form — jobber is fixed
    if (head.jobberId) return; // don't override a manual/existing pick
    const ln = lines[0];
    if (!ln || !ln.designNo || !ln.process) return;
    const design = designs.find(d => String(d.designNo)===String(ln.designNo).trim());
    if (!design || !design.processes) return;
    const procKey = Object.keys(design.processes).find(p => (ln.process||"").toLowerCase().includes(p.toLowerCase()) || p.toLowerCase().includes((ln.process||"").toLowerCase()));
    const assignedJobber = procKey ? design.processes[procKey]?.jobber : "";
    if (assignedJobber) setHead(h => ({ ...h, jobberId:assignedJobber }));
  }, [lines.map(l=>l.designNo+"|"+l.process).join(",")]);
  const updHead = k => v => setHead(f => ({ ...f, [k]:v }));
  // Pending inward lots for this jobber: lots sent TO him, not yet fully dispatched by him
  const myInwardLots = (() => {
    const me = fixedJobber || head.jobberId;
    if (!me) return [];
    // aggregate received per design (from challans sent to me) and dispatched per design (my onward challans)
    const recv = {}; // designNo -> { qty, fromName, date, challanId }
    (challans||[]).forEach(c => {
      if (c.status==="rejected") return;
      const lns = (c.lines && c.lines.length) ? c.lines : [{ designNo:c.designNo, qty:c.qty, sentDate:c.sentDate, sentToId:c.sendToId }];
      lns.forEach(l => {
        const sentTo = l.sentToId || c.sendToId;
        if (sentTo!==me) return;            // only lines sent TO me
        const dn = String(l.designNo); const q = +l.qty||0;
        if (q<=0) return;
        if (!recv[dn]) recv[dn] = { qty:0, fromName:(jobbers.find(j=>j.id===c.jobberId)||{}).name||c.receivedFrom||"Aashish Apparels", date:l.sentDate||c.sentDate||c.date||"", challanId:c.id };
        recv[dn].qty += q;
        const dt = l.sentDate||c.sentDate||c.date||"";
        if (dt > recv[dn].date) recv[dn].date = dt;
      });
    });
    const disp = {}; // designNo -> dispatched qty by me
    (challans||[]).forEach(c2 => {
      if (c2.jobberId!==me || c2.status==="rejected") return;
      ((c2.lines&&c2.lines.length)?c2.lines:[{designNo:c2.designNo,qty:c2.qty,sentToId:c2.sendToId}]).forEach(x=>{
        const sentTo = x.sentToId || c2.sendToId;
        if (!sentTo) return;
        const dn=String(x.designNo); disp[dn]=(disp[dn]||0)+(+x.qty||0);
      });
    });
    return Object.keys(recv).map(dn => {
      const received = recv[dn].qty; const dispatched = disp[dn]||0; const pending = received - dispatched;
      return { designNo:dn, fromName:recv[dn].fromName, date:recv[dn].date, received, dispatched, pendingQty:pending };
    }).filter(lot => lot.pendingQty > 0); // tallied (fully dispatched) lots disappear
  })();
  function fillFromLot(lot) {
    setLines(prev => {
      const first = { ...(prev[0]||{}) };
      first.designNo = lot.designNo;
      first.receivedFrom = lot.fromName;
      first.receivedDate = lot.date;
      first.qty = String(lot.pendingQty||lot.received);
      if (first.rate) first.amount = (+first.qty||0)*(+first.rate||0);
      return [first, ...prev.slice(1)];
    });
  }
  // Previous-jobber chain for the currently picked design (locked, money-hidden rows shown above the form)
  const chainDesignNo = lines[0] ? String(lines[0].designNo||"").trim() : "";
  const prevChain = (() => {
    if (!chainDesignNo) return [];
    const me = fixedJobber || head.jobberId;
    const rows = [];
    (challans||[]).forEach(c => {
      if (c.status==="rejected") return;
      if (!challanDesigns(c).includes(chainDesignNo)) return;
      const lns = (c.lines && c.lines.length) ? c.lines : [{ designNo:c.designNo, qty:c.qty, process:c.process, receivedFrom:c.receivedFrom, sentToId:c.sendToId, receivedDate:c.receivedDate, sentDate:c.sentDate, remark:c.remark }];
      lns.forEach(l => {
        if (String(l.designNo)!==chainDesignNo) return;
        rows.push({
          who:(jobbers.find(j=>j.id===c.jobberId)||{}).name||"—",
          process:l.process||c.process||"",
          qty:+l.qty||0,
          remark:l.remark||"",
          from:l.receivedFrom||c.receivedFrom||"",
          to:(jobbers.find(j=>j.id===(l.sentToId||c.sendToId))||{}).name||(((l.sentToId||c.sendToId)==="__office__")?"Office":""),
          recd:l.receivedDate||c.receivedDate||"",
          sent:l.sentDate||c.sentDate||c.date||"",
          date:c.date||"",
          half:!!c.halfStitch,
        });
      });
    });
    return rows.sort((a,b)=>(a.sent||a.date||"").localeCompare(b.sent||b.date||""));
  })();
  const actingJobber = jobbers.find(j => j.id === (fixedJobber || head.jobberId));
  const mayCreateDesign = isAdmin || (actingJobber && actingJobber.canCreateDesign);
  const photoRef = useRef();
  function handlePhoto(e) { const file = e.target.files[0]; if (!file) return; compressImage(file).then(src => updHead("photo")(src)).catch(()=>{}); }

  function addLine() { setLines(l => [...l, { id:`L${Date.now()}`, designNo:"", process:"", qty:"", rate:"", isSplit:false, newDesign:false, receivedFrom:"Aashish Apparels", sentToId:"", receivedDate:"", sentDate:"", remark:"" }]); }
  function removeLine(id) { setLines(l => l.length>1 ? l.filter(x=>x.id!==id) : l); }
  function updLine(id, k, v) { setLines(l => l.map(x => x.id===id ? { ...x, [k]:v } : x)); }

  // per-line computed info
  function lineInfo(ln) {
    const amount = (+ln.qty||0) * (+ln.rate||0);
    const designExists = designs.some(d => String(d.designNo) === String(ln.designNo).trim());
    const isNewDesign = false; // design creation removed from challan — must pick existing design
    // A typed design number that does NOT exist = invalid (cannot create design from challan).
    const unknownDesign = ln.designNo.trim() && !designExists;
    const dup = (ln.designNo && ln.process)
      ? challans.find(c => challanDesigns(c).includes(String(ln.designNo).trim()) && (c.lines||[]).concat([{process:c.process}]).some(x=>x.process===ln.process) && c.status!=="rejected" && c.jobberId!==head.jobberId)
      : null;
    return { amount, isNewDesign, unknownDesign, dup, dupBlocked: dup && !ln.isSplit };
  }
  const total = lines.reduce((a,ln)=>{ const isHalf = !!ln.halfStitch && (ln.process||"").toLowerCase().includes("stitch"); return a+(isHalf?0:((+ln.qty||0)*(+ln.rate||0))); },0);
  const anyFullLine = lines.some(ln => {
    const isHalfStitch = ln.halfStitch && (ln.process||"").toLowerCase().includes("stitch");
    return !isHalfStitch; // any non-half-stitch line is money-bearing
  });
  const anyBlocked = lines.some(ln => lineInfo(ln).dupBlocked);
  const anyUnknown = lines.some(ln => lineInfo(ln).unknownDesign);
  const validLines = lines.filter(ln => ln.designNo && ln.qty);
  const canSave = head.jobberId && validLines.length>0 && !anyBlocked && !anyUnknown;

  const [saving, setSaving] = useState(false);
  function save() {
    if (!canSave || saving) return;
    // Guard: warn if an identical challan (same jobber + same design lines + qty) was created very recently
    const myDesigns = validLines.map(ln => String(ln.designNo).trim()+":"+(+ln.qty||0)).sort().join("|");
    const dupRecent = (challans||[]).find(c => {
      if (c.jobberId!==head.jobberId || c.status==="rejected") return false;
      const cd = ((c.lines&&c.lines.length)?c.lines:[{designNo:c.designNo,qty:c.qty}]).map(l=>String(l.designNo).trim()+":"+(+l.qty||0)).sort().join("|");
      return cd===myDesigns;
    });
    if (dupRecent) {
      const ok = window.confirm(`You already have a challan for the same design(s) and quantity (${validLines.map(l=>"D"+l.designNo+" "+l.qty+"pcs").join(", ")}).\n\nCreate ANOTHER one anyway?`);
      if (!ok) return;
    }
    setSaving(true);
    const builtLines = validLines.map(ln => {
      const isHalf = !!ln.halfStitch && (ln.process||"").toLowerCase().includes("stitch");
      return { designNo:String(ln.designNo).trim(), process:ln.process, qty:+ln.qty, rate:isHalf?0:(+ln.rate||0), amount:isHalf?0:((+ln.qty||0)*(+ln.rate||0)), halfStitch:isHalf, isSplit:!!ln.isSplit, remark:ln.remark||"", receivedFrom:ln.receivedFrom||"", sentToId:ln.sentToId||"", receivedDate:ln.receivedDate||"", sentDate:ln.sentDate||"" };
    });
    const newDesignNos = validLines.filter(ln => lineInfo(ln).isNewDesign).map(ln => String(ln.designNo).trim());
    const newDesignData = {};
    validLines.filter(ln => lineInfo(ln).isNewDesign).forEach(ln => {
      newDesignData[String(ln.designNo).trim()] = { supplier:ln.fabSupplier||"", colors:(ln.fabColors||[]).filter(c=>c.name||c.meters||c.swatch) };
    });
    // first line's process/design kept at top-level for back-compat & simple displays
    const first = builtLines[0];
    const allHalf = builtLines.every(l => l.halfStitch);
    onSave({
      id:`CH${Date.now()}`, jobberId:head.jobberId, date:head.date, challanNo:head.challanNo, photo:head.photo, sendToId:head.sendToId, gstPct: allHalf?0:(+head.gstPct||0), halfStitch: allHalf,
      lines:builtLines, designNo:first.designNo, process:first.process, qty:builtLines.reduce((a,l)=>a+l.qty,0), rate:first.rate, amount:builtLines.reduce((a,l)=>a+l.amount,0),
      isSplit: builtLines.some(l=>l.isSplit), status:"approved", billed:false, createdBy:currentUser, createdAtStr:nowStr(), newDesignNos, newDesignData
    });
  }

  return (
    <Modal title="New Challan" onClose={onClose}>
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
              {(() => {
                const ln = lines[0]; if(!ln||!ln.designNo||!ln.process) return null;
                const d = designs.find(x=>String(x.designNo)===String(ln.designNo).trim());
                const pk = d&&d.processes ? Object.keys(d.processes).find(p=>(ln.process||"").toLowerCase().includes(p.toLowerCase())||p.toLowerCase().includes((ln.process||"").toLowerCase())) : null;
                const aj = pk ? d.processes[pk]?.jobber : "";
                if (aj && aj===head.jobberId) return <div style={{ fontFamily:T.mono, fontSize:8, color:T.green, marginTop:2 }}>↳ auto from design's {pk} assignment · editable</div>;
                return null;
              })()}
            </div>
        }
        <Inp label="Challan No" value={head.challanNo} onChange={updHead("challanNo")} />
        <Inp label="Date" type="date" value={head.date} onChange={updHead("date")} />
      </div>

      {fixedJobber && myInwardLots.length>0 && (
        <div style={{ background:T.accent+"0D", border:`1px solid ${T.accent}44`, borderRadius:8, padding:12, marginBottom:14 }}>
          <div style={{ fontFamily:T.mono, fontSize:10, color:T.accent, textTransform:"uppercase", fontWeight:700, marginBottom:8, letterSpacing:1 }}>📥 My Inward Lots — tap one to fill</div>
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            {myInwardLots.map((lot,i) => (
              <button key={i} onClick={()=>fillFromLot(lot)} style={{ display:"flex", gap:12, alignItems:"center", flexWrap:"wrap", background:T.surface, border:`1px solid ${T.border}`, borderRadius:6, padding:"8px 12px", cursor:"pointer", textAlign:"left" }}>
                <span style={{ fontFamily:T.mono, fontSize:13, color:T.gold, fontWeight:700 }}>Design {lot.designNo}</span>
                <span style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt }}>from {lot.fromName}</span>
                <span style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt }}>recd {lot.date||"—"}</span>
                <span style={{ fontFamily:T.mono, fontSize:10, color:T.text }}>Recd <b>{lot.received}</b> · Sent <b>{lot.dispatched}</b> · <span style={{ color:T.orange }}>Pending <b>{lot.pendingQty}</b></span></span>
                <span style={{ marginLeft:"auto", fontFamily:T.mono, fontSize:9, color:T.accent }}>tap to fill →</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {fixedJobber && prevChain.length>0 && (
        <div style={{ marginBottom:14 }}>
          <div style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, textTransform:"uppercase", marginBottom:6, letterSpacing:1 }}>Previous work on Design {chainDesignNo} (view only)</div>
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            {prevChain.map((r,i) => (
              <details key={i} style={{ background:T.card, border:`1px solid ${T.border}`, borderLeft:`4px solid ${T.steelLt}`, borderRadius:8 }}>
                <summary style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 12px", cursor:"pointer", listStyle:"none", flexWrap:"wrap" }}>
                  <span style={{ fontFamily:T.mono, fontSize:10, color:"#fff", background:T.steelLt, borderRadius:5, padding:"2px 7px", fontWeight:700 }}>{i+1}</span>
                  <span style={{ fontWeight:700, fontSize:13 }}>{r.who}</span>
                  {r.process && <span style={{ fontFamily:T.mono, fontSize:10, color:T.accent, background:T.accent+"18", padding:"2px 8px", borderRadius:5 }}>{r.process}{r.half?" (Half)":""}</span>}
                  <span style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt }}>🔒 view only</span>
                  <span style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, marginLeft:"auto" }}>{r.qty} pcs · {r.sent||r.date||"—"}</span>
                </summary>
                <div style={{ padding:"0 12px 10px 12px" }}>
                  <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11, fontFamily:T.mono }}>
                    <tbody>
                      <tr><td style={{ color:T.steelLt, padding:"3px 6px", width:110 }}>Quantity</td><td style={{ padding:"3px 6px" }}>{r.qty}</td><td style={{ color:T.steelLt, padding:"3px 6px", width:90 }}>Remark</td><td style={{ padding:"3px 6px" }}>{r.remark||"—"}</td></tr>
                      <tr><td style={{ color:T.steelLt, padding:"3px 6px" }}>Received from</td><td style={{ padding:"3px 6px" }}>{r.from||"—"}</td><td style={{ color:T.steelLt, padding:"3px 6px" }}>Sent to</td><td style={{ padding:"3px 6px" }}>{r.to||"—"}</td></tr>
                      <tr><td style={{ color:T.steelLt, padding:"3px 6px" }}>Recd date</td><td style={{ padding:"3px 6px" }}>{r.recd||"—"}</td><td style={{ color:T.steelLt, padding:"3px 6px" }}>Sent date</td><td style={{ padding:"3px 6px" }}>{r.sent||"—"}</td></tr>
                    </tbody>
                  </table>
                  <div style={{ fontFamily:T.mono, fontSize:9, color:T.textDim, fontStyle:"italic", marginTop:4 }}>— rate / amount / GST hidden for previous jobbers —</div>
                </div>
              </details>
            ))}
          </div>
        </div>
      )}

      {/* Design lines */}
      <div style={{ fontFamily:T.mono, fontSize:10, color:T.gold, textTransform:"uppercase", marginBottom:8, letterSpacing:1 }}>Designs in this challan — each can have its own sender/receiver</div>
      {lines.map((ln,idx) => {
        const info = lineInfo(ln);
        const dupName = info.dup ? ((jobbers.find(j=>j.id===info.dup.jobberId)||{}).name||"another jobber") : "";
        return (
          <div key={ln.id} style={{ background:T.surface, borderRadius:8, padding:12, marginBottom:10, border:`1px solid ${info.dupBlocked?T.red:T.border}` }}>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"flex-end" }}>
              <div style={{ display:"flex", flexDirection:"column", gap:4, flex:"2 1 140px" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <label style={{ fontFamily:T.mono, fontSize:9, color:T.steelLt, textTransform:"uppercase" }}>Design No *</label>
                </div>
                {<>
                    <input list={`chdl-${ln.id}`} value={ln.designNo} onChange={e => updLine(ln.id,"designNo",e.target.value)} placeholder="type design no or pick" style={{ background:T.bg, border:`1px solid ${T.border}`, borderRadius:6, color:T.text, fontFamily:T.sans, fontSize:13, padding:"7px 10px", width:"100%", boxSizing:"border-box" }} />
                    <datalist id={`chdl-${ln.id}`}>
                      {availableDesigns.map(d => <option key={d.id} value={d.designNo}>{designLabel(d)}</option>)}
                    </datalist>
                    {fixedJobber && availableDesigns.length===0 && <div style={{ fontFamily:T.mono, fontSize:9, color:T.orange, marginTop:3 }}>No designs to dispatch. Designs appear here when sent to you, and stay until you dispatch the full quantity.</div>}
                  </>
                }
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:4, flex:"1 1 100px" }}>
                <label style={{ fontFamily:T.mono, fontSize:9, color:T.steelLt, textTransform:"uppercase" }}>Process</label>
                {ln.customProcess
                  ? <div style={{ display:"flex", gap:4 }}>
                      <input value={ln.process} onChange={e => updLine(ln.id,"process",e.target.value)} placeholder="type task e.g. printing" autoFocus style={{ background:T.bg, border:`1px solid ${T.accent}`, borderRadius:6, color:T.text, fontFamily:T.sans, fontSize:13, padding:"7px 10px", width:"100%", boxSizing:"border-box" }} />
                      <button onClick={()=>{ updLine(ln.id,"customProcess",false); updLine(ln.id,"process",""); }} style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:6, color:T.steelLt, padding:"0 8px", cursor:"pointer", fontSize:11 }}>list</button>
                    </div>
                  : <select value={ln.process} onChange={e => { if(e.target.value==="__custom__"){ updLine(ln.id,"customProcess",true); updLine(ln.id,"process",""); } else { updLine(ln.id,"process",e.target.value); } }} style={{ background:T.bg, border:`1px solid ${T.border}`, borderRadius:6, color:T.text, fontFamily:T.sans, fontSize:13, padding:"7px 10px", width:"100%", boxSizing:"border-box" }}>
                  <option value="">—</option>
                  {(() => {
                    // For a jobber login, show ONLY the tasks this jobber does (with code). Admin sees all.
                    const me = fixedJobber ? jobbers.find(j=>j.id===fixedJobber) : null;
                    const myProcs = me ? (me.processCodes||[]).map(x=>x.process).filter(Boolean) : [];
                    const opts = (fixedJobber && myProcs.length) ? myProcs : PROCESSES;
                    return opts.map(p => {
                      const code = me ? ((me.processCodes||[]).find(x=>x.process===p)||{}).code : "";
                      return <option key={p} value={p}>{p}{code?` (${code})`:""}</option>;
                    });
                  })()}
                  <option value="__custom__">+ Other (type custom task)</option>
                </select>}
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:4, width:70 }}>
                <label style={{ fontFamily:T.mono, fontSize:9, color:T.steelLt, textTransform:"uppercase" }}>Qty *</label>
                <input type="number" value={ln.qty} onChange={e => updLine(ln.id,"qty",e.target.value)} style={{ background:T.bg, border:`1px solid ${T.border}`, borderRadius:6, color:T.text, fontFamily:T.mono, fontSize:13, padding:"7px 8px", width:"100%", boxSizing:"border-box" }} />
              </div>
              {!(ln.halfStitch && (ln.process||"").toLowerCase().includes("stitch")) && <div style={{ display:"flex", flexDirection:"column", gap:4, width:80 }}>
                <label style={{ fontFamily:T.mono, fontSize:9, color:T.steelLt, textTransform:"uppercase" }}>Rate</label>
                <input type="number" value={ln.rate} onChange={e => updLine(ln.id,"rate",e.target.value)} style={{ background:T.bg, border:`1px solid ${T.border}`, borderRadius:6, color:T.text, fontFamily:T.mono, fontSize:13, padding:"7px 8px", width:"100%", boxSizing:"border-box" }} />
              </div>}
              {!(ln.halfStitch && (ln.process||"").toLowerCase().includes("stitch")) && <div style={{ display:"flex", flexDirection:"column", gap:4, width:90 }}>
                <label style={{ fontFamily:T.mono, fontSize:9, color:T.steelLt, textTransform:"uppercase" }}>Amount</label>
                <div style={{ fontFamily:T.mono, fontSize:14, color:T.gold, fontWeight:700, padding:"7px 0" }}>Rs.{info.amount}</div>
              </div>}
              {lines.length>1 && <Btn label="✕" onClick={() => removeLine(ln.id)} color={T.red+"22"} textColor={T.red} small />}
            </div>
            {/* Fabric details for a NEW design created via challan */}
            {/* Per-design received/sent tracking */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:8, marginTop:8 }}>
              <Inp label="Received From" value={ln.receivedFrom||""} onChange={v => updLine(ln.id,"receivedFrom",v)} placeholder="who sent it" />
              <Inp label="Received Date" type="date" value={ln.receivedDate||""} onChange={v => updLine(ln.id,"receivedDate",v)} />
              <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                <label style={{ fontFamily:T.mono, fontSize:9, color:T.steelLt, textTransform:"uppercase" }}>Sent To</label>
                <select value={ln.sentToId||""} onChange={e => updLine(ln.id,"sentToId",e.target.value)} style={{ background:T.bg, border:`1px solid ${T.border}`, borderRadius:6, color:T.text, fontFamily:T.sans, fontSize:13, padding:"7px 8px", width:"100%", boxSizing:"border-box" }}>
                  <option value="">— keep —</option>
                  <option value="__office__">Office / Admin</option>
                  {jobbers.filter(j=>j.role==="jobber"&&j.id!==(fixedJobber||head.jobberId)).map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
                </select>
              </div>
              <Inp label="Sent Date" type="date" value={ln.sentDate||""} onChange={v => updLine(ln.id,"sentDate",v)} />
            </div>
            {/* Per-line Half/Full Stitch toggle — only for stitch process */}
            {(ln.process||"").toLowerCase().includes("stitch") && (
              <div style={{ display:"flex", gap:8, marginTop:8, flexWrap:"wrap" }}>
                <button onClick={()=>updLine(ln.id,"halfStitch",true)} style={{ flex:1, minWidth:140, background:ln.halfStitch?T.orange+"22":T.surface, border:`2px solid ${ln.halfStitch?T.orange:T.border}`, borderRadius:8, padding:"8px 12px", cursor:"pointer", textAlign:"left" }}>
                  <div style={{ fontFamily:T.sans, fontSize:12, color:ln.halfStitch?T.orange:T.text, fontWeight:700 }}>◐ Half Stitch</div>
                  <div style={{ fontFamily:T.mono, fontSize:8, color:T.steelLt }}>movement only — no rate/amount</div>
                </button>
                <button onClick={()=>updLine(ln.id,"halfStitch",false)} style={{ flex:1, minWidth:140, background:!ln.halfStitch?T.green+"22":T.surface, border:`2px solid ${!ln.halfStitch?T.green:T.border}`, borderRadius:8, padding:"8px 12px", cursor:"pointer", textAlign:"left" }}>
                  <div style={{ fontFamily:T.sans, fontSize:12, color:!ln.halfStitch?T.green:T.text, fontWeight:700 }}>● Full Stitch</div>
                  <div style={{ fontFamily:T.mono, fontSize:8, color:T.steelLt }}>with rate/amount — counts in cost</div>
                </button>
              </div>
            )}
            {/* Remark */}
            <div style={{ marginTop:8 }}>
              <input value={ln.remark||""} onChange={e => updLine(ln.id,"remark",e.target.value)} placeholder="Remark (optional)" style={{ background:T.bg, border:`1px solid ${T.border}`, borderRadius:6, color:T.text, fontFamily:T.sans, fontSize:12, padding:"7px 10px", width:"100%", boxSizing:"border-box" }} />
            </div>
            {/* Read-only design summary (Option 3) */}
            {(() => {
              const d = designs.find(x => String(x.designNo)===String(ln.designNo).trim());
              if (!d) return null;
              const cols = (d.colors||[]).map(c=>c.colorName).filter(Boolean).join(", ");
              const pcs = (d.colors||[]).reduce((a,c)=>a+Object.values(c.sizes||{}).reduce((x,v)=>x+(+v||0),0),0);
              return (
                <div style={{ marginTop:8, background:T.bg, borderRadius:6, padding:"8px 12px", fontFamily:T.mono, fontSize:10, color:T.steelLt, display:"flex", gap:14, flexWrap:"wrap" }}>
                  <span>📋 {d.brand||""} {d.style||""}</span>
                  {d.fabric && <span>Fabric: {d.fabric}</span>}
                  {cols && <span>Colors: {cols}</span>}
                  {pcs>0 && <span>Total: {pcs} pcs</span>}
                </div>
              );
            })()}
            {info.isNewDesign && <div style={{ fontFamily:T.mono, fontSize:9, color:T.green, marginTop:6 }}>✓ New placeholder design "{ln.designNo}" will be created.</div>}
            {info.unknownDesign && <div style={{ fontFamily:T.mono, fontSize:10, color:T.red, marginTop:6, fontWeight:700 }}>⚠ Design "{ln.designNo}" does not exist. Pick an existing design from the list. To create a new design, use the "+ New Design" button first (stitcher) or ask admin.</div>}
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

      {/* GST + Total — shown when at least one full (money-bearing) line exists */}
      {anyFullLine && <div style={{ display:"flex", justifyContent:"flex-end", alignItems:"center", gap:12, marginBottom:14, flexWrap:"wrap" }}>
        <div style={{ width:140 }}>
          <Inp label="GST % (optional)" value={head.gstPct} onChange={updHead("gstPct")} options={["","5","12","18"]} />
        </div>
        <div style={{ background:T.bg, borderRadius:8, padding:"10px 18px", border:`1px solid ${T.gold}44` }}>
          <div style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt }}>Base: Rs.{total}{+head.gstPct>0?` + GST ${head.gstPct}%`:""}</div>
          <span style={{ fontFamily:T.mono, fontSize:11, color:T.steelLt }}>CHALLAN TOTAL: </span>
          <span style={{ fontFamily:T.mono, fontSize:18, color:T.gold, fontWeight:900 }}>Rs.{(total + total*(+head.gstPct||0)/100).toFixed(2)}</span>
        </div>
      </div>}

      <div style={{ display:"flex", gap:10, alignItems:"center", marginBottom:14 }}>
        <Btn label={head.photo?"Change Photo":"+ Challan Photo (optional)"} onClick={()=>photoRef.current.click()} color={T.surface} textColor={T.gold} small style={{ border:`1px solid ${T.border}` }} />
        {head.photo && <img src={head.photo} alt="" style={{ width:40, height:40, borderRadius:4, objectFit:"cover" }} />}
        <input ref={photoRef} type="file" accept="image/*" style={{ display:"none" }} onChange={handlePhoto} />
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:4, marginBottom:14 }}>
        <label style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, textTransform:"uppercase" }}>Send ALL designs to (optional — only if same for all)</label>
        <select value={head.sendToId} onChange={e => updHead("sendToId")(e.target.value)} style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:6, color:T.text, fontFamily:T.sans, fontSize:13, padding:"8px 12px", width:"100%", boxSizing:"border-box" }}>
          <option value="">— use per-design "Sent To" above —</option>
          <option value="__office__">🏢 Office / Admin</option>
          {jobbers.filter(j=>j.role==="jobber" && j.id!==head.jobberId).map(j => <option key={j.id} value={j.id}>{j.name && j.name.trim() ? j.name : `(no name — ${j.id})`}</option>)}
        </select>
      </div>
      {!isAdmin && <div style={{ fontFamily:T.mono, fontSize:10, color:T.orange, marginBottom:12 }}>This challan auto-posts to the cost sheet & your ledger now. Admin can reject it later if wrong.</div>}
      <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
        <Btn label="Cancel" onClick={onClose} color={T.surface} textColor={T.steelLt} />
        <Btn label={saving?"Saving…":"Save Challan"} onClick={save} disabled={!canSave || saving} />
      </div>
    </Modal>
  );
}

// ── Bills + Payments + Dual Ledger ────────────────────────────────────────────
// ── Bill Edit Modal (admin): change bill no, date, and per-line qty/rate ──────
function BillEditModal({ bill, jobberName, onClose, onSave }) {
  const [billNo, setBillNo] = useState(bill.billNo||"");
  const [billDate, setBillDate] = useState(bill.billDate||"");
  const [lines, setLines] = useState((bill.lines||[]).map(l=>({...l})));
  function updLine(i,k,v){ setLines(p=>p.map((l,idx)=>{ if(idx!==i) return l; const nl={...l,[k]:v}; if(k==="qty"||k==="rate") nl.amount=(+nl.qty||0)*(+nl.rate||0); return nl; })); }
  function doSave(){
    const built = lines.map(l=>({ ...l, qty:+l.qty||0, rate:+l.rate||0, amount:(+l.qty||0)*(+l.rate||0) }));
    const gross = built.reduce((a,l)=>a+(+l.amount||0),0);
    const gstAmt = bill.hasGst ? gross*((+bill.gstPct||0)/100) : 0;
    const total = Math.round(gross+gstAmt);
    onSave({ ...bill, billNo, billDate, lines:built, gross, gstAmt, total });
  }
  const cell = { padding:"6px 8px", fontFamily:T.mono, fontSize:12 };
  return (
    <Modal title={`Edit Bill — ${jobberName||""}`} onClose={onClose}>
      <div style={{ fontFamily:T.mono, fontSize:10, color:T.orange, marginBottom:12 }}>⚠ Editing an approved bill. Change bill no, date, qty, rate.</div>
      <div style={{ display:"flex", gap:10, marginBottom:14, flexWrap:"wrap" }}>
        <Inp label="Bill No" value={billNo} onChange={setBillNo} style={{ minWidth:120 }} />
        <Inp label="Bill Date" type="date" value={billDate} onChange={setBillDate} style={{ minWidth:150 }} />
      </div>
      <div style={{ overflowX:"auto" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", minWidth:520 }}>
          <thead><tr style={{ background:T.surface }}>{["Challan","Design","Process","Qty","Rate","Amount"].map(h => <th key={h} style={{ ...cell, fontSize:9, color:T.steelLt, textTransform:"uppercase", textAlign:(h==="Qty"||h==="Rate"||h==="Amount")?"right":"left" }}>{h}</th>)}</tr></thead>
          <tbody>
            {lines.map((l,i)=>(
              <tr key={i} style={{ borderBottom:`1px solid ${T.border}` }}>
                <td style={{ ...cell, color:T.steelLt }}>{l.challanNo||"—"}</td>
                <td style={{ ...cell, color:T.gold, fontWeight:700 }}>D{l.designNo}</td>
                <td style={{ ...cell, color:T.text }}>{l.process||"—"}</td>
                <td style={{ ...cell, width:70 }}><input type="number" value={l.qty} onChange={e=>updLine(i,"qty",e.target.value)} style={{ width:60, background:T.bg, border:`1px solid ${T.border}`, borderRadius:4, color:T.text, fontSize:12, padding:"4px 6px", textAlign:"right" }} /></td>
                <td style={{ ...cell, width:70 }}><input type="number" value={l.rate} onChange={e=>updLine(i,"rate",e.target.value)} style={{ width:60, background:T.bg, border:`1px solid ${T.border}`, borderRadius:4, color:T.text, fontSize:12, padding:"4px 6px", textAlign:"right" }} /></td>
                <td style={{ ...cell, textAlign:"right", color:T.white, fontWeight:700 }}>Rs.{(+l.amount||0).toFixed(0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:14 }}>
        <span style={{ fontFamily:T.mono, fontSize:13, fontWeight:700, color:T.gold }}>Gross Rs.{lines.reduce((a,l)=>a+(+l.amount||0),0).toFixed(0)}</span>
        <div style={{ display:"flex", gap:10 }}>
          <Btn label="Cancel" onClick={onClose} color={T.surface} textColor={T.steelLt} />
          <Btn label="Save Changes" onClick={doSave} color={T.gold} textColor={T.bg} />
        </div>
      </div>
    </Modal>
  );
}

// ── Bill Detail Modal: grouped by challan, subtotal per challan ───────────────
function BillDetailModal({ bill, jobberName, onClose }) {
  const lines = bill.lines || [];
  // group lines by challanNo (fallback "—")
  const groups = {};
  lines.forEach(l => {
    const key = l.challanNo || "—";
    if (!groups[key]) groups[key] = { challanNo:key, date:l.date||"", rows:[] };
    if (!groups[key].date && l.date) groups[key].date = l.date;
    groups[key].rows.push(l);
  });
  const groupList = Object.values(groups);
  const grand = lines.reduce((a,l)=>a+(+l.amount||0),0);
  const cell = { padding:"7px 9px", fontFamily:T.mono, fontSize:12, borderBottom:`1px solid ${T.border}` };
  const head = { ...cell, fontSize:9, color:T.steelLt, textTransform:"uppercase", textAlign:"left", background:T.surface };
  return (
    <Modal title={`Bill ${bill.billNo||""} · ${jobberName||""}`} onClose={onClose}>
      <div style={{ fontFamily:T.mono, fontSize:11, color:T.steelLt, marginBottom:12 }}>Date {bill.billDate||"—"} · {groupList.length} challan(s) · {lines.length} line(s)</div>
      {groupList.map((g,gi) => {
        const sub = g.rows.reduce((a,l)=>a+(+l.amount||0),0);
        const subQty = g.rows.reduce((a,l)=>a+(+l.qty||0),0);
        return (
          <div key={gi} style={{ marginBottom:16, border:`1px solid ${T.border}`, borderRadius:8, overflow:"hidden" }}>
            <div style={{ background:T.accent+"14", padding:"8px 10px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span style={{ fontFamily:T.mono, fontSize:12, fontWeight:700, color:T.accent }}>Challan {g.challanNo}</span>
              <span style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt }}>{g.date}</span>
            </div>
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse", minWidth:520 }}>
                <thead><tr>{["Design","Process","Qty","Rate","Amount"].map(h => <th key={h} style={{ ...head, textAlign: (h==="Qty"||h==="Rate"||h==="Amount")?"right":"left" }}>{h}</th>)}</tr></thead>
                <tbody>
                  {g.rows.map((l,ri) => (
                    <tr key={ri}>
                      <td style={{ ...cell, color:T.gold, fontWeight:700 }}>D{l.designNo}</td>
                      <td style={{ ...cell, color:T.text }}>{l.process||"—"}</td>
                      <td style={{ ...cell, textAlign:"right", color:T.text }}>{l.qty||0}</td>
                      <td style={{ ...cell, textAlign:"right", color:T.text }}>{l.rate||0}</td>
                      <td style={{ ...cell, textAlign:"right", color:T.white, fontWeight:700 }}>Rs.{(+l.amount||0).toFixed(0)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td style={{ ...cell, fontWeight:700, color:T.steelLt }} colSpan={2}>Subtotal</td>
                    <td style={{ ...cell, textAlign:"right", fontWeight:700, color:T.text }}>{subQty}</td>
                    <td style={{ ...cell }}></td>
                    <td style={{ ...cell, textAlign:"right", fontWeight:900, color:T.green }}>Rs.{sub.toFixed(0)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 10px", background:T.surface, borderRadius:8 }}>
        <span style={{ fontFamily:T.mono, fontSize:12, color:T.steelLt, textTransform:"uppercase", fontWeight:700 }}>Bill Total {bill.hasGst&&+bill.gstPct>0?`(+ ${bill.gstPct}% GST)`:""}</span>
        <span style={{ fontFamily:T.mono, fontSize:16, fontWeight:900, color:T.gold }}>Rs.{grand.toFixed(0)}{bill.hasGst&&+bill.total?` → Rs.${(+bill.total).toFixed(0)}`:""}</span>
      </div>
      {lines.length===0 && <div style={{ fontFamily:T.mono, fontSize:11, color:T.steelLt, textAlign:"center", padding:20 }}>This bill has no line details saved.</div>}
    </Modal>
  );
}

function BillsLedger({ jobbers, designs, bills, setBills, payments, setPayments, challans, setChallans, creditNotes, setCreditNotes, showToast, currentUser }) {
  const [selJ, setSelJ] = useState("");
  const [ledgerView, setLedgerView] = useState("bank");
  const [detailBill, setDetailBill] = useState(null);
  const [changeBillId, setChangeBillId] = useState("");
  const [editBill, setEditBill] = useState(null);
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
  const myBills = allMyBills.filter(b => yearOf(b.billDate)===yearFilter && b.status!=="pending");
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
    ...myChallans.filter(c=>!c.halfStitch).map(c => ({ date:c.date||"", kind:"debit", particulars:`Designs ${challanDesigns(c).join(", ")}${+c.gstPct>0?` (incl ${c.gstPct}% GST)`:""}`, ref:c.challanNo||"", debit:challanTotalWithGST(c), credit:0 })),
    ...myPays.map(p => ({ date:p.date||"", kind:"credit", particulars:`Payment (${p.mode||p.channel})${p.confirmed?` ✓ OK by jobber ${p.confirmDate||""}`:" — awaiting jobber OK"}`, ref:p.note||"", debit:0, credit:+p.amount||0 })),
    ...myCNs.map(c => ({ date:c.cnDate||"", kind:"credit", particulars:`Credit Note — ${c.reason||"claim"} (Designs ${cnDesignNos(c).join(", ")}${cnBillNos(c).length?` · Bills ${cnBillNos(c).join(", ")}`:""})`, ref:c.cnNo||"", debit:0, credit:+c.total||0 })),
  ].sort((a,b) => (a.date||"").localeCompare(b.date||""));
  let runBal = 0;
  const acctWithBal = acctRows.map(r => { runBal += r.debit - r.credit; return { ...r, balance:runBal }; });
  const acctDebit = acctRows.reduce((a,r)=>a+r.debit,0);
  const acctCredit = acctRows.reduce((a,r)=>a+r.credit,0);

  async function deleteBill(id, bill) {
    await dbDelete("bills", id);
    setBills(p=>p.filter(b=>b.id!==id));
    // free any challans that were billed by this bill
    const freed = (challans||[]).filter(c => c.billId===id);
    for (const c of freed) { const u={...c, billed:false, billId:""}; await dbUpsert("challans", challanToRow(u)); }
    if (freed.length) setChallans(p => p.map(c => c.billId===id ? { ...c, billed:false, billId:"" } : c));
    recordActivity(currentUser, "Deleted bill", `Jobber ${j?.name||""}`, bill?.billNo?`Bill ${bill.billNo}`:"");
    showToast(freed.length?"Bill deleted — challans freed":"Bill deleted");
  }
  async function deletePay(id) { if(!window.confirm("Delete this payment? This cannot be undone.")) return; await dbDelete("payments", id); setPayments(p=>p.filter(x=>x.id!==id)); recordActivity(currentUser, "Deleted payment", `Jobber ${j?.name||""}`, ""); showToast("Payment deleted"); }
  const [editPay, setEditPay] = useState(null);
  async function saveEditedPay(updated) {
    await dbUpsert("payments", payToRow(updated));
    setPayments(p => p.map(x => x.id===updated.id ? updated : x));
    recordActivity(currentUser, "Edited payment", `Jobber ${j?.name||""}`, `Rs.${updated.amount}`);
    showToast("Payment updated ✓");
    setEditPay(null);
  }

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
          {(() => {
            const pendingBills = allMyBills.filter(b => b.status==="pending");
            if (!pendingBills.length) return null;
            return (
              <div style={{ background:T.orange+"11", border:`1px solid ${T.orange}`, borderRadius:10, padding:14, marginBottom:16 }}>
                <div style={{ fontFamily:T.mono, fontSize:11, color:T.orange, textTransform:"uppercase", fontWeight:700, marginBottom:10 }}>🧾 Bills submitted by {j.name} — awaiting approval ({pendingBills.length})</div>
                {pendingBills.map(b => (
                  <div key={b.id} style={{ display:"flex", alignItems:"center", gap:12, padding:"8px 0", borderTop:`1px solid ${T.border}`, flexWrap:"wrap" }}>
                    <span style={{ fontFamily:T.mono, fontSize:12, fontWeight:700 }}>Bill {b.billNo}</span>
                    <span style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt }}>{b.billDate} · {(b.lines||[]).length} items</span>
                    <span style={{ fontFamily:T.mono, fontSize:14, fontWeight:900, color:T.gold }}>Rs.{(+b.total||0).toFixed(0)}</span>
                    <div style={{ marginLeft:"auto", display:"flex", gap:8 }}>
                      <Btn label="✓ Approve" small color={T.green} textColor="#fff" onClick={async()=>{
                        const updated = { ...b, status:"approved" };
                        await dbUpsert("bills", billToRow(updated));
                        setBills(p => p.map(x=>x.id===b.id?updated:x));
                        // mark the billed challans
                        const billedDesigns = new Set((b.lines||[]).map(l=>String(l.designNo)));
                        showToast("Bill approved ✓");
                      }} />
                      <Btn label="✕ Reject" small color={T.red+"22"} textColor={T.red} onClick={async()=>{
                        if(!window.confirm("Reject this bill? The jobber will need to resubmit.")) return;
                        await dbDelete("bills", b.id);
                        setBills(p => p.filter(x=>x.id!==b.id));
                        // free up the challans that were billed by this rejected bill
                        const freed = (challans||[]).filter(c => c.billId===b.id);
                        for (const c of freed) { const u={...c, billed:false, billId:""}; await dbUpsert("challans", challanToRow(u)); }
                        setChallans(p => p.map(c => c.billId===b.id ? { ...c, billed:false, billId:"" } : c));
                        showToast("Bill rejected — challans freed");
                      }} />
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}

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
                <tr key={b.id||i} onClick={()=>setDetailBill(b)} style={{ background:i%2===0?T.card:T.surface, borderBottom:`1px solid ${T.border}`, borderLeft:`4px solid ${monthColor(b.billDate)}`, cursor:"pointer" }}>
                  <td style={{ padding:"8px 10px", color:T.steelLt }}>{b.billDate}</td>
                  <td style={{ padding:"8px 10px", color:T.gold, fontFamily:T.mono, textDecoration:"underline" }}>{b.billNo}</td>
                  <td style={{ padding:"8px 10px", color:T.text, fontFamily:T.mono }}>{(b.lines||[]).map(l=>l.designNo).join(", ")}</td>
                  <td style={{ padding:"8px 10px", color:linkedNos.length?T.green:T.textDim, fontFamily:T.mono, fontSize:10 }}>{linkedNos.length?linkedNos.join(", "):"none"}</td>
                  <td style={{ padding:"8px 10px" }}><Badge label={b.hasGst?"GST/Bank":"Cash"} color={b.hasGst?T.gold:T.steelLt} /></td>
                  <td style={{ padding:"8px 10px", color:T.white, fontFamily:T.mono, fontWeight:700 }}>Rs.{(+b.total||0).toFixed(2)}</td>
                  <td style={{ padding:"8px 10px", whiteSpace:"nowrap" }} onClick={(e)=>e.stopPropagation()}>
                    {changeBillId===b.id ? (
                      <span style={{ display:"inline-flex", gap:6, alignItems:"center" }}>
                        <Btn label="Edit" small color={T.gold} textColor={T.bg} onClick={(e)=>{ e.stopPropagation(); setEditBill(b); setChangeBillId(""); }} />
                        <Btn label="Delete" small color={T.red} textColor="#fff" onClick={(e)=>{ e.stopPropagation(); if(window.confirm(`Delete bill ${b.billNo||""}? This frees its challans for re-billing. Cannot be undone.`)){ deleteBill(b.id, b); setChangeBillId(""); } }} />
                        <Btn label="✕" small color={T.surface} textColor={T.steelLt} onClick={(e)=>{ e.stopPropagation(); setChangeBillId(""); }} />
                      </span>
                    ) : (
                      <Btn label="Change needed" small color={T.surface} textColor={T.accent} style={{ border:`1px solid ${T.accent}55` }} onClick={(e)=>{ e.stopPropagation(); setChangeBillId(b.id); }} />
                    )}
                  </td>
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
                  <td style={{ padding:"8px 10px", display:"flex", gap:4 }}><Btn label="✎" onClick={() => setEditPay(p)} color={T.gold+"22"} textColor={T.gold} small /><Btn label="✕" onClick={() => deletePay(p.id)} color={T.red+"22"} textColor={T.red} small /></td>
                </tr>
              ))}
            </tbody>
          </table>
          </>}

          {detailBill && <BillDetailModal bill={detailBill} jobberName={(jobbers.find(x=>x.id===detailBill.jobberId)||{}).name||j?.name||""} onClose={()=>setDetailBill(null)} />}
          {editBill && <BillEditModal bill={editBill} jobberName={(jobbers.find(x=>x.id===editBill.jobberId)||{}).name||j?.name||""} onClose={()=>setEditBill(null)} onSave={async (updated) => {
            await dbUpsert("bills", billToRow(updated));
            setBills(p=>p.map(x=>x.id===updated.id?updated:x));
            recordActivity(currentUser, "Edited bill", `Jobber ${j?.name||""}`, `Bill ${updated.billNo}`);
            showToast("Bill updated ✓");
            setEditBill(null);
          }} />}
          {showBillForm && <BillForm jobber={j} designs={designs} selJ={selJ} suggestForDesign={suggestForDesign} challans={(challans||[]).filter(c => c.jobberId===selJ && c.status==="approved" && !c.billed && !c.halfStitch)} onClose={() => setShowBillForm(false)} onSave={async (bill, usedChallanIds) => {
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
          {editPay && <EditPaymentModal pay={editPay} onClose={()=>setEditPay(null)} onSave={saveEditedPay} />}
          {showCNForm && <CreditNoteForm partyType="jobber" partyLabel={j?.name||""} partyId={selJ} designs={designs} creditNotes={creditNotes} challans={challans} bills={bills} currentUser={currentUser} onClose={()=>setShowCNForm(false)} onSave={async (cn) => {
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
function CreditNoteForm({ partyType, partyLabel, partyId, designs, onClose, onSave, currentUser, creditNotes = [], challans = [], bills = [] }) {
  const [cnDate, setCnDate] = useState(new Date().toISOString().slice(0,10));

  // ── financial year of a date (Apr–Mar). 2026-07-05 -> "2627"
  function fyOf(dateStr) {
    const d = dateStr ? new Date(dateStr) : new Date();
    if (isNaN(d)) return "";
    const y = d.getFullYear(), m = d.getMonth() + 1;   // Apr = 4
    const start = m >= 4 ? y : y - 1;
    return String(start % 100).padStart(2,"0") + String((start + 1) % 100).padStart(2,"0");
  }
  // ── next CN no for this FY: shared across ALL suppliers/jobbers, restarts each year
  function nextCnNo(dateStr) {
    const fy = fyOf(dateStr);
    let max = 0;
    (creditNotes||[]).forEach(c => {
      if (fyOf(c.cnDate) !== fy) return;
      const n = parseInt(String(c.cnNo||"").replace(/\D/g,""), 10);
      if (!isNaN(n) && n > max) max = n;
    });
    return `CN/${fy}/${String(max + 1).padStart(3,"0")}`;
  }
  const [cnNo, setCnNo] = useState("");   // manual — Tally ka CN number daalo (XML mismatch na ho)
  const suggestedCn = nextCnNo(cnDate);

  // ── only designs linked to THIS party (supplier: via fabric bills · jobber: via challans/bills)
  const partyDesigns = (designs||[]).filter(d => {
    const dn = String(d.designNo||"").trim();
    if (!dn) return false;
    if (partyType === "supplier") {
      return (d.supplierBills||[]).some(b => (b.supplier||"").trim().toLowerCase() === String(partyLabel||"").trim().toLowerCase());
    }
    // jobber: design me is jobber ka process assign ho, ya challan/bill me aaya ho (IDs se match)
    if (!partyId) return false;
    const inProcess = Object.values(d.processes||{}).some(p => p && p.jobber === partyId);
    const inChallan = (challans||[]).some(c => c.jobberId===partyId && (c.lines||[]).some(l => String(l.designNo).trim() === dn));
    const inBill    = (bills||[]).some(b => b.jobberId===partyId && (b.lines||[]).some(l => String(l.designNo).trim() === dn));
    return inProcess || inChallan || inBill;
  });
  const designOptions = partyDesigns.map(d => d.designNo);

  const [reason, setReason] = useState("");
  const [lines, setLines] = useState([{ id:`L${Date.now()}`, designNo:"", billNo:"", qty:"", rate:"", amount:"" }]);
  const REASONS = ["Damage claim","Rate difference","Short supply","Quality issue","Goods returned","Other"];
  function addLine() { setLines(l => [...l, { id:`L${Date.now()}`, designNo:"", billNo:"", qty:"", rate:"", amount:"" }]); }
  function removeLine(id) { setLines(l => l.length>1 ? l.filter(x=>x.id!==id) : l); }
  // design ke liye is party ka bill no dhundo (supplier: fabric bill · jobber: jobber bill)
  function billNoFor(designNo) {
    const dn = String(designNo||"").trim();
    if (!dn) return "";
    if (partyType === "supplier") {
      const d = (designs||[]).find(x => String(x.designNo).trim() === dn);
      const b = (d?.supplierBills||[]).find(b => (b.supplier||"").trim().toLowerCase() === String(partyLabel||"").trim().toLowerCase() && b.billNo);
      return b ? b.billNo : "";
    }
    const jb = (bills||[]).filter(b => b.jobberId===partyId && (b.lines||[]).some(l => String(l.designNo).trim() === dn) && b.billNo);
    return jb.length ? jb[jb.length-1].billNo : "";
  }
  function updLine(id,k,v) { setLines(l => l.map(x => { if(x.id!==id) return x; const nx={...x,[k]:v}; const q=+nx.qty||0,r=+nx.rate||0; if(k==="qty"||k==="rate") nx.amount=(q*r)?String(q*r):nx.amount; if(k==="designNo"){ const bn=billNoFor(v); if(bn) nx.billNo=bn; } return nx; })); }
  const total = lines.reduce((a,l)=>a+(+l.amount||0),0);
  const valid = lines.filter(l => l.designNo && l.amount);
  function save() {
    if (!cnNo || valid.length===0) return;
    onSave({ cnNo, cnDate, reason, lines: valid.map(l=>({ designNo:String(l.designNo).trim(), billNo:String(l.billNo||"").trim(), qty:+l.qty||0, rate:+l.rate||0, amount:+l.amount||0 })), total, createdBy:currentUser });
  }
  return (
    <Modal title={`New Credit Note — ${partyLabel}`} onClose={onClose}>
      <div style={{ background:T.red+"15", border:`1px solid ${T.red}55`, borderRadius:8, padding:10, marginBottom:14, fontFamily:T.mono, fontSize:11, color:T.red }}>A credit note REDUCES what you owe {partyLabel} (claim/deduction). It shows on the credit side of their ledger.</div>
      <div style={{ display:"flex", gap:12, marginBottom:14, flexWrap:"wrap" }}>
        <div style={{ display:"flex", flexDirection:"column", gap:4, minWidth:190 }}>
          <label style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, textTransform:"uppercase", letterSpacing:0.8 }}>Credit Note No * (Tally se)</label>
          <input value={cnNo} onChange={e=>setCnNo(e.target.value)} placeholder="Tally ka CN number" style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:6, color:T.text, fontFamily:T.sans, fontSize:13, padding:"8px 12px", width:"100%", outline:"none", boxSizing:"border-box" }} />
          <span style={{ fontFamily:T.mono, fontSize:9, color:T.steelLt }}>suggestion: {suggestedCn} <span onClick={()=>setCnNo(suggestedCn)} style={{ color:T.gold, cursor:"pointer", textDecoration:"underline" }}>use</span></span>
        </div>
        <Inp label="Date" type="date" value={cnDate} onChange={setCnDate} style={{ minWidth:150 }} />
        <Inp label="Reason *" value={reason} onChange={setReason} options={REASONS} style={{ minWidth:160 }} />
      </div>
      <div style={{ fontFamily:T.mono, fontSize:10, color:T.gold, textTransform:"uppercase", marginBottom:8 }}>Designs / amounts in this credit note — sirf {partyLabel} ke designs</div>
      {designOptions.length===0 && <div style={{ fontFamily:T.mono, fontSize:11, color:T.orange, marginBottom:8 }}>⚠ Is party se juda koi design nahi mila.</div>}
      {lines.map(l => (
        <div key={l.id} style={{ display:"flex", gap:8, marginBottom:8, alignItems:"flex-end", flexWrap:"wrap" }}>
          <div style={{ display:"flex", flexDirection:"column", gap:4, flex:2, minWidth:120 }}>
            <label style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, textTransform:"uppercase", letterSpacing:0.8 }}>Design No (type/select)</label>
            <input value={l.designNo} onChange={e=>updLine(l.id,"designNo",e.target.value)} list={`cn-designs-${l.id}`} placeholder="design no type karo…" style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:6, color:T.text, fontFamily:T.sans, fontSize:13, padding:"8px 12px", width:"100%", outline:"none", boxSizing:"border-box" }} />
            <datalist id={`cn-designs-${l.id}`}>{designOptions.map(dn => <option key={dn} value={dn} />)}</datalist>
          </div>
          <Inp label="Against Bill No (auto)" value={l.billNo} onChange={v=>updLine(l.id,"billNo",v)} style={{ width:130 }} placeholder="bill no" />
          <Inp label="Meter Qty" type="number" value={l.qty} onChange={v=>updLine(l.id,"qty",v)} style={{ width:90 }} placeholder="optional" />
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
  // auto-match GST% to selected challans' GST (so bill tallies with challan)
  useEffect(() => {
    const selCh = challans.filter(c => selChallans.includes(c.id));
    const withGst = selCh.find(c => +c.gstPct>0);
    if (withGst) { setGstPct(String(withGst.gstPct)); setHasGst(true); }
  }, [selChallans]);

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
function EditPaymentModal({ pay, onClose, onSave }) {
  const [amount, setAmount] = useState(String(pay.amount||""));
  const [date, setDate] = useState(pay.date||"");
  const [mode, setMode] = useState(pay.mode||"");
  const [channel, setChannel] = useState(pay.channel||"bank");
  const [note, setNote] = useState(pay.note||"");
  return (
    <Modal title="Edit Payment" onClose={onClose}>
      {pay.confirmed && <div style={{ background:T.orange+"22", border:`1px solid ${T.orange}`, borderRadius:6, padding:"8px 12px", marginBottom:12, fontFamily:T.mono, fontSize:10, color:T.orange }}>⚠ This payment was confirmed by the jobber. Editing it will change the confirmed record.</div>}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:14 }}>
        <Inp label="Amount" type="number" value={amount} onChange={setAmount} />
        <Inp label="Date" type="date" value={date} onChange={setDate} />
        <Inp label="Mode" value={mode} onChange={setMode} placeholder="e.g. UPI, Cheque" />
        <Inp label="Channel" value={channel} onChange={setChannel} options={["bank","cash"]} />
        <div style={{ gridColumn:"1 / -1" }}><Inp label="Note" value={note} onChange={setNote} /></div>
      </div>
      <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
        <Btn label="Cancel" onClick={onClose} color={T.surface} textColor={T.steelLt} />
        <Btn label="Save Changes" onClick={()=>onSave({ ...pay, amount:+amount||0, date, mode, channel, note })} disabled={!amount} color={T.gold} textColor={T.bg} />
      </div>
    </Modal>
  );
}

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
function JobberPanel({ user, designs, setDesigns, people, challans, setChallans, payments, setPayments, bills, setBills, notifications, setNotifications, locks, setLocks, onLogout }) {
  const [sel, setSel] = useState(null);
  const [showChallan, setShowChallan] = useState(false);
  const [showLedger, setShowLedger] = useState(false);
  const [showSubmitBill, setShowSubmitBill] = useState(false);
  const [showNewDesign, setShowNewDesign] = useState(false);
  const [editChallan, setEditChallan] = useState(null);
  const isStitcher = jobberDoesProcess(user, "Stitch")
    || (user.process||"").toLowerCase().includes("stitch")
    || (user.processCodes||[]).some(x => (x.process||"").toLowerCase().includes("stitch"));
  const [lang, setLang] = useState("en");
  const L = makeL(lang);
  const [toast, setToast] = useState({ msg:"", type:"" });
  function showToast(msg, type="success") { setToast({msg,type}); setTimeout(() => setToast({msg:"",type:""}), 3000); }
  const myDesigns = designs.filter(d =>
    PROCESSES.some(p => d.processes?.[p]?.jobber===user.id) ||
    (d.movements||[]).some(m => m.sentToId===user.id) ||
    (challans||[]).some(c => c.status!=="rejected" && challanDesigns(c).includes(String(d.designNo)) && (
      c.jobberId===user.id ||
      c.sendToId===user.id ||
      (c.lines||[]).some(l => l.sentToId===user.id)
    ))
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
          <DesignDetail design={sel} jobbers={people} onBack={() => setSel(null)} onUpdate={updateDesign} showToast={showToast} role="jobber" currentUser={user.name} currentJobber={user} L={L} onSendLot={sendLot} people={people} challans={challans} locks={locks} setLocks={setLocks} />
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
          <NotificationBell notifications={notifications} currentUser={user.name} userId={user.id} onOpenDesign={(n)=>{ const d=n.designId?designs.find(x=>x.id===n.designId):null; if(d) setSel(d); }} onMarkRead={async (n)=>{ setNotifications(p=>p.filter(x=>x.id!==n.id)); await dbDelete("notifications", n.id); }} />
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
          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            <Btn label="🔄 Refresh" onClick={() => window.location.reload()} color={T.surface} textColor={T.steelLt} style={{ border:`1px solid ${T.border}` }} />
            {isStitcher && <Btn label="+ New Design" onClick={() => setShowNewDesign(true)} color={T.surface} textColor={T.accent} style={{ border:`1px solid ${T.accent}66` }} />}
            <Btn label="📒 My Account" onClick={() => setShowLedger(true)} color={T.surface} textColor={T.gold} style={{ border:`1px solid ${T.border}` }} />
            <Btn label="🧾 Submit Bill" onClick={() => setShowSubmitBill(true)} color={T.surface} textColor={T.green} style={{ border:`1px solid ${T.border}` }} />
            <Btn label="+ New Challan" onClick={() => setShowChallan(true)} />
          </div>
        </div>
        {/* Payments awaiting this jobber's confirmation */}
        {(() => {
          const myPending = (payments||[]).filter(p => p.jobberId===user.id && !p.confirmed);
          if (myPending.length===0) return null;
          async function confirmPayment(pay) {
            if (!window.confirm(`Confirm you received Rs.${pay.amount} on ${pay.date}?\n\nOnce confirmed you CANNOT change it. Only admin can change later.`)) return;
            if (!window.confirm(`Please confirm again: you received Rs.${pay.amount}. Mark as OK?`)) return;
            const updated = { ...pay, confirmed:true, confirmText:"OK", confirmDate:new Date().toISOString().slice(0,10) };
            await dbUpsert("payments", payToRow(updated));
            setPayments(p => p.map(x => x.id===pay.id?updated:x));
            recordActivity(user.name, "Confirmed payment received", `Jobber ${user.name}`, `Rs.${pay.amount} on ${updated.confirmDate}`);
            showToast("Payment confirmed ✓");
          }
          return (
            <div style={{ background:T.card, borderRadius:10, border:`1px solid ${T.orange}`, padding:14, marginBottom:16 }}>
              <div style={{ fontFamily:T.mono, fontSize:10, color:T.orange, textTransform:"uppercase", marginBottom:10, fontWeight:700 }}>⚠ Payments to Confirm — tick when you receive your money</div>
              {myPending.map(pay => (
                <div key={pay.id} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 0", borderBottom:`1px solid ${T.border}`, flexWrap:"wrap" }}>
                  <div style={{ flex:"1 1 160px" }}>
                    <div style={{ fontFamily:T.mono, fontSize:15, fontWeight:900, color:T.green }}>Rs.{pay.amount}</div>
                    <div style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt }}>Paid on {pay.date||"—"} · {pay.channel||"bank"}{pay.note?` · ${pay.note}`:""}</div>
                  </div>
                  <button onClick={()=>confirmPayment(pay)} style={{ display:"flex", alignItems:"center", gap:8, background:T.green, color:"#fff", border:"none", borderRadius:8, padding:"10px 16px", cursor:"pointer", fontFamily:T.mono, fontSize:13, fontWeight:700 }}>
                    <span style={{ width:18, height:18, border:"2px solid #fff", borderRadius:4, display:"inline-block" }}></span>
                    Tick &amp; write OK
                  </button>
                </div>
              ))}
              <div style={{ fontFamily:T.mono, fontSize:9, color:T.textDim, marginTop:8 }}>After you confirm, it moves to your ledger. You cannot change it — only admin can.</div>
            </div>
          );
        })()}
        {(challans||[]).filter(c => c.jobberId===user.id).length > 0 && (
          <div style={{ background:T.card, borderRadius:10, border:`1px solid ${T.border}`, padding:14, marginBottom:16 }}>
            <div style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, textTransform:"uppercase", marginBottom:8 }}>Your Challans</div>
            {(challans||[]).filter(c => c.jobberId===user.id).slice(0,10).map(c => (
              <div key={c.id} style={{ display:"flex", gap:10, alignItems:"center", padding:"6px 0", fontSize:12, borderBottom:`1px solid ${T.border}`, flexWrap:"wrap" }}>
                <span style={{ fontFamily:T.mono, color:T.steelLt }}>{c.date}</span>
                <span style={{ color:T.gold, fontFamily:T.mono }}>D{c.designNo}</span>
                <span style={{ color:T.text }}>{c.qty} pcs</span>
                <span style={{ marginLeft:"auto", display:"flex", gap:6, alignItems:"center" }}>
                  <Badge label={c.status} color={c.status==="approved"?T.green:c.status==="rejected"?T.red:T.orange} />
                  {c.billed
                    ? <span style={{ fontFamily:T.mono, fontSize:9, color:T.steelLt }}>billed</span>
                    : c.editApproved
                      ? <Btn label="Edit now" small color={T.gold} textColor={T.bg} onClick={()=>setEditChallan(c)} />
                      : c.editReqPending
                        ? <span style={{ fontFamily:T.mono, fontSize:9, color:T.orange }}>edit requested…</span>
                        : c.editedOnce
                          ? <span style={{ fontFamily:T.mono, fontSize:9, color:T.green }}>✓ edited</span>
                          : <Btn label="Request edit" small color={T.surface} textColor={T.accent} style={{ border:`1px solid ${T.accent}55` }} onClick={async()=>{
                            const u = { ...c, editReqPending:true };
                            await dbUpsert("challans", challanToRow(u));
                            setChallans(p=>p.map(x=>x.id===c.id?u:x));
                            recordNotification(user.name, `${user.name} requests to edit challan ${c.challanNo||("D"+c.designNo)} (${c.qty} pcs)`, "");
                            showToast("Edit request sent to admin");
                          }} />}
                </span>
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
            const fd = (c.newDesignData||{})[dn];
            if (fd) {
              if (fd.supplier) nd.supplier = fd.supplier;
              const fcols = (fd.colors||[]);
              if (fcols.length) {
                nd.colors = fcols.map((col,i)=>({ id:col.id||`C${Date.now()}_${i}`, colorName:(col.name||"").trim(), colorNo:"", name:(col.name||"").trim(), sleeve:"", meters:String(col.meters||""), metersHalf:"", sizes:{}, sizesHalf:{}, samples:{}, sampleFabric:[], balance:"", shrinkage:"", sampleShrinkage:"", swatch:col.swatch||"" }));
              }
            }
            await dbUpsert("designs", dToRow(nd));
            setDesigns(p => [nd, ...p]);
            recordNotification(user.name, `New placeholder design ${dn} created via challan by ${user.name} — complete its details`, nd.id);
          }
        }
        await dbUpsert("challans", challanToRow(c));
        setChallans(p => [c,...p]);
        {
          for (const ln of (c.lines||[])) {
            const dn = String(ln.designNo);
            const lineSendTo = ln.sentToId || c.sendToId;
            if (!lineSendTo) continue;
            const targetName = lineSendTo==="__office__" ? "Office / Admin" : ((people.find(j=>j.id===lineSendTo)||{}).name||"");
            const design = designs.find(d => String(d.designNo)===dn);
            if (!design) continue;
            const lineQty = +ln.qty||0;
            const mv = { id:`MV${Date.now()}_${dn}_${Math.floor(Math.random()*1000)}`, date:ln.sentDate||c.date||new Date().toISOString().slice(0,10), receivedDate:ln.receivedDate||"", sentDate:ln.sentDate||c.date||"", jobber:user.name, receivedFrom:ln.receivedFrom||user.name, sentTo:targetName, sentToId:lineSendTo==="__office__"?"":lineSendTo, qty:lineQty, remark:`Challan ${c.challanNo||""}${ln.process?" · "+ln.process:""}${ln.halfStitch?" (Half Stitch)":""}`, halfStitch:!!ln.halfStitch, status:"sent" };
            const updated = { ...design, movements:[...(design.movements||[]), mv] };
            setDesigns(p => p.map(x => x.id===updated.id?updated:x));
            await dbUpsert("movements", mvToRow(mv, design.id));
            if (lineSendTo && lineSendTo!=="__office__") {
              recordNotification(user.name, `${user.name} sent you Design ${dn}${ln.process?` for ${ln.process}`:""} — ${lineQty} pcs`, design.id, lineSendTo);
            }
          }
        }
        recordNotification(user.name, `New challan by ${user.name} — designs ${challanDesigns(c).join(", ")} (${challanQty(c)} pcs)`, "");
        showToast("Challan saved ✓");
        setShowChallan(false);
      }} />}
      {showLedger && <JobberLedgerModal user={user} challans={challans} payments={payments} bills={bills} onClose={()=>setShowLedger(false)} />}
      {showSubmitBill && <JobberSubmitBillModal user={user} challans={challans} currentUser={user.name} onClose={()=>setShowSubmitBill(false)} onSubmit={async (bill, usedChallanIds) => {
        await dbUpsert("bills", billToRow(bill));
        // mark used challans as billed so neither jobber nor admin can re-bill them
        for (const cid of (usedChallanIds||[])) {
          const c = (challans||[]).find(x=>x.id===cid);
          if (c) { const u={...c, billed:true, billId:bill.id}; await dbUpsert("challans", challanToRow(u)); }
        }
        setChallans(p => p.map(c => (usedChallanIds||[]).includes(c.id) ? { ...c, billed:true, billId:bill.id } : c));
        recordNotification(user.name, `${user.name} submitted Bill ${bill.billNo} (Rs.${bill.total.toFixed(0)}) for approval`, "");
        showToast("Bill submitted for approval ✓");
        setShowSubmitBill(false);
      }} />}
      {showNewDesign && <JobberNewDesignModal user={user} designs={designs} currentUser={user.name} onClose={()=>setShowNewDesign(false)} onCreate={async (nd) => {
        await dbUpsert("designs", dToRow(nd));
        setDesigns(p => [nd, ...p]);
        recordNotification(user.name, `New design ${nd.designNo} created by ${user.name} (stitcher) — please complete details`, nd.id);
        showToast("Design created ✓ Admin can now complete it");
        setShowNewDesign(false);
      }} />}
      {editChallan && <JobberEditChallanModal challan={editChallan} onClose={()=>setEditChallan(null)} onSave={async (updated) => {
        const u = { ...updated, editApproved:false, editReqPending:false, editedOnce:true };
        await dbUpsert("challans", challanToRow(u));
        setChallans(p=>p.map(x=>x.id===u.id?u:x));
        showToast("Challan updated ✓");
        setEditChallan(null);
      }} />}
      <Toast {...toast} />
    </div>
  );
}

// ── Jobber edits own challan (qty/rate/date only, after admin approval) ────────
function JobberEditChallanModal({ challan, onClose, onSave }) {
  const [date, setDate] = useState(challan.date||"");
  const [lines, setLines] = useState((challan.lines && challan.lines.length ? challan.lines : [{ designNo:challan.designNo, process:challan.process, qty:challan.qty, rate:challan.rate, amount:challan.amount, halfStitch:challan.halfStitch }]).map(l=>({...l})));
  function updLine(i,k,v){ setLines(p => p.map((l,idx)=>{ if(idx!==i) return l; const nl={...l,[k]:v}; if(k==="qty"||k==="rate") nl.amount=(+nl.qty||0)*(+nl.rate||0); return nl; })); }
  function doSave(){
    const built = lines.map(l=>({ ...l, qty:+l.qty||0, rate:l.halfStitch?0:(+l.rate||0), amount:l.halfStitch?0:((+l.qty||0)*(+l.rate||0)) }));
    onSave({ ...challan, date, lines:built, qty:built.reduce((a,l)=>a+l.qty,0), amount:built.reduce((a,l)=>a+l.amount,0) });
  }
  return (
    <Modal title={`Edit Challan ${challan.challanNo||""} (qty / rate / date)`} onClose={onClose}>
      <div style={{ fontFamily:T.mono, fontSize:10, color:T.green, marginBottom:12 }}>✓ Admin approved this edit. You can change quantity, rate, and date only.</div>
      <Inp label="Date" type="date" value={date} onChange={setDate} style={{ marginBottom:14 }} />
      {lines.map((l,i)=>(
        <div key={i} style={{ display:"grid", gridTemplateColumns: l.halfStitch?"1fr 1fr 80px":"1fr 1fr 80px 80px 90px", gap:8, marginBottom:10, alignItems:"end", background:T.surface, padding:10, borderRadius:8 }}>
          <div><div style={{ fontFamily:T.mono, fontSize:9, color:T.steelLt }}>DESIGN</div><div style={{ fontFamily:T.mono, color:T.gold, fontWeight:700 }}>D{l.designNo}</div></div>
          <div><div style={{ fontFamily:T.mono, fontSize:9, color:T.steelLt }}>PROCESS</div><div style={{ fontSize:12 }}>{l.process}{l.halfStitch?" (Half)":""}</div></div>
          <Inp label="Qty" type="number" value={l.qty} onChange={v=>updLine(i,"qty",v)} />
          {!l.halfStitch && <Inp label="Rate" type="number" value={l.rate} onChange={v=>updLine(i,"rate",v)} />}
          {!l.halfStitch && <div><div style={{ fontFamily:T.mono, fontSize:9, color:T.steelLt }}>AMOUNT</div><div style={{ fontFamily:T.mono, color:T.gold, fontWeight:700, paddingTop:6 }}>Rs.{(+l.amount||0)}</div></div>}
        </div>
      ))}
      <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop:14 }}>
        <Btn label="Cancel" onClick={onClose} color={T.surface} textColor={T.steelLt} />
        <Btn label="Save Changes" onClick={doSave} color={T.gold} textColor={T.bg} />
      </div>
    </Modal>
  );
}

// ── Jobber (stitcher) creates a basic new design ──────────────────────────────
function JobberNewDesignModal({ user, designs, currentUser, onClose, onCreate }) {
  const [designNo, setDesignNo] = useState("");
  const [supplier, setSupplier] = useState("");
  const [colors, setColors] = useState([{ id:`C${Date.now()}`, name:"", meters:"", swatch:"" }]);
  const [saving, setSaving] = useState(false);
  const exists = designNo.trim() && designs.some(d => String(d.designNo)===String(designNo).trim());
  function updColor(id,k,v){ setColors(p=>p.map(c=>c.id===id?{...c,[k]:v}:c)); }
  function addColor(){ setColors(p=>[...p,{ id:`C${Date.now()}_${p.length}`, name:"", meters:"", swatch:"" }]); }
  function removeColor(id){ setColors(p=>p.length>1?p.filter(c=>c.id!==id):p); }
  function pickSwatch(id){ const inp=document.createElement("input"); inp.type="file"; inp.accept="image/*"; inp.capture="environment"; inp.onchange=(e)=>{ const f=(e.target.files||[])[0]; if(f) compressSwatch(f).then(src=>updColor(id,"swatch",src)).catch(()=>{}); }; inp.click(); }
  function create() {
    if (!designNo.trim() || exists || saving) return;
    setSaving(true);
    const base = makePlaceholderDesign({ designNo:designNo.trim(), createdBy:currentUser }, currentUser);
    // map each color row into a full design color (links to Color Swatches in design tab)
    const builtColors = colors.filter(c => c.name.trim() || c.meters || c.swatch).map((c,i) => ({
      id:c.id||`C${Date.now()}_${i}`, colorName:c.name.trim(), colorNo:"", name:c.name.trim(), sleeve:"",
      meters:String(c.meters||""), metersHalf:"", sizes:{}, sizesHalf:{}, samples:{}, sampleFabric:[],
      balance:"", shrinkage:"", sampleShrinkage:"", swatch:c.swatch||"",
    }));
    const nd = {
      ...base,
      supplier: supplier.trim(),
      colors: builtColors,
      // auto-assign the creating stitcher to the Stitch process so the design links to them
      processes: { ...(base.processes||{}), Stitch: { jobber: user.id, rate:"", code:"", recdDate:"", dlvdDate:"" }, _createdByJobberId: user.id },
      createdByJobberId: user.id,
      notes: `Created by stitcher ${currentUser}. Auto-assigned to ${currentUser} for Stitch. ${builtColors.length} colour swatch(es) + meters${supplier.trim()?` + supplier ${supplier.trim()}`:""} entered. Admin to complete details.`,
    };
    onCreate(nd);
  }
  return (
    <Modal title="+ New Design (stitcher)" onClose={onClose}>
      <div style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, marginBottom:14 }}>Enter the basics now — admin will fill the rest. Add each colour with its meters and a swatch photo.</div>
      <div style={{ marginBottom:14 }}>
        <Inp label="Design No *" value={designNo} onChange={setDesignNo} />
        {exists && <div style={{ fontFamily:T.mono, fontSize:10, color:T.red, marginTop:4 }}>⚠ Design {designNo} already exists — pick a different number.</div>}
      </div>
      <div style={{ marginBottom:14 }}>
        <Inp label="Fabric Supplier (name only)" value={supplier} onChange={setSupplier} />
      </div>
      <label style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, textTransform:"uppercase", display:"block", marginBottom:8 }}>Colour Swatches</label>
      {colors.map((c,i)=>(
        <div key={c.id} style={{ display:"flex", gap:10, alignItems:"flex-start", background:T.surface, borderRadius:8, padding:10, marginBottom:10 }}>
          <button onClick={()=>pickSwatch(c.id)} style={{ width:64, height:64, flexShrink:0, borderRadius:8, border:`2px dashed ${T.accent}66`, background:c.swatch?`url(${c.swatch}) center/cover`:T.bg, color:T.accent, fontSize:22, cursor:"pointer" }}>{c.swatch?"":"+"}</button>
          <div style={{ flex:1, display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
            <Inp label={`Colour ${i+1} name`} value={c.name} onChange={v=>updColor(c.id,"name",v)} />
            <Inp label="Meters" type="number" value={c.meters} onChange={v=>updColor(c.id,"meters",v)} />
          </div>
          {colors.length>1 && <button onClick={()=>removeColor(c.id)} style={{ background:T.red+"22", color:T.red, border:"none", borderRadius:6, padding:"6px 8px", cursor:"pointer", fontSize:11 }}>✕</button>}
        </div>
      ))}
      <Btn label="+ Add another colour" onClick={addColor} color={T.surface} textColor={T.accent} small style={{ border:`1px solid ${T.accent}55`, marginBottom:16 }} />
      <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
        <Btn label="Cancel" onClick={onClose} color={T.surface} textColor={T.steelLt} />
        <Btn label={saving?"Creating…":"Create Design"} onClick={create} disabled={!designNo.trim()||exists||saving} color={T.accent} textColor="#fff" />
      </div>
    </Modal>
  );
}

// ── Jobber Ledger (read-only account view) ────────────────────────────────────
function JobberLedgerModal({ user, challans, payments, bills = [], onClose }) {
  const [expandedBill, setExpandedBill] = useState("");
  // earned = full (non-half) challan amounts done by this jobber
  const myChallans = (challans||[]).filter(c => c.jobberId===user.id && c.status!=="rejected");
  const rows = [];
  myChallans.forEach(c => {
    const lns = (c.lines&&c.lines.length)?c.lines:[{designNo:c.designNo,process:c.process,qty:c.qty,amount:c.amount,halfStitch:c.halfStitch}];
    lns.forEach(l => {
      if (l.halfStitch) return; // half stitch = no money
      const amt = +l.amount||0;
      if (amt<=0) return;
      rows.push({ date:c.date, designNo:l.designNo, process:l.process, qty:l.qty, amount:amt });
    });
  });
  const earned = rows.reduce((a,r)=>a+r.amount,0);
  const myPayments = (payments||[]).filter(p => p.jobberId===user.id && p.confirmed);
  const received = myPayments.reduce((a,p)=>a+(+p.amount||0),0);
  const balance = earned - received;
  // bills for this jobber (entered by admin OR submitted by jobber) — both visible
  const myBills = (bills||[]).filter(b => b.jobberId===user.id);
  const approvedBills = myBills.filter(b => b.status!=="pending");
  const pendingBills = myBills.filter(b => b.status==="pending");
  return (
    <Modal title="📒 My Account" onClose={onClose}>
      <div style={{ display:"flex", gap:12, flexWrap:"wrap", marginBottom:16 }}>
        <div style={{ flex:1, minWidth:120, background:T.gold+"15", border:`1px solid ${T.gold}`, borderRadius:8, padding:12 }}>
          <div style={{ fontFamily:T.mono, fontSize:9, color:T.steelLt, textTransform:"uppercase" }}>Total Earned</div>
          <div style={{ fontFamily:T.mono, fontSize:20, fontWeight:900, color:T.gold }}>Rs.{earned.toFixed(0)}</div>
        </div>
        <div style={{ flex:1, minWidth:120, background:T.green+"15", border:`1px solid ${T.green}`, borderRadius:8, padding:12 }}>
          <div style={{ fontFamily:T.mono, fontSize:9, color:T.steelLt, textTransform:"uppercase" }}>Received</div>
          <div style={{ fontFamily:T.mono, fontSize:20, fontWeight:900, color:T.green }}>Rs.{received.toFixed(0)}</div>
        </div>
        <div style={{ flex:1, minWidth:120, background:T.red+"12", border:`1px solid ${T.red}`, borderRadius:8, padding:12 }}>
          <div style={{ fontFamily:T.mono, fontSize:9, color:T.steelLt, textTransform:"uppercase" }}>Balance (owed to you)</div>
          <div style={{ fontFamily:T.mono, fontSize:20, fontWeight:900, color:T.red }}>Rs.{balance.toFixed(0)}</div>
        </div>
      </div>
      <div style={{ fontFamily:T.mono, fontSize:10, color:T.gold, textTransform:"uppercase", marginBottom:8 }}>Work done (full-stitch / paid challans)</div>
      <div style={{ maxHeight:200, overflow:"auto", marginBottom:16 }}>
        {rows.length===0 ? <div style={{ fontFamily:T.mono, fontSize:11, color:T.steelLt }}>No paid work yet.</div> :
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11, fontFamily:T.mono }}>
            <thead><tr style={{ color:T.steelLt }}><td style={{ padding:"4px 6px" }}>Date</td><td>Design</td><td>Process</td><td>Qty</td><td style={{ textAlign:"right" }}>Amount</td></tr></thead>
            <tbody>{rows.map((r,i)=>(<tr key={i} style={{ borderTop:`1px solid ${T.border}` }}><td style={{ padding:"4px 6px" }}>{r.date}</td><td style={{ color:T.gold }}>D{r.designNo}</td><td>{r.process}</td><td>{r.qty}</td><td style={{ textAlign:"right", fontWeight:700 }}>Rs.{r.amount}</td></tr>))}</tbody>
          </table>}
      </div>
      <div style={{ fontFamily:T.mono, fontSize:10, color:T.accent, textTransform:"uppercase", marginBottom:8 }}>Bills</div>
      <div style={{ maxHeight:140, overflow:"auto", marginBottom:16 }}>
        {myBills.length===0 ? <div style={{ fontFamily:T.mono, fontSize:11, color:T.steelLt }}>No bills yet.</div> :
          myBills.map((b,i)=>{
            const open = expandedBill===b.id;
            const groups = {};
            (b.lines||[]).forEach(l => { const k=l.challanNo||"—"; if(!groups[k]) groups[k]={challanNo:k,date:l.date||"",rows:[]}; if(!groups[k].date&&l.date) groups[k].date=l.date; groups[k].rows.push(l); });
            return (
            <div key={i} style={{ borderTop:`1px solid ${T.border}` }}>
              <div onClick={()=>setExpandedBill(open?"":b.id)} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:8, padding:"6px 0", fontFamily:T.mono, fontSize:11, flexWrap:"wrap", cursor:"pointer" }}>
                <span style={{ color:T.gold, textDecoration:"underline" }}>{open?"▾":"▸"} Bill {b.billNo} · {b.billDate}</span>
                <span style={{ display:"flex", gap:8, alignItems:"center" }}>
                  <Badge label={b.status==="pending"?"awaiting approval":"approved"} color={b.status==="pending"?T.orange:T.green} />
                  <b style={{ color:T.gold }}>Rs.{(+b.total||0).toFixed(0)}</b>
                </span>
              </div>
              {open && <div style={{ background:T.surface, borderRadius:6, padding:8, marginBottom:6 }}>
                {Object.values(groups).map((g,gi)=>{
                  const sub=g.rows.reduce((a,l)=>a+(+l.amount||0),0);
                  return (
                  <div key={gi} style={{ marginBottom:6 }}>
                    <div style={{ fontFamily:T.mono, fontSize:10, color:T.accent, fontWeight:700 }}>Challan {g.challanNo} · {g.date}</div>
                    {g.rows.map((l,ri)=>(
                      <div key={ri} style={{ display:"flex", gap:8, fontFamily:T.mono, fontSize:10, color:T.text, padding:"2px 0" }}>
                        <span style={{ color:T.gold, minWidth:50 }}>D{l.designNo}</span>
                        <span style={{ color:T.steelLt, flex:1 }}>{l.process||"—"}</span>
                        <span>{l.qty} pcs</span>
                        <span>Rs.{l.rate}</span>
                        <span style={{ fontWeight:700, minWidth:60, textAlign:"right" }}>Rs.{(+l.amount||0).toFixed(0)}</span>
                      </div>
                    ))}
                    <div style={{ fontFamily:T.mono, fontSize:9, color:T.green, textAlign:"right" }}>Subtotal Rs.{sub.toFixed(0)}</div>
                  </div>
                  );
                })}
              </div>}
            </div>
          );})}
      </div>
      <div style={{ fontFamily:T.mono, fontSize:10, color:T.green, textTransform:"uppercase", marginBottom:8 }}>Payments received</div>
      <div style={{ maxHeight:140, overflow:"auto" }}>
        {myPayments.length===0 ? <div style={{ fontFamily:T.mono, fontSize:11, color:T.steelLt }}>No payments received yet.</div> :
          myPayments.map((p,i)=>(<div key={i} style={{ display:"flex", justifyContent:"space-between", padding:"5px 0", borderTop:`1px solid ${T.border}`, fontFamily:T.mono, fontSize:11 }}><span style={{ color:T.steelLt }}>{p.date}{p.note?` · ${p.note}`:""}</span><span style={{ fontWeight:700, color:T.green }}>Rs.{p.amount}</span></div>))}
      </div>
      <div style={{ fontFamily:T.mono, fontSize:9, color:T.textDim, marginTop:12 }}>This is a read-only view of your account. Half-stitch work is not counted (movement only).</div>
    </Modal>
  );
}

// ── Jobber Submit Bill (for admin approval) ───────────────────────────────────
function JobberSubmitBillModal({ user, challans, currentUser, onClose, onSubmit }) {
  const [billNo, setBillNo] = useState("");
  const [billDate, setBillDate] = useState(new Date().toISOString().slice(0,10));
  const [hasGst, setHasGst] = useState(false);
  const [gstPct, setGstPct] = useState("5");
  const [sel, setSel] = useState([]);
  const [saving, setSaving] = useState(false);
  // unbilled, paid (non-half) challans by this jobber
  const billable = (challans||[]).filter(c => c.jobberId===user.id && c.status!=="rejected" && !c.billed && challanTotal(c)>0);
  function toggle(id){ setSel(s => s.includes(id)?s.filter(x=>x!==id):[...s,id]); }
  const selChallans = billable.filter(c => sel.includes(c.id));
  const gross = selChallans.reduce((a,c)=>a+challanTotal(c),0);
  const gstAmt = hasGst ? gross*(+gstPct||0)/100 : 0;
  const total = gross + gstAmt;
  function submit(){
    if (!billNo || sel.length===0 || saving) return;
    setSaving(true);
    const lines = selChallans.flatMap(c => ((c.lines&&c.lines.length)?c.lines:[{designNo:c.designNo,process:c.process,qty:c.qty,rate:c.rate,amount:c.amount}]).filter(l=>!l.halfStitch).map(l=>({ ...l, challanNo:c.challanNo, date:c.date })));
    onSubmit({ id:`BILL${Date.now()}`, jobberId:user.id, billNo, billDate, lines, gross, gstPct:+gstPct, gstAmt, roundOff:0, total, hasGst, status:"pending", createdBy:currentUser, createdAtStr:nowStr() }, sel);
  }
  return (
    <Modal title="🧾 Submit Bill for Approval" onClose={onClose}>
      <div style={{ display:"flex", gap:12, marginBottom:14, flexWrap:"wrap" }}>
        <Inp label="Bill No *" value={billNo} onChange={setBillNo} style={{ minWidth:120 }} />
        <Inp label="Bill Date" type="date" value={billDate} onChange={setBillDate} style={{ minWidth:150 }} />
      </div>
      <div style={{ fontFamily:T.mono, fontSize:10, color:T.gold, textTransform:"uppercase", marginBottom:8 }}>Select your challans to bill ({billable.length} available)</div>
      <div style={{ maxHeight:200, overflow:"auto", marginBottom:14, border:`1px solid ${T.border}`, borderRadius:8, padding:8 }}>
        {billable.length===0 ? <div style={{ fontFamily:T.mono, fontSize:11, color:T.steelLt }}>No unbilled paid challans.</div> :
          billable.map(c => (
            <label key={c.id} style={{ display:"flex", alignItems:"center", gap:8, padding:"5px 0", cursor:"pointer", fontSize:12 }}>
              <input type="checkbox" checked={sel.includes(c.id)} onChange={()=>toggle(c.id)} style={{ accentColor:T.gold, width:14, height:14 }} />
              <span style={{ fontFamily:T.mono, color:T.steelLt }}>{c.date}</span>
              <span style={{ fontFamily:T.mono, color:T.gold }}>D{challanDesigns(c).join(",")}</span>
              <span style={{ fontFamily:T.mono, marginLeft:"auto", fontWeight:700 }}>Rs.{challanTotal(c)}</span>
            </label>
          ))}
      </div>
      <label style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12, fontSize:12, fontFamily:T.mono, color:T.text }}>
        <input type="checkbox" checked={hasGst} onChange={e=>setHasGst(e.target.checked)} style={{ accentColor:T.gold }} /> Add GST
        {hasGst && <select value={gstPct} onChange={e=>setGstPct(e.target.value)} style={{ marginLeft:8, padding:"4px 8px", borderRadius:6, border:`1px solid ${T.border}`, fontFamily:T.mono }}><option value="5">5%</option><option value="12">12%</option><option value="18">18%</option></select>}
      </label>
      <div style={{ background:T.bg, borderRadius:8, padding:"10px 16px", marginBottom:14, fontFamily:T.mono, fontSize:13, textAlign:"right" }}>
        Gross Rs.{gross.toFixed(0)}{hasGst?` + GST Rs.${gstAmt.toFixed(0)}`:""} = <b style={{ color:T.gold, fontSize:16 }}>Rs.{total.toFixed(0)}</b>
      </div>
      <div style={{ fontFamily:T.mono, fontSize:9, color:T.orange, marginBottom:12 }}>This bill will be sent to admin for approval. It won't affect ledgers until admin approves.</div>
      <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
        <Btn label="Cancel" onClick={onClose} color={T.surface} textColor={T.steelLt} />
        <Btn label={saving?"Submitting…":"Submit for Approval"} onClick={submit} disabled={!billNo||sel.length===0||saving} color={T.green} textColor="#fff" />
      </div>
    </Modal>
  );
}

// ── Notification Bell ─────────────────────────────────────────────────────────
function NotificationBell({ notifications, currentUser, userId, onOpenDesign, onMarkRead }) {
  const [open, setOpen] = useState(false);
  // show notifications addressed to this user (forUser===userId) OR general ones (forUser blank)
  const visible = (notifications||[]).filter(n => !n.forUser || (userId && n.forUser===userId));
  const unread = visible.filter(n => !(n.readBy||[]).includes(currentUser));
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
            {visible.length === 0 && <div style={{ padding:24, textAlign:"center", color:T.textDim, fontFamily:T.mono, fontSize:12 }}>No notifications yet.</div>}
            {visible.slice(0,40).map(n => {
              const isUnread = !(n.readBy||[]).includes(currentUser);
              return (
                <div key={n.id} onClick={() => { onOpenDesign(n); onMarkRead(n); setOpen(false); }} style={{ padding:"12px 16px", borderBottom:`1px solid ${T.border}`, cursor:"pointer", background:isUnread?T.surface:"transparent", display:"flex", gap:8, alignItems:"flex-start" }}>
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
    ["Fabric Stock", "Bought vs cut per design", "Fabric Stock", T.green],
    ["Barcode", "Barcodes & piece stock", "Barcode", T.gold],
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
function TallyExportModal({ designs, onClose, onExport }) {
  const today = new Date().toISOString().slice(0,10);
  const [range, setRange] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [includeExported, setIncludeExported] = useState(false);

  // compute effective dates
  function effectiveDates() {
    const now = new Date();
    if (range==="today") return { from:today, to:today };
    if (range==="week") { const d=new Date(now); d.setDate(d.getDate()-7); return { from:d.toISOString().slice(0,10), to:today }; }
    if (range==="month") { const d=new Date(now.getFullYear(), now.getMonth(), 1); return { from:d.toISOString().slice(0,10), to:today }; }
    if (range==="custom") return { from:fromDate, to:toDate };
    return { from:"", to:"" }; // all
  }
  const { from, to } = effectiveDates();

  // count matching bills
  let total=0, notExported=0, alreadyExported=0;
  designs.forEach(dn => (dn.supplierBills||[]).forEach(b => {
    if (!(b.supplier && b.supplier.trim() && (+b.amount||0)>0)) return;
    const bd = b.billDate||"";
    if (from && bd < from) return;
    if (to && bd > to) return;
    total++;
    if (b.tallyExported) alreadyExported++; else notExported++;
  }));
  const willExport = includeExported ? total : notExported;

  return (
    <Modal title="Export Purchase Vouchers to Tally" onClose={onClose}>
      <div style={{ fontFamily:T.mono, fontSize:10, color:T.textDim, marginBottom:14 }}>Choose which fabric/trims bills to send to Tally Prime. Already-exported bills are skipped unless you tick the box below.</div>

      <label style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, textTransform:"uppercase", display:"block", marginBottom:6 }}>Date Range</label>
      <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:12 }}>
        {[["all","All"],["today","Today"],["week","Last 7 days"],["month","This month"],["custom","Custom"]].map(([v,lbl]) => (
          <button key={v} onClick={()=>setRange(v)} style={{ background:range===v?T.gold:T.surface, color:range===v?T.bg:T.steelLt, border:`1px solid ${T.border}`, borderRadius:16, padding:"6px 14px", fontFamily:T.mono, fontSize:11, fontWeight:700, cursor:"pointer" }}>{lbl}</button>
        ))}
      </div>
      {range==="custom" && (
        <div style={{ display:"flex", gap:12, marginBottom:12 }}>
          <Inp label="From" type="date" value={fromDate} onChange={setFromDate} />
          <Inp label="To" type="date" value={toDate} onChange={setToDate} />
        </div>
      )}

      <label style={{ display:"flex", alignItems:"center", gap:10, cursor:"pointer", marginBottom:14, background:T.surface, padding:"10px 12px", borderRadius:8, border:`1px solid ${T.border}` }}>
        <input type="checkbox" checked={includeExported} onChange={e=>setIncludeExported(e.target.checked)} style={{ width:18, height:18 }} />
        <span style={{ fontSize:12, color:T.text }}>Re-export bills already sent to Tally <span style={{ color:T.textDim }}>(admin — use only if you need to import again)</span></span>
      </label>

      <div style={{ background:T.bg, borderRadius:8, padding:14, marginBottom:16, border:`1px solid ${T.border}` }}>
        <div style={{ fontFamily:T.mono, fontSize:12, color:T.text }}>Bills in range: <b style={{color:T.gold}}>{total}</b></div>
        <div style={{ fontFamily:T.mono, fontSize:11, color:T.steelLt, marginTop:4 }}>Not yet exported: <b style={{color:T.green}}>{notExported}</b> · Already exported: <b style={{color:T.orange}}>{alreadyExported}</b></div>
        <div style={{ fontFamily:T.mono, fontSize:13, color:T.white, marginTop:8, fontWeight:700 }}>→ Will export now: <b style={{color:T.accent||T.gold}}>{willExport}</b> bill{willExport!==1?"s":""}</div>
      </div>

      <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
        <Btn label="Cancel" onClick={onClose} color={T.surface} textColor={T.steelLt} />
        <Btn label="Download Tally XML" onClick={()=>{ onExport({ fromDate:from, toDate:to, includeExported }); onClose(); }} disabled={willExport===0} color={T.gold} textColor={T.bg} />
      </div>
    </Modal>
  );
}

function Workspace({ role, currentUser, designs, setDesigns, people, setPeople, bookings, setBookings, bills, setBills, payments, setPayments, activityLog, notifications, setNotifications, challans, setChallans, creditNotes, setCreditNotes, locks, setLocks, onLogout }) {
  const isAdmin = role === "admin";
  const [tab, setTab] = useState("Home");
  const [showCalc, setShowCalc] = useState(false);
  const [showTally, setShowTally] = useState(false);
  const [sel, setSel] = useState(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [toast, setToast] = useState({ msg:"", type:"" });
  const [search, setSearch] = useState("");
  const [jobberDesignTab, setJobberDesignTab] = useState("ongoing");
  const [showCompleted, setShowCompleted] = useState(false);
  const [monthFilter, setMonthFilter] = useState("");
  function showToast(msg, type="success") { setToast({msg,type}); setTimeout(() => setToast({msg:"",type:""}), 3000); }
  const jobbers = people.filter(p => p.role==="jobber");
  async function markNotifRead(n) {
    // once tapped, the notification disappears
    setNotifications(prev => prev.filter(x => x.id!==n.id));
    await dbDelete("notifications", n.id);
  }
  function openDesignById(id) {
    const d = designs.find(x => x.id===id);
    if (d) { setTab("Designs"); setSel(d); return; }
  }
  function openNotifTarget(n) {
    // route based on the notification content/target
    if (n.designId && designs.find(x=>x.id===n.designId)) { setTab("Designs"); setSel(designs.find(x=>x.id===n.designId)); return; }
    const msg = (n.message||"").toLowerCase();
    if (isAdmin && msg.includes("edit")) { setTab("Home"); return; }       // challan edit requests live on Home
    if (msg.includes("bill")) { setTab("Bills & Ledger"); return; }
    if (msg.includes("challan")) { setTab("Challans"); return; }
    if (msg.includes("design")) { setTab("Designs"); return; }
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

  const TABS = isAdmin ? ["Home","Designs","Bookings","Samples","Challans","People","Bills & Ledger","Fabric Purchases","Fabric Suppliers","Fabric Stock","Barcode","Activity Log","Search"] : ["Home","Designs","Bookings","Challans","Search"];

  function exportBackup() {
    const backup = {
      exportedAt: new Date().toISOString(),
      exportedBy: currentUser,
      app: "Aashish Apparels ERP",
      designs, people, bookings, bills, payments, challans, creditNotes, notifications, activityLog,
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type:"application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0,16).replace(/[:T]/g,"-");
    a.href = url; a.download = `aashish-erp-backup-${stamp}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("Backup downloaded ✓");
  }

  const restoreRef = useRef();
  async function handleRestoreFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (!window.confirm("Restore from this backup? This will REPLACE all current data in the app with the backup's data.\n\nMake sure this is the backup you want.")) { e.target.value=""; return; }
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.designs && !data.bills && !data.challans) { showToast("Not a valid backup file", "error"); e.target.value=""; return; }
      // write everything back to the database, then update screen
      const sets = [
        ["designs", data.designs||[], dToRow, setDesigns],
        ["jobbers", data.people||[], jToRow, setPeople],
        ["bookings", data.bookings||[], bToRow, setBookings],
        ["bills", data.bills||[], billToRow, setBills],
        ["payments", data.payments||[], payToRow, setPayments],
        ["challans", data.challans||[], challanToRow, setChallans],
        ["credit_notes", data.creditNotes||[], cnToRow, setCreditNotes],
      ];
      let count = 0;
      for (const [table, arr, conv, setter] of sets) {
        for (const item of arr) { try { await dbUpsert(table, conv(item)); count++; } catch(err){} }
        setter(arr);
      }
      recordActivity(currentUser, "Restored from backup", file.name, `${count} records`);
      showToast(`Restored ${count} records ✓`);
    } catch(err) {
      showToast("Could not read backup file", "error");
    }
    e.target.value="";
  }

  // estimate storage used (approx, based on data size; photos dominate)
  const storageBytes = (() => {
    try {
      const all = JSON.stringify({ designs, people, bookings, bills, payments, challans, creditNotes });
      // string length ~ bytes for base64 image data; good enough estimate
      return all.length;
    } catch { return 0; }
  })();
  const storageMB = storageBytes / (1024*1024);
  const storagePct = Math.min(100, (storageMB / 500) * 100); // 500 MB free tier

  // ── Tally Prime XML export (Purchase vouchers from fabric bills) ──
  function tallyEscape(s) {
    return String(s==null?"":s).replace(/&/g,"&amp;").replace(/'/g,"&apos;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }
  function tallyDate(d) { return (d||"").replace(/-/g,""); } // 2026-06-16 -> 20260616
  function exportTallyPurchase(opts = {}) {
    const { fromDate = "", toDate = "", includeExported = false } = opts;
    const COMPANY = "AASHISH APPARELS 2026-2027";
    // gather fabric bills with bill no + supplier + amount, applying date + exported filters
    const bills = [];
    designs.forEach(dn => (dn.supplierBills||[]).forEach(b => {
      if (!(b.supplier && b.supplier.trim() && (+b.amount||0)>0)) return;
      if (!includeExported && b.tallyExported) return;
      const bd = b.billDate||"";
      if (fromDate && bd < fromDate) return;
      if (toDate && bd > toDate) return;
      bills.push({ ...b, designNo:b.designNo||dn.designNo, _did:dn.id });
    }));
    if (bills.length===0) { showToast("No bills match (all exported or out of range)", "error"); return; }
    const vouchers = bills.map(b => {
      const party = tallyEscape(b.supplier.trim());
      const taxable = +b.amount||0;
      const gstRate = +b.gstRate||0;
      const gstType = b.gstType||"CGST+SGST";
      const gstAmt = taxable*gstRate/100;
      const partyTotal = taxable + gstAmt;
      const taxableStr = taxable.toFixed(2);
      const negTaxable = "-"+taxableStr;
      const qty = (+b.qty||0).toFixed(2);
      const rate = (+b.rate||0).toFixed(2);
      const billNo = tallyEscape(b.billNo||"");
      const dt = tallyDate(b.billDate);
      const narr = tallyEscape(b.transporter?`Transport: ${b.transporter}`:"Purchase via app");
      const stockItem = (b.billType==="Trims") ? "TRIMS" : "FABRIC";
      const unit = (b.billType==="Trims") ? "PCS" : "MTR";
      // GST ledger entries
      let gstLedgers = "";
      if (gstRate>0) {
        if (gstType==="IGST") {
          gstLedgers = `      <LEDGERENTRIES.LIST>
       <LEDGERNAME>INPUT IGST</LEDGERNAME>
       <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
       <ISPARTYLEDGER>No</ISPARTYLEDGER>
       <AMOUNT>${("-"+gstAmt.toFixed(2))}</AMOUNT>
      </LEDGERENTRIES.LIST>\n`;
        } else {
          const half = (gstAmt/2).toFixed(2);
          gstLedgers = `      <LEDGERENTRIES.LIST>
       <LEDGERNAME>INPUT CGST</LEDGERNAME>
       <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
       <ISPARTYLEDGER>No</ISPARTYLEDGER>
       <AMOUNT>${("-"+half)}</AMOUNT>
      </LEDGERENTRIES.LIST>
      <LEDGERENTRIES.LIST>
       <LEDGERNAME>INPUT SGST</LEDGERNAME>
       <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
       <ISPARTYLEDGER>No</ISPARTYLEDGER>
       <AMOUNT>${("-"+half)}</AMOUNT>
      </LEDGERENTRIES.LIST>\n`;
        }
      }
      const partyAmtStr = partyTotal.toFixed(2);
      return `    <TALLYMESSAGE xmlns:UDF="TallyUDF">
     <VOUCHER VCHTYPE="Purchase" ACTION="Create" OBJVIEW="Invoice Voucher View">
      <DATE>${dt}</DATE>
      <NARRATION>${narr}</NARRATION>
      <VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME>
      <PARTYLEDGERNAME>${party}</PARTYLEDGERNAME>
      <PARTYNAME>${party}</PARTYNAME>
      <VOUCHERNUMBER>${billNo}</VOUCHERNUMBER>
      <BASICBUYERNAME>${COMPANY}</BASICBUYERNAME>
      <PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW>
      <VCHENTRYMODE>Item Invoice</VCHENTRYMODE>
      <ISINVOICE>Yes</ISINVOICE>
      <ALLINVENTORYENTRIES.LIST>
       <STOCKITEMNAME>${stockItem}</STOCKITEMNAME>
       <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
       <RATE>${rate}/${unit}</RATE>
       <AMOUNT>${negTaxable}</AMOUNT>
       <ACTUALQTY> ${qty} ${unit}</ACTUALQTY>
       <BILLEDQTY> ${qty} ${unit}</BILLEDQTY>
       <BATCHALLOCATIONS.LIST>
        <GODOWNNAME>Main Location</GODOWNNAME>
        <BATCHNAME>Primary Batch</BATCHNAME>
        <AMOUNT>${negTaxable}</AMOUNT>
        <ACTUALQTY> ${qty} ${unit}</ACTUALQTY>
        <BILLEDQTY> ${qty} ${unit}</BILLEDQTY>
       </BATCHALLOCATIONS.LIST>
       <ACCOUNTINGALLOCATIONS.LIST>
        <LEDGERNAME>PURCHASE ACCOUNT</LEDGERNAME>
        <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
        <AMOUNT>${negTaxable}</AMOUNT>
       </ACCOUNTINGALLOCATIONS.LIST>
      </ALLINVENTORYENTRIES.LIST>
${gstLedgers}      <LEDGERENTRIES.LIST>
       <LEDGERNAME>${party}</LEDGERNAME>
       <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
       <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
       <AMOUNT>${partyAmtStr}</AMOUNT>
       <BILLALLOCATIONS.LIST>
        <NAME>${billNo}</NAME>
        <BILLTYPE>New Ref</BILLTYPE>
        <AMOUNT>${partyAmtStr}</AMOUNT>
       </BILLALLOCATIONS.LIST>
      </LEDGERENTRIES.LIST>
     </VOUCHER>
    </TALLYMESSAGE>`;
    }).join("\n");
    const xml = `<ENVELOPE>
 <HEADER>
  <TALLYREQUEST>Import Data</TALLYREQUEST>
 </HEADER>
 <BODY>
  <IMPORTDATA>
   <REQUESTDESC>
    <REPORTNAME>Vouchers</REPORTNAME>
    <STATICVARIABLES>
     <SVCURRENTCOMPANY>${COMPANY}</SVCURRENTCOMPANY>
    </STATICVARIABLES>
   </REQUESTDESC>
   <REQUESTDATA>
${vouchers}
   </REQUESTDATA>
  </IMPORTDATA>
 </BODY>
</ENVELOPE>`;
    const blob = new Blob([xml], { type:"application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `tally-purchase-${new Date().toISOString().slice(0,10)}.xml`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    // mark these bills as exported to Tally (so next export skips them)
    const exportedIds = new Set(bills.map(b => b.id));
    const affectedDesignIds = new Set(bills.map(b => b._did));
    const stamp = new Date().toISOString().slice(0,10);
    const updatedDesigns = designs.map(dn => {
      if (!affectedDesignIds.has(dn.id)) return dn;
      return { ...dn, supplierBills:(dn.supplierBills||[]).map(b => exportedIds.has(b.id) ? { ...b, tallyExported:true, tallyExportDate:stamp } : b) };
    });
    setDesigns(updatedDesigns);
    updatedDesigns.filter(dn => affectedDesignIds.has(dn.id)).forEach(dn => { dbUpsert("designs", dToRow(dn)); });
    recordActivity(currentUser, "Exported to Tally", "Purchase vouchers", `${bills.length} bills`);
    showToast(`Tally purchase XML (${bills.length} bills) ✓`);
  }

  function exportExcel() {
    // builds multiple CSV sections in one file, openable in Excel
    function csvCell(v) { const s = String(v==null?"":v).replace(/"/g,'""'); return /[",\n]/.test(s)?`"${s}"`:s; }
    function csvRows(rows) { return rows.map(r => r.map(csvCell).join(",")).join("\n"); }
    let out = "";
    // Designs
    out += "DESIGNS\n";
    out += csvRows([["Design No","Brand","Style","Fabric","Supplier","Lot No","Status","Code Words"], ...designs.map(d => [d.designNo,d.brand,d.style,d.fabric,d.supplier,d.lotNo,d.status,d.keywords])]) + "\n\n";
    // Fabric bills
    out += "FABRIC PURCHASES\n";
    const fb = [];
    designs.forEach(d => (d.supplierBills||[]).forEach(b => fb.push([b.billDate,b.billNo,b.supplier,b.designNo||d.designNo,b.qty,b.rate,b.amount,b.lrNo,b.transporter])));
    out += csvRows([["Bill Date","Bill No","Supplier","Design","Qty","Rate","Amount","LR No","Transporter"], ...fb]) + "\n\n";
    // Challans
    out += "CHALLANS\n";
    const ch = [];
    challans.forEach(c => (c.lines&&c.lines.length?c.lines:[{designNo:c.designNo,process:c.process,qty:c.qty,rate:c.rate,amount:c.amount}]).forEach(l => ch.push([c.date,c.challanNo,(people.find(j=>j.id===c.jobberId)||{}).name||c.jobberId,l.designNo,l.process,l.qty,l.rate,l.amount,c.status])));
    out += csvRows([["Date","Challan No","Jobber","Design","Process","Qty","Rate","Amount","Status"], ...ch]) + "\n\n";
    // Bills
    out += "JOBBER BILLS\n";
    out += csvRows([["Date","Bill No","Jobber","Designs","Total","GST"], ...bills.map(b => [b.billDate,b.billNo,(people.find(j=>j.id===b.jobberId)||{}).name||b.jobberId,(b.lines||[]).map(l=>l.designNo).join(" "),b.total,b.hasGst?"Yes":"No"])]) + "\n\n";
    // Payments
    out += "PAYMENTS\n";
    out += csvRows([["Date","Party","Amount","Mode","Note"], ...payments.map(p => [p.date,(p.jobberId||"").startsWith("SUP:")?p.jobberId.slice(4):((people.find(j=>j.id===p.jobberId)||{}).name||p.jobberId),p.amount,p.mode||p.channel,p.note])]) + "\n\n";
    // Credit notes
    out += "CREDIT NOTES\n";
    out += csvRows([["Date","CN No","Party Type","Party","Reason","Designs","Bills","Total"], ...creditNotes.map(c => [c.cnDate,c.cnNo,c.partyType,c.partyType==="supplier"?c.party:((people.find(j=>j.id===c.party)||{}).name||c.party),c.reason,cnDesignNos(c).join(" "),cnBillNos(c).join(" "),c.total])]) + "\n\n";

    const blob = new Blob(["\ufeff"+out], { type:"text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0,10);
    a.href = url; a.download = `aashish-erp-data-${stamp}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("Excel/CSV downloaded ✓");
  }

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
          <DesignForm onSave={saveDesign} onCancel={() => { setCreating(false); setEditing(false); }} existing={editing?sel:null} jobbers={jobbers} onAddJobber={addJobberInline} designs={designs} creditNotes={creditNotes} challans={challans} />
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
            {isAdmin && <Btn label="Delete Design" onClick={async () => {
              if (!sel) return;
              const dn = String(sel.designNo);
              const relChallans = (challans||[]).filter(c => challanDesigns(c).includes(dn));
              const relBills = (bills||[]).filter(b => String(b.designNo)===dn || (b.lines||[]).some(l=>String(l.designNo)===dn));
              if (!window.confirm(`Delete design ${sel.designNo}?\n\nThis will ALSO permanently delete everything linked to it:\n- ${relChallans.length} challan(s)\n- ${relBills.length} bill(s)\n- all its movements & cost-sheet entries\n\nCannot be undone. Use Backup first if unsure.`)) return;
              if (!window.confirm(`Are you absolutely sure? Design ${sel.designNo} and all its linked records will be gone for good.`)) return;
              for (const c of relChallans) {
                const otherDesigns = challanDesigns(c).filter(x => x!==dn);
                if (otherDesigns.length>0 && (c.lines||[]).length) {
                  const keptLines = c.lines.filter(l => String(l.designNo)!==dn);
                  const u = { ...c, lines:keptLines, qty:keptLines.reduce((a,l)=>a+(+l.qty||0),0), amount:keptLines.reduce((a,l)=>a+(+l.amount||0),0) };
                  await dbUpsert("challans", challanToRow(u));
                  setChallans(p => p.map(x=>x.id===c.id?u:x));
                } else {
                  await dbDelete("challans", c.id);
                  setChallans(p => p.filter(x=>x.id!==c.id));
                }
              }
              for (const b of relBills) {
                const keptLines = (b.lines||[]).filter(l => String(l.designNo)!==dn);
                if (String(b.designNo)===dn || keptLines.length===0) {
                  await dbDelete("bills", b.id);
                  setBills(p => p.filter(x=>x.id!==b.id));
                } else {
                  const u = { ...b, lines:keptLines, gross:keptLines.reduce((a,l)=>a+(+l.amount||0),0) };
                  await dbUpsert("bills", billToRow(u));
                  setBills(p => p.map(x=>x.id===b.id?u:x));
                }
              }
              await dbDelete("designs", sel.id);
              setDesigns(p => p.filter(x => x.id!==sel.id));
              recordActivity(currentUser, "Deleted design + linked records", `Design ${sel.designNo}`, `${relChallans.length} challans, ${relBills.length} bills removed`);
              showToast("Design and all linked records deleted");
              setSel(null);
            }} color={T.red+"22"} textColor={T.red} small style={{ border:`1px solid ${T.red}55` }} />}
            <Btn label="Logout" onClick={onLogout} color={T.surface} textColor={T.steelLt} small />
          </div>
        </div>
        <div style={{ maxWidth:1100, margin:"0 auto", padding:24 }}>
          <DesignDetail design={sel} jobbers={jobbers} onBack={() => setSel(null)} onUpdate={updateDesign} showToast={showToast} role={role} currentUser={currentUser} L={(x)=>x} onSendLot={sendLot} people={jobbers} challans={challans} creditNotes={creditNotes} locks={locks} setLocks={setLocks} />
        </div>
        <Toast {...toast} />
      </div>
    );
  }

  return (
    <div style={{ minHeight:"100vh", background:T.bg, fontFamily:T.sans }}>
      <style>{`@media print{ .no-print{display:none !important} .print-only{display:inline !important} body{background:#fff} tr{page-break-inside:avoid} }`}</style>
      <div style={{ background:`linear-gradient(135deg, #F3EAFB 0%, #FBEAF3 100%)`, borderBottom:`2px solid ${T.accent}`, padding:"0 24px", display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap" }}>
        <div style={{ display:"flex", alignItems:"center", flexWrap:"wrap" }}>
          <div style={{ marginRight:32, padding:"14px 0" }}>
            <div style={{ fontFamily:T.mono, fontSize:14, fontWeight:900, color:T.gold, letterSpacing:2 }}>AASHISH APPARELS</div>
            <div style={{ fontFamily:T.mono, fontSize:8, color:T.steelLt, letterSpacing:2 }}>PRODUCTION ERP · {isAdmin?"ADMIN":"TEAM"} · {currentUser}</div>
          </div>
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)} style={{ background:"none", border:"none", cursor:"pointer", padding:"18px 16px", fontFamily:T.mono, fontSize:11, fontWeight:700, color:tab===t?T.accent:T.steel, borderBottom:tab===t?`2px solid ${T.accent}`:"2px solid transparent", marginBottom:-2, textTransform:"uppercase" }}><BL text={t} /></button>
          ))}
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
          <NotificationBell notifications={notifications} currentUser={currentUser} onOpenDesign={openNotifTarget} onMarkRead={markNotifRead} />
          {isAdmin && <Btn label="⭳ Backup" onClick={exportBackup} color={T.accent} textColor="#fff" small />}
          {isAdmin && <Btn label="⭱ Restore" onClick={()=>restoreRef.current.click()} color={T.surface} textColor={T.accent} small style={{ border:`1px solid ${T.accent}55` }} />}
          {isAdmin && <Btn label="📊 Excel" onClick={exportExcel} color={T.surface} textColor={T.green} small style={{ border:`1px solid ${T.green}55` }} />}
          {isAdmin && <Btn label="⇩ Tally" onClick={()=>setShowTally(true)} color={T.surface} textColor={T.gold} small style={{ border:`1px solid ${T.gold}55` }} />}
          {isAdmin && <input ref={restoreRef} type="file" accept=".json,application/json" style={{ display:"none" }} onChange={handleRestoreFile} />}
          <Btn label="🖨 PDF" onClick={()=>window.print()} color={T.surface} textColor={T.steel} small style={{ border:`1px solid ${T.border}` }} />
          <Btn label="Logout" onClick={onLogout} color={T.surface} textColor={T.steelLt} small />
        </div>
      </div>
      <div style={{ maxWidth:1200, margin:"0 auto", padding:24 }}>
        {tab==="Home" && (
          <>
          <Dashboard designs={designs} bookings={bookings} bills={bills} payments={payments} people={people} lateDesigns={lateDesigns} isAdmin={isAdmin} onGo={(dest) => { if (dest==="__new__") setCreating(true); else setTab(dest); }} />
          {isAdmin && (() => {
            const pendingReqs = (locks||[]).filter(l => l.locked && l.reqPending);
            if (!pendingReqs.length) return null;
            return (
              <div style={{ background:T.orange+"11", borderRadius:10, padding:16, marginTop:16, border:`1px solid ${T.orange}` }}>
                <div style={{ fontFamily:T.mono, fontSize:12, color:T.orange, textTransform:"uppercase", fontWeight:700, marginBottom:10 }}>🔓 Unlock Requests ({pendingReqs.length})</div>
                {pendingReqs.map(l => (
                  <div key={l.id} style={{ display:"flex", alignItems:"center", gap:12, flexWrap:"wrap", padding:"8px 0", borderBottom:`1px solid ${T.border}` }}>
                    <span style={{ fontFamily:T.sans, fontSize:13, color:T.text, fontWeight:600 }}>{lockLabel(l.id)}</span>
                    <span style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt }}>requested by {l.reqBy||"user"}</span>
                    {l.codeActive
                      ? <span style={{ fontFamily:T.mono, fontSize:14, color:T.textDim, fontWeight:900, letterSpacing:3, background:T.surface, padding:"4px 14px", borderRadius:6, border:`1px dashed ${T.border}` }}>{l.code} <span style={{ fontSize:8 }}>(tell user — used once)</span></span>
                      : <button onClick={async()=>{ const code=String(Math.floor(1000+Math.random()*9000)); await saveLock(setLocks, { ...l, code, codeActive:true }); }} style={{ background:T.gold, color:T.bg, border:"none", borderRadius:6, padding:"6px 14px", fontFamily:T.mono, fontSize:11, fontWeight:700, cursor:"pointer" }}>Generate Code</button>}
                    <button onClick={async()=>{ await saveLock(setLocks, { ...l, reqPending:false, code:"", codeActive:false }); }} style={{ background:T.surface, border:`1px solid ${T.border}`, color:T.steelLt, borderRadius:6, padding:"6px 12px", fontFamily:T.mono, fontSize:10, cursor:"pointer" }}>Dismiss</button>
                  </div>
                ))}
              </div>
            );
          })()}
          {isAdmin && (() => {
            const editReqs = (challans||[]).filter(c => c.editReqPending && !c.editApproved);
            if (!editReqs.length) return null;
            return (
              <div style={{ background:T.accent+"11", borderRadius:10, padding:16, marginTop:16, border:`1px solid ${T.accent}` }}>
                <div style={{ fontFamily:T.mono, fontSize:12, color:T.accent, textTransform:"uppercase", fontWeight:700, marginBottom:10 }}>✎ Challan Edit Requests ({editReqs.length})</div>
                {editReqs.map(c => (
                  <div key={c.id} style={{ padding:"10px 0", borderBottom:`1px solid ${T.border}` }}>
                    <div style={{ display:"flex", alignItems:"center", gap:12, flexWrap:"wrap", marginBottom:8 }}>
                      <span style={{ fontFamily:T.sans, fontSize:13, color:T.text, fontWeight:600 }}>{(people.find(j=>j.id===c.jobberId)||{}).name||"Jobber"}</span>
                      <span style={{ fontFamily:T.mono, fontSize:11, color:T.gold }}>D{challanDesigns(c).join(",")}</span>
                      <span style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt }}>{c.qty} pcs · {c.date}</span>
                    </div>
                    <input value={c.editReason||""} onChange={async e=>{ const u={...c, editReason:e.target.value}; setChallans(p=>p.map(x=>x.id===c.id?u:x)); }} onBlur={async e=>{ const u={...c, editReason:e.target.value}; await dbUpsert("challans", challanToRow(u)); }} placeholder="Reason for editing (describe here)…" style={{ background:T.bg, border:`1px solid ${T.border}`, borderRadius:6, color:T.text, fontFamily:T.sans, fontSize:12, padding:"7px 10px", width:"100%", boxSizing:"border-box", marginBottom:8 }} />
                    <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
                      <Btn label="✓ Allow edit" small color={T.green} textColor="#fff" onClick={async()=>{
                        const u = { ...c, editApproved:true, editReqPending:false };
                        await dbUpsert("challans", challanToRow(u));
                        setChallans(p=>p.map(x=>x.id===c.id?u:x));
                        recordActivity(currentUser, "Allowed challan edit", `D${c.designNo} · ${(people.find(j=>j.id===c.jobberId)||{}).name||""}`, c.editReason?`Reason: ${c.editReason}`:"");
                        recordNotification((people.find(j=>j.id===c.jobberId)||{}).name||"", `Admin allowed you to edit challan D${c.designNo} — open it to edit qty/rate/date`, c.jobberId);
                      }} />
                      <Btn label="✕ Deny" small color={T.red+"22"} textColor={T.red} onClick={async()=>{
                        const u = { ...c, editReqPending:false, editApproved:false };
                        await dbUpsert("challans", challanToRow(u));
                        setChallans(p=>p.map(x=>x.id===c.id?u:x));
                      }} />
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
          {isAdmin && (
            <div style={{ background:T.card, borderRadius:10, padding:16, marginTop:16, border:`1px solid ${T.border}` }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                <span style={{ fontFamily:T.mono, fontSize:11, color:T.steelLt, textTransform:"uppercase" }}>Storage Used (estimate)</span>
                <span style={{ fontFamily:T.mono, fontSize:13, fontWeight:700, color: storagePct>85?T.red:storagePct>60?T.orange:T.green }}>{storageMB.toFixed(1)} MB / 500 MB</span>
              </div>
              <div style={{ background:T.surface, borderRadius:8, height:14, overflow:"hidden" }}>
                <div style={{ width:`${storagePct}%`, height:"100%", background: storagePct>85?T.red:storagePct>60?T.orange:T.green, transition:"width 0.3s" }} />
              </div>
              <div style={{ fontFamily:T.mono, fontSize:9, color:T.textDim, marginTop:6 }}>
                {storagePct>85 ? "⚠ Getting full — time to move photos to free storage. Tell your developer." : storagePct>60 ? "Filling up — keep an eye on it." : "Plenty of space. Photos are the biggest user."}
              </div>
            </div>
          )}
          </>
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
        {tab==="Bookings" && <Section title="Bookings — Order Planning" action={<PdfBtn targetId="rpt-bookings" title="Bookings" />}><div id="rpt-bookings"><BookingsPanel bookings={bookings} setBookings={setBookings} designs={designs} showToast={showToast} currentUser={currentUser} /></div></Section>}
        {tab==="Samples" && isAdmin && <Section title="Samples — Agent / Distributor wise tracking" action={<PdfBtn targetId="rpt-samples" title="Samples" />}><div id="rpt-samples"><SamplesTab showToast={showToast} currentUser={currentUser} /></div></Section>}
        {tab==="People" && isAdmin && <PeopleManager people={people} setPeople={setPeople} designs={designs} showToast={showToast} currentUser={currentUser} />}
        {tab==="Challans" && <Section title="Challans" action={<PdfBtn targetId="rpt-challans" title="Challans" />}><div id="rpt-challans"><ChallansPanel jobbers={people} designs={designs} setDesigns={setDesigns} challans={challans} setChallans={setChallans} bills={bills} showToast={showToast} currentUser={currentUser} role={role} /></div></Section>}
        {tab==="Bills & Ledger" && isAdmin && <Section title="Jobber Bills & Payment Ledger"><BillsLedger jobbers={people} designs={designs} bills={bills} setBills={setBills} payments={payments} setPayments={setPayments} challans={challans} setChallans={setChallans} creditNotes={creditNotes} setCreditNotes={setCreditNotes} showToast={showToast} currentUser={currentUser} /></Section>}
        {tab==="Fabric Purchases" && isAdmin && <Section title="Fabric Purchases"><FabricPurchases designs={designs} setDesigns={setDesigns} creditNotes={creditNotes} showToast={showToast} currentUser={currentUser} /></Section>}
        {tab==="Fabric Suppliers" && isAdmin && <Section title="Fabric Supplier Ledger"><FabricSupplierLedger designs={designs} payments={payments} setPayments={setPayments} creditNotes={creditNotes} setCreditNotes={setCreditNotes} showToast={showToast} currentUser={currentUser} /></Section>}
        {tab==="Fabric Stock" && isAdmin && <Section title="Fabric Stock — bought vs cut (all designs)"><FabricStock designs={designs} /></Section>}
        {tab==="Barcode" && isAdmin && <Section title="Barcode & Stock — colour+size wise (cut − damage)"><BarcodeStock designs={designs} setDesigns={setDesigns} showToast={showToast} /></Section>}
        {tab==="Activity Log" && isAdmin && <Section title="Activity Log — all changes" action={<PdfBtn targetId="rpt-activity" title="Activity Log" />}><div id="rpt-activity"><ActivityLog log={activityLog} /></div></Section>}
        {tab==="Search" && (
          <div>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by Design No, Brand or Style..." style={{ background:T.card, border:`2px solid ${T.gold}`, borderRadius:8, color:T.text, fontFamily:T.mono, fontSize:15, padding:"12px 18px", width:"100%", boxSizing:"border-box", outline:"none", marginBottom:20 }} />
            {search.length > 1 && searchResults.length === 0 && <div style={{ textAlign:"center", color:T.textDim, padding:40, fontFamily:T.mono }}>No designs found.</div>}
            {searchResults.length > 0 && <div style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, textTransform:"uppercase", margin:"6px 0" }}>Designs</div>}
            {searchResults.map(d => {
              // gather all jobbers who worked on this design (from challans) — name + process + qty + date
              const work = [];
              (challans||[]).forEach(c => {
                if (c.status==="rejected") return;
                if (!challanDesigns(c).includes(String(d.designNo))) return;
                const lns = (c.lines&&c.lines.length)?c.lines:[{designNo:c.designNo,process:c.process,qty:c.qty}];
                lns.forEach(l => {
                  if (String(l.designNo)!==String(d.designNo)) return;
                  const who = (people.find(j=>j.id===(l.sentToId||c.sendToId||c.jobberId))||{}).name || "—";
                  work.push({ who, process:l.process||c.process||"—", qty:l.qty||c.qty||0, date:c.date||"" });
                });
              });
              return (
              <div key={d.id} style={{ background:T.card, borderRadius:10, padding:18, marginBottom:12, border:`1px solid ${T.border}`, cursor:"pointer" }} onClick={() => setSel(d)}>
                <span style={{ fontFamily:T.mono, fontSize:22, fontWeight:900, color:T.gold }}>{designLabel(d)}</span>
                <span style={{ color:T.white, fontWeight:600, marginLeft:16 }}>{d.brand}</span>
                <span style={{ color:T.steelLt, marginLeft:12 }}>Style: {d.style}</span>
                {d.keywords && <span style={{ color:T.gold, marginLeft:12, fontSize:12, fontStyle:"italic" }}>🏷 {d.keywords}</span>}
                {work.length>0 && <div style={{ marginTop:10, borderTop:`1px solid ${T.border}`, paddingTop:8 }}>
                  <div style={{ fontFamily:T.mono, fontSize:9, color:T.steelLt, textTransform:"uppercase", marginBottom:4 }}>Jobbers who worked on this design</div>
                  {work.map((w,i)=>(
                    <div key={i} style={{ fontFamily:T.mono, fontSize:11, color:T.text, display:"flex", gap:10, flexWrap:"wrap", padding:"2px 0" }}>
                      <span style={{ color:T.accent, fontWeight:700, minWidth:90 }}>{w.who}</span>
                      <span style={{ color:T.steelLt }}>{w.process}</span>
                      <span>{w.qty} pcs</span>
                      <span style={{ color:T.steelLt }}>{w.date}</span>
                    </div>
                  ))}
                </div>}
              </div>
            );})}
            {isAdmin && peopleResults.length > 0 && <div style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, textTransform:"uppercase", margin:"12px 0 6px" }}>People — designs they're working on</div>}
            {isAdmin && peopleResults.map(p => {
              // designs this jobber is on (via process assignment or challan)
              const theirDesigns = designs.filter(d =>
                PROCESSES.some(pr => d.processes?.[pr]?.jobber===p.id) ||
                (challans||[]).some(c => c.status!=="rejected" && challanDesigns(c).includes(String(d.designNo)) && (c.jobberId===p.id || c.sendToId===p.id || (c.lines||[]).some(l=>l.sentToId===p.id)))
              );
              // completed = this jobber dispatched full qty (his sent qty >= received qty) OR design status Completed
              function isDoneFor(d) {
                if (d.status==="Completed") return true;
                // check challans: for this jobber, has he sent everything he received for this design?
                let recd=0, sent=0;
                (challans||[]).forEach(c => {
                  if (c.status==="rejected" || !challanDesigns(c).includes(String(d.designNo))) return;
                  (c.lines||[{designNo:c.designNo,qty:c.qty,sentToId:c.sendToId}]).forEach(l=>{
                    if (String(l.designNo)!==String(d.designNo)) return;
                    if (l.sentToId===p.id || c.sendToId===p.id) recd += (+l.qty||+c.qty||0);
                    if (c.jobberId===p.id) sent += (+l.qty||+c.qty||0);
                  });
                });
                return recd>0 && sent>=recd;
              }
              const ongoing = theirDesigns.filter(d=>!isDoneFor(d));
              const completed = theirDesigns.filter(d=>isDoneFor(d));
              const view = jobberDesignTab==="completed"?completed : jobberDesignTab==="ongoing"?ongoing : theirDesigns;
              return (
              <div key={p.id} style={{ background:T.card, borderRadius:10, padding:14, marginBottom:10, border:`1px solid ${T.border}` }}>
                <div style={{ marginBottom:8 }}>
                  <span style={{ color:T.white, fontWeight:700 }}>{p.name}</span>
                  <Badge label={p.role==="team"?"TEAM":"JOBBER"} color={p.role==="team"?T.steelLt:T.gold} />
                  {(p.processCodes||[]).map(pc=><Badge key={pc.process} label={pc.process} color={T.steel} />)}
                </div>
                <div style={{ display:"flex", gap:6, marginBottom:10 }}>
                  {[["ongoing",`Ongoing (${ongoing.length})`],["completed",`Completed (${completed.length})`],["all",`All (${theirDesigns.length})`]].map(([v,lbl])=>(
                    <button key={v} onClick={()=>setJobberDesignTab(v)} style={{ background:jobberDesignTab===v?T.gold:T.surface, color:jobberDesignTab===v?T.bg:T.steelLt, border:"none", borderRadius:16, padding:"4px 12px", fontFamily:T.mono, fontSize:10, fontWeight:700, cursor:"pointer" }}>{lbl}</button>
                  ))}
                </div>
                {view.length===0 ? <div style={{ fontFamily:T.mono, fontSize:11, color:T.textDim }}>No designs in this category.</div>
                : view.map(d=>(
                  <div key={d.id} onClick={()=>setSel(d)} style={{ display:"flex", gap:10, alignItems:"center", padding:"6px 0", borderTop:`1px solid ${T.border}`, cursor:"pointer" }}>
                    <span style={{ fontFamily:T.mono, fontWeight:700, color:T.gold }}>{designLabel(d)}</span>
                    <span style={{ color:T.text, fontSize:12 }}>{d.brand}</span>
                    <Badge label={isDoneFor(d)?"Completed":"Ongoing"} color={isDoneFor(d)?T.green:T.orange} />
                  </div>
                ))}
              </div>
            );})}
            {isAdmin && fabricSupplierResults.length > 0 && <div style={{ fontFamily:T.mono, fontSize:10, color:T.steelLt, textTransform:"uppercase", margin:"12px 0 6px" }}>Fabric Suppliers</div>}
            {isAdmin && fabricSupplierResults.map(name => {
              const bills = designs.flatMap(d => (d.supplierBills||[]).filter(b=>b.supplier===name).map(b=>({...b,designNo:b.designNo||d.designNo})));
              const billed = bills.reduce((a,b)=>a+billTotalWithGST(b),0);
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
      {/* Floating calculator */}
      {showCalc && <Calculator onClose={()=>setShowCalc(false)} />}
      {showTally && <TallyExportModal designs={designs} onClose={()=>setShowTally(false)} onExport={(opts)=>{ exportTallyPurchase(opts); }} />}
      <button onClick={()=>setShowCalc(v=>!v)} title="Calculator" style={{ position:"fixed", bottom:24, right:24, width:54, height:54, borderRadius:"50%", border:"none", cursor:"pointer", background:T.accent||T.gold, color:"#fff", fontSize:22, boxShadow:"0 6px 20px rgba(0,0,0,0.3)", zIndex:9997 }}>🧮</button>
      <Toast {...toast} />
    </div>
  );
}
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
  const [locks, setLocks] = useState([]);
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
      const lockRows = await dbSelect("locks");
      setLocks((lockRows||[]).map(r => ({ id:r.id, locked:!!r.locked, reqPending:!!r.req_pending, reqBy:r.req_by||"", code:r.code||"", codeActive:!!r.code_active })));
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
  useEffect(() => { document.body.style.background = T.bg; document.body.style.margin = "0"; }, []);

  if (loading) return <Loader />;
  if (!auth) return <Login people={people} loadInfo={loadInfo} onRefresh={loadAll} onAdmin={name => setAuth({role:"admin", name})} onUser={u => setAuth({role:u.role, user:u, name:u.name})} />;

  const errorBanner = saveError ? (
    <div style={{ position:"fixed", top:0, left:0, right:0, zIndex:9998, background:T.red, color:"#fff", padding:"10px 16px", fontFamily:T.mono, fontSize:12, fontWeight:700, display:"flex", justifyContent:"space-between", alignItems:"center", gap:12 }}>
      <span>⚠ {saveError} — your last change did NOT save. Tell admin to check the database column.</span>
      <button onClick={() => setSaveError("")} style={{ background:"#fff", color:T.red, border:"none", borderRadius:4, padding:"4px 12px", fontFamily:T.mono, fontWeight:700, cursor:"pointer" }}>Dismiss</button>
    </div>
  ) : null;

  if (auth.role === "jobber") {
    return <>{errorBanner}<JobberPanel user={auth.user} designs={designs} setDesigns={setDesigns} people={people} challans={challans} setChallans={setChallans} payments={payments} setPayments={setPayments} bills={bills} setBills={setBills} notifications={notifications} setNotifications={setNotifications} locks={locks} setLocks={setLocks} onLogout={() => setAuth(null)} /></>;
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
      locks={locks} setLocks={setLocks}
      creditNotes={creditNotes} setCreditNotes={setCreditNotes}
      onLogout={() => setAuth(null)}
    />
    </>
  );
}
