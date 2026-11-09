// صفحة ولي الأمر: عرض فقط
import { db, esc, dateStr, parseDate, prettyDate, DAY_NAMES } from "./common.js?v=5";
import { surahName } from "./quran.js?v=5";
import { doc, getDoc, collection, getDocs }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
const box = $("content");
const QURAN_PAGES = 604;

const ATT_LABEL = { present: "حاضر", late: "متأخر", excused: "معذور", absent: "غائب" };
const ar = (n) => String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]);
const fmt = (n) => ar(Math.round(n * 10) / 10);
const pagesTxt = (p) => (p === 0.5 ? "½" : fmt(p));

function hifzText(h) {
  if (!h) return "";
  let s = h.surah ? surahName(h.surah) : "";
  if (h.from || h.to) s += ` ${ar(h.from ?? "")}${h.to ? "–" + ar(h.to) : ""}`;
  return s.trim();
}
function reviewText(r) {
  if (!r) return "";
  let s = r.value ? (r.kind === "juz" ? "الجزء " + ar(r.value) : surahName(r.value)) : "";
  if (r.from || r.to) s += ` ${ar(r.from ?? "")}${r.to ? "–" + ar(r.to) : ""}`;
  return s.trim();
}
function gradeTag(g) {
  if (!g) return "";
  const cls = { "ممتاز": "g1", "جيد": "g2", "مقبول": "g3", "ضعيف": "g4" }[g] || "";
  return `<span class="grade ${cls}">${esc(g)}</span>`;
}
function shortDate(s) {
  const p = prettyDate(s);
  return `${p.day} ${p.hijri.replace(/ هـ$/, "")}`;
}

// إحصائيات مجموعة من التسجيلات
function stats(list) {
  const c = { present: 0, late: 0, excused: 0, absent: 0 };
  let hifzPages = 0, reviewPages = 0;
  list.forEach((r) => {
    if (r.attendance) c[r.attendance]++;
    if (r.hifz && +r.hifz.pages) hifzPages += +r.hifz.pages;
    if (r.review && +r.review.pages) reviewPages += +r.review.pages;
  });
  const counted = c.present + c.late + c.absent; // المعذور ما يُحسب ضده
  const rate = counted ? Math.round(((c.present + c.late) / counted) * 100) : null;
  return { ...c, rate, hifzPages, reviewPages };
}

function weekStart(s) {
  const d = parseDate(s);
  d.setDate(d.getDate() - d.getDay()); // الأحد
  return dateStr(d);
}

function render(p, records) {
  const all = stats(records);
  const thisMonth = dateStr().slice(0, 7);
  const month = stats(records.filter((r) => r.date.startsWith(thisMonth)));
  const lastH = records.find((r) => r.hifz && (r.hifz.surah || r.hifz.pages));
  const lastR = records.find((r) => r.review && (r.review.value || r.review.pages));
  const progress = Math.min(100, (all.hifzPages / QURAN_PAGES) * 100);

  // تجميع السجل حسب الأسابيع
  const weeks = [];
  records.forEach((r) => {
    const w = weekStart(r.date);
    let g = weeks.find((x) => x.start === w);
    if (!g) weeks.push((g = { start: w, items: [] }));
    g.items.push(r);
  });

  box.innerHTML = `
    ${p.active === false ? '<div class="notice">الطالب موقوف حالياً عن الحلقة</div>' : ""}

    <div class="stat-grid">
      <div class="stat">
        <div class="stat-num">${all.rate === null ? "—" : ar(all.rate) + "٪"}</div>
        <div class="stat-label">نسبة الحضور</div>
      </div>
      <div class="stat">
        <div class="stat-num">${fmt(all.hifzPages)}</div>
        <div class="stat-label">وجه حفظ</div>
      </div>
      <div class="stat">
        <div class="stat-num">${fmt(all.reviewPages)}</div>
        <div class="stat-label">وجه مراجعة</div>
      </div>
    </div>

    <div class="card-box">
      <h3>التقدم في الحفظ</h3>
      <div class="bar"><div class="bar-fill" style="width:${progress}%"></div></div>
      <p class="hint">حفظ <b>${fmt(all.hifzPages)}</b> وجه من أصل ${ar(QURAN_PAGES)} وجه (منذ بداية التسجيل في النظام)</p>
    </div>

    <div class="two-cards">
      <div class="card-box">
        <div class="mini-title">آخر حفظ</div>
        ${lastH ? `
          <div class="big-text">${esc(hifzText(lastH.hifz)) || "—"}</div>
          <div class="hint">${shortDate(lastH.date)} ${lastH.hifz.pages ? "• " + pagesTxt(+lastH.hifz.pages) + " وجه" : ""}</div>
          ${gradeTag(lastH.hifz.grade)}` : '<div class="muted">لا يوجد بعد</div>'}
      </div>
      <div class="card-box">
        <div class="mini-title">آخر مراجعة</div>
        ${lastR ? `
          <div class="big-text">${esc(reviewText(lastR.review)) || "—"}</div>
          <div class="hint">${shortDate(lastR.date)} ${lastR.review.pages ? "• " + pagesTxt(+lastR.review.pages) + " وجه" : ""}</div>
          ${gradeTag(lastR.review.grade)}` : '<div class="muted">لا يوجد بعد</div>'}
      </div>
    </div>

    <div class="card-box">
      <h3>هذا الشهر</h3>
      <div class="month-row"><span>الحضور</span><b>${month.rate === null ? "—" : ar(month.rate) + "٪"}</b></div>
      <div class="att-chips">
        <span class="att-tag present">حاضر ${ar(month.present)}</span>
        <span class="att-tag late">متأخر ${ar(month.late)}</span>
        <span class="att-tag excused">معذور ${ar(month.excused)}</span>
        <span class="att-tag absent">غائب ${ar(month.absent)}</span>
      </div>
      <div class="month-row"><span>أوجه الحفظ</span><b>${fmt(month.hifzPages)}</b></div>
      <div class="month-row"><span>أوجه المراجعة</span><b>${fmt(month.reviewPages)}</b></div>
    </div>

    <h3 class="section-title">السجل الأسبوعي</h3>
    ${weeks.length ? weeks.map((w, i) => `
      <details class="week" ${i < 2 ? "open" : ""}>
        <summary>الأسبوع من ${shortDate(w.start).replace(/^\S+ /, "")}</summary>
        ${w.items.slice().reverse().map((r) => `
          <div class="day-row">
            <div class="day-head">
              <span>${DAY_NAMES[parseDate(r.date).getDay()]}</span>
              ${r.attendance ? `<span class="att-tag ${r.attendance}">${ATT_LABEL[r.attendance]}</span>` : ""}
            </div>
            ${r.hifz && hifzText(r.hifz) || (r.hifz && r.hifz.pages) ? `<div class="day-line">📖 حفظ: ${esc(hifzText(r.hifz))} ${r.hifz.pages ? "(" + pagesTxt(+r.hifz.pages) + " وجه)" : ""} ${gradeTag(r.hifz.grade)}</div>` : ""}
            ${r.review && (reviewText(r.review) || r.review.pages) ? `<div class="day-line">🔁 مراجعة: ${esc(reviewText(r.review))} ${r.review.pages ? "(" + pagesTxt(+r.review.pages) + " وجه)" : ""} ${gradeTag(r.review.grade)}</div>` : ""}
          </div>`).join("")}
      </details>`).join("") : '<p class="muted center">لا يوجد تسجيل بعد</p>'}
  `;
}

(async () => {
  const k = new URLSearchParams(location.search).get("k");
  try {
    const snap = k ? await getDoc(doc(db, "portal", k)) : null;
    if (!snap || !snap.exists()) {
      $("sName").textContent = "حلقة ابن عقيل";
      box.innerHTML = '<div class="card-box center">الرابط غير صحيح أو انتهى. تواصل مع إدارة الحلقة للحصول على الرابط الجديد.</div>';
      return;
    }
    const p = snap.data();
    $("sName").textContent = p.name;
    $("sHalaqa").textContent = p.halaqaName || "";
    document.title = p.name + " - حلقة ابن عقيل";

    const rs = await getDocs(collection(db, "portal", k, "records"));
    const records = rs.docs.map((d) => d.data())
      .filter((r) => r.date)
      .sort((a, b) => b.date.localeCompare(a.date)); // الأحدث أولاً
    render(p, records);
  } catch (e) {
    box.innerHTML = '<div class="card-box center">تعذر التحميل، حاول مرة ثانية.</div>';
  }
})();
