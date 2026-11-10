import { db, requireRole, logout, toast, esc, dateStr, parseDate, prettyDate } from "./common.js?v=11";
import { SURAHS, surahName } from "./quran.js?v=5";
import {
  collection, doc, getDoc, getDocs, query, where, orderBy, limit, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

const ATT = [
  { v: "present", t: "حاضر" },
  { v: "late", t: "متأخر" },
  { v: "excused", t: "معذور" },
  { v: "absent", t: "غائب" }
];
const GRADES = ["ممتاز", "جيد", "مقبول", "ضعيف"];
const PAGES = [0.5, 1, 1.5, 2, 3];
const REVIEW_PAGES = [1, 2, 3, 5, 10, 20];
const arDigits = (n) => String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]);
const pagesLabel = (p) => (p === 0.5 ? "½" : arDigits(p));

let me = null;          // بيانات المستخدم
let days = [];          // أيام الحلقة
let halaqaId = null;
let students = [];
let recs = {};          // تسجيل اليوم لكل طالب
let lastHifz = {};      // آخر حفظ سابق لكل طالب
let open = new Set();   // الطلاب المفتوحة تفاصيلهم
let currentDate = dateStr();
const timers = {};

$("logoutBtn").onclick = () => logout();

// ---------- أدوات ----------
function emptyRec() {
  return { attendance: null, hifz: {}, review: { kind: "surah" }, note: "" };
}
function getPath(obj, path) {
  return path.split(".").reduce((o, k) => (o ? o[k] : undefined), obj);
}
function setPath(obj, path, val) {
  const keys = path.split(".");
  let o = obj;
  keys.slice(0, -1).forEach((k) => { o[k] = o[k] || {}; o = o[k]; });
  o[keys.at(-1)] = val;
}
function toNum(v) {
  const s = String(v ?? "").replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).trim();
  if (s === "") return null;
  return isNaN(+s) ? s : +s;
}
function cleanSection(sec, ignore = []) {
  const out = {};
  Object.entries(sec || {}).forEach(([k, v]) => {
    if (v !== null && v !== undefined && v !== "") out[k] = v;
  });
  const meaningful = Object.keys(out).filter((k) => !ignore.includes(k));
  return meaningful.length ? out : null;
}
// يحول التسجيل لنسخة نظيفة (الحقول الفاضية ما تنحفظ)
function cleanRec(r) {
  const hifz = cleanSection(r.hifz);
  const review = cleanSection(r.review, ["kind"]);
  const note = (r.note || "").trim() || null;
  if (!r.attendance && !hifz && !review && !note) return null;
  return { attendance: r.attendance || null, hifz, review, note };
}

function summary(r) {
  const parts = [];
  const h = r.hifz || {};
  if (h.surah || h.from || h.to || h.grade || h.pages) {
    let s = "حفظ: " + (h.surah ? surahName(h.surah) : "");
    if (h.from || h.to) s += ` ${h.from ?? ""}${h.to ? "-" + h.to : ""}`;
    if (h.pages) s += ` • ${pagesLabel(h.pages)} وجه`;
    if (h.grade) s += ` (${h.grade})`;
    parts.push(s.trim());
  }
  const rv = r.review || {};
  if (rv.value || rv.from || rv.to || rv.grade || rv.pages) {
    let s = "مراجعة: " + (rv.value ? (rv.kind === "juz" ? "جزء " + rv.value : surahName(rv.value)) : "");
    if (rv.pages) s += ` • ${pagesLabel(rv.pages)} وجه`;
    if (rv.grade) s += ` (${rv.grade})`;
    parts.push(s.trim());
  }
  if ((r.note || "").trim()) parts.push("📝");
  return parts.join(" • ");
}

// ---------- التاريخ ----------
function shiftDay(dir) {
  const d = parseDate(currentDate);
  for (let i = 0; i < 7; i++) {
    d.setDate(d.getDate() + dir);
    if (!days.length || days.includes(d.getDay())) break;
  }
  setDate(dateStr(d));
}
function setDate(s) {
  if (!s) return;
  currentDate = s;
  $("dateInput").value = s;
  const p = prettyDate(s);
  $("dateDay").textContent = (s === dateStr() ? "اليوم • " : "") + p.day;
  $("dateSub").textContent = [p.hijri, p.greg].filter(Boolean).join(" • ");
  $("dayWarn").classList.toggle("hidden", !days.length || days.includes(parseDate(s).getDay()));
  loadRecords();
}
$("prevDay").onclick = () => shiftDay(-1);
$("nextDay").onclick = () => shiftDay(1);
$("dateInput").onchange = (e) => setDate(e.target.value);

// ---------- التحميل ----------
async function loadStudents() {
  const snap = await getDocs(query(collection(db, "students"), where("halaqaId", "==", halaqaId)));
  students = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .filter((s) => s.active !== false)
    .sort((a, b) => a.name.localeCompare(b.name, "ar"));
}

async function loadRecords() {
  if (!halaqaId) return;
  $("loading").classList.remove("hidden");
  $("loading").textContent = "جاري التحميل...";
  try {
    const snap = await getDocs(query(
      collection(db, "halaqat", halaqaId, "records"),
      where("date", "<=", currentDate), orderBy("date", "desc"), limit(400)));
    recs = {};
    lastHifz = {};
    snap.docs.forEach((d) => {
      const r = d.data();
      if (r.date === currentDate) {
        recs[r.studentId] = {
          attendance: r.attendance || null,
          hifz: r.hifz || {},
          review: r.review || { kind: "surah" },
          note: r.note || ""
        };
      } else if (!lastHifz[r.studentId] && r.hifz && r.hifz.surah) {
        lastHifz[r.studentId] = r.hifz;
      }
    });
    $("loading").classList.add("hidden");
    render();
  } catch (e) {
    $("loading").textContent = "مشكلة في التحميل: " + (e.code || e.message);
  }
}

// ---------- العرض ----------
function surahOptions(selected) {
  return `<option value="">اختر السورة</option>` + SURAHS.map((s) =>
    `<option value="${s.n}" ${+selected === s.n ? "selected" : ""}>${s.n} - ${s.name}</option>`).join("");
}
function juzOptions(selected) {
  return `<option value="">اختر الجزء</option>` + Array.from({ length: 30 }, (_, i) =>
    `<option value="${i + 1}" ${+selected === i + 1 ? "selected" : ""}>الجزء ${i + 1}</option>`).join("");
}
function seg(path, values, current, label = (v) => v) {
  return `<div class="seg">${values.map((v) =>
    `<button type="button" class="${current === v ? "on" : ""}" data-a="set" data-f="${path}" data-v="${v}">${label(v)}</button>`).join("")}</div>`;
}

function cardHTML(s) {
  const r = recs[s.id] || emptyRec();
  const h = r.hifz || {};
  const rv = r.review || { kind: "surah" };
  const isOpen = open.has(s.id);
  const last = lastHifz[s.id];
  const sum = summary(r);
  return `
  <div class="stu att-${r.attendance || "none"}" id="stu-${s.id}" data-sid="${s.id}">
    <div class="stu-head">
      <span class="stu-name">${esc(s.name)}</span>
      <span class="save-state" id="ss-${s.id}"></span>
    </div>
    <div class="att">
      ${ATT.map((a) => `<button type="button" class="att-btn ${a.v} ${r.attendance === a.v ? "on" : ""}" data-a="att" data-v="${a.v}">${a.t}</button>`).join("")}
    </div>
    <button type="button" class="more" data-a="toggle">
      <span id="sum-${s.id}">${sum ? esc(sum) : "تسجيل الحفظ والمراجعة"}</span>
      <span>${isOpen ? "▴" : "▾"}</span>
    </button>
    ${isOpen ? `
    <div class="details">
      <div class="sec">
        <div class="sec-title">الحفظ الجديد
          ${last ? `<button type="button" class="small-btn" data-a="cont">↩ كمّل من آخر حفظ</button>` : ""}
        </div>
        ${last ? `<div class="hint">آخر حفظ: ${esc(surahName(last.surah))} ${last.from ?? ""}${last.to ? "-" + last.to : ""}</div>` : ""}
        <select data-f="hifz.surah">${surahOptions(h.surah)}</select>
        <div class="two">
          <input data-f="hifz.from" inputmode="numeric" placeholder="من آية" value="${esc(h.from ?? "")}">
          <input data-f="hifz.to" inputmode="numeric" placeholder="إلى آية" value="${esc(h.to ?? "")}">
        </div>
        <div class="mini-label">التقييم</div>
        ${seg("hifz.grade", GRADES, h.grade)}
        <div class="mini-label">عدد الأوجه</div>
        ${seg("hifz.pages", PAGES, h.pages, pagesLabel)}
      </div>

      <div class="sec">
        <div class="sec-title">المراجعة</div>
        <div class="seg kind">
          <button type="button" class="${rv.kind !== "juz" ? "on" : ""}" data-a="kind" data-v="surah">سورة</button>
          <button type="button" class="${rv.kind === "juz" ? "on" : ""}" data-a="kind" data-v="juz">جزء</button>
        </div>
        <select data-f="review.value">${rv.kind === "juz" ? juzOptions(rv.value) : surahOptions(rv.value)}</select>
        <div class="two">
          <input data-f="review.from" inputmode="numeric" placeholder="من" value="${esc(rv.from ?? "")}">
          <input data-f="review.to" inputmode="numeric" placeholder="إلى" value="${esc(rv.to ?? "")}">
        </div>
        <div class="mini-label">عدد الأوجه</div>
        ${seg("review.pages", REVIEW_PAGES, rv.pages, pagesLabel)}
        <input class="pages-other" data-f="review.pages" inputmode="decimal" placeholder="أو اكتب العدد" value="${REVIEW_PAGES.includes(rv.pages) ? "" : esc(rv.pages ?? "")}">
        <div class="mini-label">التقييم</div>
        ${seg("review.grade", GRADES, rv.grade)}
      </div>

      <textarea data-f="note" rows="2" placeholder="ملاحظة (اختياري)">${esc(r.note || "")}</textarea>
    </div>` : ""}
  </div>`;
}

function renderCounts() {
  const c = { present: 0, late: 0, excused: 0, absent: 0, none: 0 };
  students.forEach((s) => c[(recs[s.id] && recs[s.id].attendance) || "none"]++);
  $("counts").innerHTML =
    `<span class="c present">حاضر ${c.present}</span>` +
    `<span class="c late">متأخر ${c.late}</span>` +
    `<span class="c excused">معذور ${c.excused}</span>` +
    `<span class="c absent">غائب ${c.absent}</span>` +
    `<span class="c none">لم يُسجل ${c.none}</span>`;
  $("allPresentBtn").classList.toggle("hidden", c.none === 0);
}

function render() {
  $("studentsList").innerHTML = students.length
    ? students.map(cardHTML).join("")
    : '<p class="muted center">لا يوجد طلاب في هذي الحلقة</p>';
  renderCounts();
}

function rerenderCard(sid) {
  const s = students.find((x) => x.id === sid);
  const el = $("stu-" + sid);
  if (s && el) el.outerHTML = cardHTML(s);
  renderCounts();
}

// ---------- الحفظ التلقائي ----------
function rec(sid) {
  if (!recs[sid]) recs[sid] = emptyRec();
  return recs[sid];
}

function scheduleSave(sid, delay = 700) {
  const st = $("ss-" + sid);
  if (st) { st.textContent = "…"; st.className = "save-state"; }
  clearTimeout(timers[sid]);
  timers[sid] = setTimeout(() => saveNow(sid), delay);
}

async function saveNow(sid) {
  const s = students.find((x) => x.id === sid);
  if (!s) return;
  const date = currentDate;
  const clean = cleanRec(recs[sid] || emptyRec());
  const recRef = doc(db, "halaqat", halaqaId, "records", `${date}_${sid}`);
  const portalRef = doc(db, "portal", s.token, "records", date);
  const batch = writeBatch(db);
  if (clean) {
    const data = { date, studentId: sid, halaqaId, ...clean };
    batch.set(recRef, { ...data, studentName: s.name, updatedBy: me.email, updatedAt: serverTimestamp() });
    batch.set(portalRef, { ...data, updatedAt: serverTimestamp() });
  } else {
    batch.delete(recRef);
    batch.delete(portalRef);
  }
  const st = () => $("ss-" + sid);
  if (st()) st().textContent = "⏳";
  try {
    await batch.commit();
    if (st()) { st().textContent = "✓ محفوظ"; st().className = "save-state ok"; }
  } catch (e) {
    if (st()) { st().textContent = "✗ ما انحفظ"; st().className = "save-state err"; }
    toast("ما انحفظ تسجيل " + s.name + ": " + (e.code || e.message), true);
  }
}

// ---------- الأزرار ----------
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-a]");
  if (!b) return;
  const card = b.closest(".stu");
  const sid = card && card.dataset.sid;
  const a = b.dataset.a;

  if (a === "toggle") {
    open.has(sid) ? open.delete(sid) : open.add(sid);
    rerenderCard(sid);
    return;
  }
  if (a === "att") {
    const r = rec(sid);
    r.attendance = r.attendance === b.dataset.v ? null : b.dataset.v;
    rerenderCard(sid);
    scheduleSave(sid, 300);
    return;
  }
  if (a === "set") {
    const r = rec(sid);
    let v = b.dataset.v;
    if (b.dataset.f.endsWith(".pages")) v = +v;
    setPath(r, b.dataset.f, getPath(r, b.dataset.f) === v ? null : v);
    rerenderCard(sid);
    scheduleSave(sid);
    return;
  }
  if (a === "kind") {
    const r = rec(sid);
    if ((r.review.kind || "surah") !== b.dataset.v) {
      r.review = { ...r.review, kind: b.dataset.v, value: null };
      rerenderCard(sid);
      scheduleSave(sid);
    }
    return;
  }
  if (a === "cont") {
    const r = rec(sid);
    const last = lastHifz[sid];
    const sur = SURAHS[last.surah - 1];
    if (last.to && sur && last.to < sur.ayahs) {
      r.hifz = { ...r.hifz, surah: last.surah, from: last.to + 1, to: null };
    } else {
      r.hifz = { ...r.hifz, surah: last.surah };
      toast("آخر حفظ وصل لنهاية السورة، اختر السورة الجديدة");
    }
    rerenderCard(sid);
    scheduleSave(sid);
  }
});

// الكتابة في الخانات والقوائم
function onField(e) {
  const el = e.target;
  if (!el.dataset || !el.dataset.f) return;
  const card = el.closest(".stu");
  if (!card) return;
  const sid = card.dataset.sid;
  const r = rec(sid);
  const f = el.dataset.f;
  setPath(r, f, f === "note" ? el.value : toNum(el.value));
  const sumEl = $("sum-" + sid);
  if (sumEl) sumEl.textContent = summary(r) || "تسجيل الحفظ والمراجعة";
  scheduleSave(sid, el.tagName === "SELECT" ? 300 : 900);
}
document.addEventListener("input", onField);

$("allPresentBtn").onclick = () => {
  students.forEach((s) => {
    const r = rec(s.id);
    if (!r.attendance) {
      r.attendance = "present";
      rerenderCard(s.id);
      scheduleSave(s.id, 200);
    }
  });
};

// حفظ أي شيء معلق قبل ما يطلع من الصفحة أو يغير اليوم
function flushAll() {
  Object.keys(timers).forEach((sid) => { clearTimeout(timers[sid]); delete timers[sid]; saveNow(sid); });
}
window.addEventListener("pagehide", flushAll);
document.addEventListener("visibilitychange", () => { if (document.hidden) flushAll(); });
["prevDay", "nextDay", "dateInput", "halaqaSelect"].forEach((id) =>
  $(id).addEventListener("pointerdown", flushAll));

// ---------- التشغيل ----------
(async () => {
  me = await requireRole(["teacher", "admin"]);
  const s = await getDoc(doc(db, "settings", "main"));
  days = s.exists() ? s.data().days || [] : [];

  if (me.role === "admin") {
    $("adminLink").classList.remove("hidden");
    const hs = await getDocs(collection(db, "halaqat"));
    const list = hs.docs.map((d) => ({ id: d.id, ...d.data() }))
      .filter((h) => h.active !== false)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    let saved = null;
    try { saved = localStorage.getItem("halaqa"); } catch {}
    halaqaId = list.some((h) => h.id === saved) ? saved : list[0] && list[0].id;
    const sel = $("halaqaSelect");
    sel.innerHTML = list.map((h) => `<option value="${h.id}" ${h.id === halaqaId ? "selected" : ""}>${esc(h.name)}</option>`).join("");
    sel.classList.remove("hidden");
    $("halaqaName").textContent = "التسجيل (مشرف)";
    sel.onchange = async () => {
      flushAll();
      halaqaId = sel.value;
      try { localStorage.setItem("halaqa", halaqaId); } catch {}
      open.clear();
      await loadStudents();
      loadRecords();
    };
  } else {
    halaqaId = me.teacher.halaqaId;
    $("halaqaName").textContent = me.halaqa ? me.halaqa.name : "";
  }

  if (!halaqaId) {
    $("loading").textContent = "ما تحددت لك حلقة بعد. تواصل مع المشرف.";
    return;
  }
  await loadStudents();
  setDate(currentDate);
})();
