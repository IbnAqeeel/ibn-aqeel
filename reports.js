import { db, requireRole, toast, esc, dateStr, parseDate, prettyDate, DAY_NAMES } from "./common.js?v=5";
import { surahName } from "./quran.js?v=5";
import { collection, getDocs, query, where }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
const ar = (n) => String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]);
const fmt = (n) => ar(Math.round(n * 10) / 10);
const pct = (n) => (n === null ? "—" : ar(n) + "٪");
const ATT_LABEL = { present: "حاضر", late: "متأخر", excused: "معذور", absent: "غائب" };
const GRADES = ["ممتاز", "جيد", "مقبول", "ضعيف"];

let halaqat = [], students = [];
let period = "month";
let anchor = new Date();
let range = { from: "", to: "", label: "", sub: "" };
let data = [];        // [{halaqa, records, rows, stats}]
let sortKey = "name";
let currentStudent = null;

// ---------- الفترات (الشهر هجري) ----------
const hFmt = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura-nu-latn", { year: "numeric", month: "numeric", day: "numeric" });
function hParts(d) {
  const p = hFmt.formatToParts(d);
  const g = (t) => +p.find((x) => x.type === t).value;
  return { y: g("year"), m: g("month"), d: g("day") };
}
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const hijriLong = (d, opts) => new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura", opts).format(d);

function computeRange() {
  if (period === "week") {
    const s = addDays(anchor, -anchor.getDay());
    const e = addDays(s, 6);
    range = {
      from: dateStr(s), to: dateStr(e),
      label: "أسبوع " + hijriLong(s, { day: "numeric", month: "long" }),
      sub: hijriLong(s, { day: "numeric", month: "short" }) + " – " + hijriLong(e, { day: "numeric", month: "short", year: "numeric" })
    };
  } else if (period === "month") {
    const h = hParts(anchor);
    const s = addDays(anchor, -(h.d - 1));
    let e = new Date(s);
    while (hParts(addDays(e, 1)).m === h.m) e = addDays(e, 1);
    range = {
      from: dateStr(s), to: dateStr(e),
      label: "شهر " + hijriLong(s, { month: "long", year: "numeric" }),
      sub: new Intl.DateTimeFormat("ar-EG", { day: "numeric", month: "short" }).format(s) + " – " +
        new Intl.DateTimeFormat("ar-EG", { day: "numeric", month: "short", year: "numeric" }).format(e)
    };
  } else {
    const f = $("fromIn").value || dateStr(addDays(new Date(), -30));
    const t = $("toIn").value || dateStr();
    $("fromIn").value = f; $("toIn").value = t;
    range = {
      from: f, to: t, label: "فترة مخصصة",
      sub: hijriLong(parseDate(f), { day: "numeric", month: "short" }) + " – " + hijriLong(parseDate(t), { day: "numeric", month: "short", year: "numeric" })
    };
  }
  $("pLabel").textContent = range.label;
  $("pSub").textContent = range.sub;
  $("printPeriod").textContent = range.label + " (" + range.sub + ")";
}

// ---------- الحسابات ----------
function emptyStats() {
  return { present: 0, late: 0, excused: 0, absent: 0, attended: 0, hifzCount: 0, reviewCount: 0,
    hifzPages: 0, reviewPages: 0, grades: { "ممتاز": 0, "جيد": 0, "مقبول": 0, "ضعيف": 0 }, days: new Set() };
}
function addRec(st, r) {
  st.days.add(r.date);
  if (r.attendance) st[r.attendance]++;
  const h = r.hifz, v = r.review;
  if (h && (h.surah || h.from || h.to || h.grade || h.pages)) {
    st.hifzCount++;
    if (+h.pages) st.hifzPages += +h.pages;
    if (h.grade && st.grades[h.grade] !== undefined) st.grades[h.grade]++;
  }
  if (v && (v.value || v.from || v.to || v.grade || v.pages)) {
    st.reviewCount++;
    if (+v.pages) st.reviewPages += +v.pages;
  }
}
function finish(st) {
  const attended = st.present + st.late;
  const counted = attended + st.absent; // المعذور ما يُحسب ضده
  st.attended = attended;
  st.rate = counted ? Math.round((attended / counted) * 100) : null;
  st.hifzRate = attended ? Math.min(100, Math.round((st.hifzCount / attended) * 100)) : null;
  st.reviewRate = attended ? Math.min(100, Math.round((st.reviewCount / attended) * 100)) : null;
  return st;
}

async function load() {
  computeRange();
  $("report").innerHTML = '<p class="muted center">جاري التحميل...</p>';
  const sel = $("halaqaSel").value;
  const chosen = sel === "all" ? halaqat : halaqat.filter((h) => h.id === sel);
  try {
    data = await Promise.all(chosen.map(async (h) => {
      const snap = await getDocs(query(collection(db, "halaqat", h.id, "records"),
        where("date", ">=", range.from), where("date", "<=", range.to)));
      const records = snap.docs.map((d) => d.data()).sort((a, b) => a.date.localeCompare(b.date));
      const byStu = {};
      students.filter((s) => s.halaqaId === h.id && s.active !== false)
        .forEach((s) => (byStu[s.id] = { id: s.id, name: s.name, st: emptyStats(), recs: [] }));
      const total = emptyStats();
      records.forEach((r) => {
        if (!byStu[r.studentId]) {
          const s = students.find((x) => x.id === r.studentId);
          byStu[r.studentId] = { id: r.studentId, name: s ? s.name : r.studentName || "طالب", st: emptyStats(), recs: [] };
        }
        addRec(byStu[r.studentId].st, r);
        byStu[r.studentId].recs.push(r);
        addRec(total, r);
      });
      const rows = Object.values(byStu);
      rows.forEach((x) => finish(x.st));
      return { halaqa: h, records, rows, stats: finish(total) };
    }));
    render();
  } catch (e) {
    $("report").innerHTML = `<p class="muted center">مشكلة في التحميل: ${esc(e.code || e.message)}</p>`;
  }
}

// ---------- العرض ----------
function statGrid(st) {
  return `
    <div class="stat-grid three">
      <div class="stat"><div class="stat-num">${pct(st.rate)}</div><div class="stat-label">الحضور</div></div>
      <div class="stat"><div class="stat-num">${pct(st.hifzRate)}</div><div class="stat-label">التسميع (حفظ)</div></div>
      <div class="stat"><div class="stat-num">${pct(st.reviewRate)}</div><div class="stat-label">المراجعة</div></div>
      <div class="stat"><div class="stat-num">${fmt(st.hifzPages)}</div><div class="stat-label">وجه حفظ</div></div>
      <div class="stat"><div class="stat-num">${fmt(st.reviewPages)}</div><div class="stat-label">وجه مراجعة</div></div>
      <div class="stat"><div class="stat-num">${ar(st.days.size)}</div><div class="stat-label">لقاء</div></div>
    </div>
    <div class="att-chips">
      <span class="att-tag present">حاضر ${ar(st.present)}</span>
      <span class="att-tag late">متأخر ${ar(st.late)}</span>
      <span class="att-tag excused">معذور ${ar(st.excused)}</span>
      <span class="att-tag absent">غائب ${ar(st.absent)}</span>
    </div>`;
}

function sortRows(rows) {
  const r = rows.slice();
  const k = {
    name: (a, b) => a.name.localeCompare(b.name, "ar"),
    rate: (a, b) => (b.st.rate ?? -1) - (a.st.rate ?? -1),
    hifz: (a, b) => b.st.hifzPages - a.st.hifzPages,
    review: (a, b) => b.st.reviewPages - a.st.reviewPages
  }[sortKey];
  return r.sort(k);
}

function render() {
  if (!data.length) { $("report").innerHTML = '<p class="muted center">لا توجد حلقات</p>'; return; }
  let html = "";
  if (data.length > 1) {
    const all = emptyStats();
    data.forEach((d) => d.records.forEach((r) => addRec(all, r)));
    finish(all);
    html += `<div class="card-box rep-card total"><h3>المجموع الكلي (${ar(data.length)} حلقات)</h3>${statGrid(all)}</div>`;
  }
  data.forEach((d, i) => {
    html += `
      <div class="card-box rep-card">
        <h3>${esc(d.halaqa.name)}</h3>
        ${statGrid(d.stats)}
        <table class="rep-table">
          <thead><tr>
            <th data-sort="name">الطالب ${sortKey === "name" ? "▾" : ""}</th>
            <th data-sort="rate">الحضور ${sortKey === "rate" ? "▾" : ""}</th>
            <th data-sort="hifz">حفظ ${sortKey === "hifz" ? "▾" : ""}</th>
            <th data-sort="review">مراجعة ${sortKey === "review" ? "▾" : ""}</th>
          </tr></thead>
          <tbody>
            ${sortRows(d.rows).map((x) => `
              <tr data-h="${i}" data-s="${x.id}">
                <td class="stu-cell">${esc(x.name)}</td>
                <td>${pct(x.st.rate)}</td>
                <td>${fmt(x.st.hifzPages)}</td>
                <td>${fmt(x.st.reviewPages)}</td>
              </tr>`).join("") || '<tr><td colspan="4" class="muted">لا يوجد طلاب</td></tr>'}
          </tbody>
        </table>
        <p class="hint no-print">الأرقام في عمودي الحفظ والمراجعة = عدد الأوجه. اضغط على اسم الطالب لتفاصيله، وعلى عنوان العمود للترتيب.</p>
      </div>`;
  });
  $("report").innerHTML = html;
}

// ---------- تفاصيل الطالب ----------
function hifzText(h) {
  if (!h) return "";
  let s = h.surah ? surahName(h.surah) : "";
  if (h.from || h.to) s += ` ${h.from ?? ""}${h.to ? "-" + h.to : ""}`;
  if (+h.pages) s += ` (${h.pages} وجه)`;
  if (h.grade) s += ` - ${h.grade}`;
  return s.trim();
}
function reviewText(v) {
  if (!v) return "";
  let s = v.value ? (v.kind === "juz" ? "الجزء " + v.value : surahName(v.value)) : "";
  if (v.from || v.to) s += ` ${v.from ?? ""}${v.to ? "-" + v.to : ""}`;
  if (+v.pages) s += ` (${v.pages} وجه)`;
  if (v.grade) s += ` - ${v.grade}`;
  return s.trim();
}

function studentHTML(d, x) {
  const st = x.st;
  return `
    <div class="stu-report">
      <div class="stu-report-head">
        <img src="logo.png" alt="">
        <div>
          <h3>${esc(x.name)}</h3>
          <div class="muted">${esc(d.halaqa.name)}</div>
          <div class="muted">${esc(range.label)} (${esc(range.sub)})</div>
        </div>
      </div>
      ${statGrid(st)}
      <div class="grades-row">${GRADES.map((g) => `<span>${g}: <b>${ar(st.grades[g])}</b></span>`).join("")}</div>
      <table class="rep-table detail">
        <thead><tr><th>اليوم</th><th>الحضور</th><th>الحفظ</th><th>المراجعة</th></tr></thead>
        <tbody>
          ${x.recs.map((r) => {
            const p = prettyDate(r.date);
            return `<tr>
              <td>${p.day}<br><small class="muted">${esc(p.hijri.replace(/ هـ$/, ""))}</small></td>
              <td>${r.attendance ? `<span class="att-tag ${r.attendance}">${ATT_LABEL[r.attendance]}</span>` : "—"}</td>
              <td>${esc(hifzText(r.hifz)) || "—"}</td>
              <td>${esc(reviewText(r.review)) || "—"}${r.note ? `<div class="note">📝 ${esc(r.note)}</div>` : ""}</td>
            </tr>`;
          }).join("") || '<tr><td colspan="4" class="muted">لا يوجد تسجيل في هذي الفترة</td></tr>'}
        </tbody>
      </table>
    </div>`;
}

document.addEventListener("click", (e) => {
  const th = e.target.closest("th[data-sort]");
  if (th) { sortKey = th.dataset.sort; render(); return; }
  const tr = e.target.closest("tr[data-s]");
  if (tr) {
    const d = data[+tr.dataset.h];
    const x = d.rows.find((r) => r.id === tr.dataset.s);
    currentStudent = { d, x };
    $("stuBody").innerHTML = studentHTML(d, x);
    $("stuModal").showModal();
    $("stuModal").scrollTop = 0;
    document.activeElement && document.activeElement.blur();
  }
});
$("stuClose").onclick = () => $("stuModal").close();
$("stuPrint").onclick = () => {
  const { d, x } = currentStudent;
  $("printArea").innerHTML = studentHTML(d, x);
  $("stuModal").close();
  document.body.classList.add("print-student");
  window.print(); // لازم مباشرة بعد الضغط (الآيفون يمنعها لو تأخرت)
};

// ---------- بطاقة الإنجاز (صورة) ----------
let cardFile = null;
let logoImg = null;

function loadLogo() {
  if (logoImg) return Promise.resolve(logoImg);
  return new Promise((res) => {
    const im = new Image();
    im.onload = () => { logoImg = im; res(im); };
    im.onerror = () => res(null);
    im.src = "logo.png";
  });
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fitText(ctx, text, maxW, size, weight = 700) {
  let s = size;
  do { ctx.font = `${weight} ${s}px Tajawal, sans-serif`; s -= 2; } while (ctx.measureText(text).width > maxW && s > 20);
}

async function drawCard(d, x, msg) {
  await Promise.all([
    document.fonts.load("700 40px Tajawal"), document.fonts.load("500 40px Tajawal"), document.fonts.load("400 40px Tajawal")
  ]).catch(() => {});
  const logo = await loadLogo();
  const W = 1080, H = 1350;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  ctx.direction = "rtl";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const BROWN = "#665527", GOLD = "#bda23b", SOFT = "#f3ecd6", MUTED = "#7a7360";

  // الخلفية والإطار
  ctx.fillStyle = "#faf8f2"; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = GOLD; ctx.lineWidth = 10; rr(ctx, 30, 30, W - 60, H - 60, 40); ctx.stroke();
  ctx.strokeStyle = "rgba(189,162,59,0.4)"; ctx.lineWidth = 3; rr(ctx, 52, 52, W - 104, H - 104, 30); ctx.stroke();

  // الشعار
  if (logo) {
    const lw = 260, lh = lw * (logo.height / logo.width);
    ctx.drawImage(logo, (W - lw) / 2, 90, lw, lh);
  }

  // العنوان
  ctx.fillStyle = GOLD; ctx.font = "700 46px Tajawal, sans-serif";
  ctx.fillText("✦ بطاقة إنجاز ✦", W / 2, 420);

  // اسم الطالب
  ctx.fillStyle = BROWN; fitText(ctx, x.name, W - 200, 84);
  ctx.fillText(x.name, W / 2, 520);
  ctx.fillStyle = MUTED; ctx.font = "500 40px Tajawal, sans-serif";
  ctx.fillText(d.halaqa.name, W / 2, 595);
  ctx.font = "400 34px Tajawal, sans-serif";
  ctx.fillText(range.label.replace(" هـ", ""), W / 2, 650);

  // المربعات الثلاثة
  const st = x.st;
  const boxes = [
    [st.rate === null ? "—" : ar(st.rate) + "٪", "نسبة الحضور"],
    [fmt(st.hifzPages), "وجه حفظ"],
    [fmt(st.reviewPages), "وجه مراجعة"]
  ];
  const bw = 280, bh = 210, gap = 30, bx0 = (W - (bw * 3 + gap * 2)) / 2, by = 720;
  boxes.forEach(([num, label], i) => {
    const bx = W - bx0 - bw - i * (bw + gap); // من اليمين
    ctx.fillStyle = "#ffffff"; rr(ctx, bx, by, bw, bh, 28); ctx.fill();
    ctx.strokeStyle = "#ece6d6"; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = GOLD; rr(ctx, bx, by, bw, 14, 7); ctx.fill();
    ctx.fillStyle = BROWN; ctx.font = "700 76px Tajawal, sans-serif";
    ctx.fillText(num, bx + bw / 2, by + 95);
    ctx.fillStyle = MUTED; ctx.font = "500 34px Tajawal, sans-serif";
    ctx.fillText(label, bx + bw / 2, by + 165);
  });

  // آخر حفظ + الممتاز
  const lastH = x.recs.filter((r) => r.hifz && r.hifz.surah).slice(-1)[0];
  let line = 990;
  ctx.fillStyle = SOFT; rr(ctx, 120, 965, W - 240, lastH || st.grades["ممتاز"] ? 150 : 0, 24); ctx.fill();
  if (lastH) {
    const h = lastH.hifz;
    const t = "آخر ما حفظ: سورة " + surahName(h.surah) + (h.from || h.to ? ` (${ar(h.from ?? "")}${h.to ? "–" + ar(h.to) : ""})` : "");
    ctx.fillStyle = BROWN; fitText(ctx, t, W - 300, 40, 500);
    ctx.fillText(t, W / 2, line + 20); line += 70;
  }
  if (st.grades["ممتاز"]) {
    ctx.fillStyle = BROWN; ctx.font = "500 38px Tajawal, sans-serif";
    ctx.fillText(`حصل على تقدير "ممتاز" ${ar(st.grades["ممتاز"])} مرة 🌟`, W / 2, line + 20);
  }

  // العبارة التشجيعية
  if (msg) {
    ctx.fillStyle = GOLD; fitText(ctx, msg, W - 220, 46);
    ctx.fillText(msg, W / 2, 1180);
  }
  ctx.fillStyle = MUTED; ctx.font = "400 30px Tajawal, sans-serif";
  ctx.fillText("حلقة ابن عقيل لتحفيظ القرآن الكريم", W / 2, 1255);
  return c;
}

async function makeCard() {
  const { d, x } = currentStudent;
  const c = await drawCard(d, x, $("cardMsg").value.trim());
  const blob = await new Promise((r) => c.toBlob(r, "image/png"));
  const fname = `بطاقة-${x.name.replace(/\s+/g, "-")}.png`;
  cardFile = new File([blob], fname, { type: "image/png" });
  const url = URL.createObjectURL(blob);
  $("cardImg").src = url;
  $("cardDownload").href = url;
  $("cardDownload").download = fname;
}

$("stuCard").onclick = async () => {
  $("stuModal").close();
  $("cardImg").removeAttribute("src");
  $("cardModal").showModal();
  document.activeElement && document.activeElement.blur();
  try { await makeCard(); } catch (e) { toast("ما قدرت أسوي البطاقة: " + e.message, true); }
};
let msgTimer;
$("cardMsg").oninput = () => { clearTimeout(msgTimer); msgTimer = setTimeout(makeCard, 500); };
$("cardClose").onclick = () => $("cardModal").close();
$("cardShare").onclick = async () => {
  if (!cardFile) return;
  if (navigator.canShare && navigator.canShare({ files: [cardFile] })) {
    try { await navigator.share({ files: [cardFile] }); } catch {}
  } else {
    $("cardDownload").click();
    toast("نزّلت الصورة، أرسلها من الواتساب");
  }
};

// ---------- التصدير ----------
$("pdfBtn").onclick = () => {
  document.body.classList.remove("print-student");
  window.print();
};

$("xlsBtn").onclick = () => {
  if (typeof XLSX === "undefined") return toast("ما تحملت أداة Excel، حدّث الصفحة", true);
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  const add = (name, rows, widths) => {
    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ "": "لا توجد بيانات" }]);
    if (widths) ws["!cols"] = widths.map((w) => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, name);
  };
  const period = `${range.label} (${range.sub})`;

  add("ملخص الحلقات", data.map((d) => ({
    "الحلقة": d.halaqa.name, "الفترة": period, "عدد اللقاءات": d.stats.days.size,
    "نسبة الحضور %": d.stats.rate ?? "", "نسبة التسميع %": d.stats.hifzRate ?? "", "نسبة المراجعة %": d.stats.reviewRate ?? "",
    "أوجه الحفظ": d.stats.hifzPages, "أوجه المراجعة": d.stats.reviewPages,
    "حاضر": d.stats.present, "متأخر": d.stats.late, "معذور": d.stats.excused, "غائب": d.stats.absent
  })), [24, 30, 12, 13, 14, 14, 11, 12, 7, 7, 7, 7]);

  add("الطلاب", data.flatMap((d) => sortRows(d.rows).map((x) => ({
    "الحلقة": d.halaqa.name, "الطالب": x.name,
    "حاضر": x.st.present, "متأخر": x.st.late, "معذور": x.st.excused, "غائب": x.st.absent,
    "نسبة الحضور %": x.st.rate ?? "",
    "مرات التسميع": x.st.hifzCount, "أوجه الحفظ": x.st.hifzPages,
    "مرات المراجعة": x.st.reviewCount, "أوجه المراجعة": x.st.reviewPages,
    "ممتاز": x.st.grades["ممتاز"], "جيد": x.st.grades["جيد"], "مقبول": x.st.grades["مقبول"], "ضعيف": x.st.grades["ضعيف"]
  }))), [22, 26, 6, 6, 6, 6, 12, 11, 10, 11, 12, 6, 6, 6, 6]);

  add("السجل التفصيلي", data.flatMap((d) => d.records.map((r) => {
    const s = students.find((x) => x.id === r.studentId);
    const h = r.hifz || {}, v = r.review || {};
    return {
      "التاريخ": r.date, "اليوم": DAY_NAMES[parseDate(r.date).getDay()], "الهجري": prettyDate(r.date).hijri,
      "الحلقة": d.halaqa.name, "الطالب": s ? s.name : r.studentName || "",
      "الحضور": ATT_LABEL[r.attendance] || "",
      "سورة الحفظ": h.surah ? surahName(h.surah) : "", "من": h.from ?? "", "إلى": h.to ?? "",
      "أوجه الحفظ": h.pages ?? "", "تقييم الحفظ": h.grade || "",
      "المراجعة": v.value ? (v.kind === "juz" ? "الجزء " + v.value : surahName(v.value)) : "",
      "من ": v.from ?? "", "إلى ": v.to ?? "", "أوجه المراجعة": v.pages ?? "", "تقييم المراجعة": v.grade || "",
      "ملاحظة": r.note || ""
    };
  })), [11, 9, 18, 22, 26, 8, 12, 5, 5, 10, 10, 12, 5, 5, 12, 12, 30]);

  XLSX.writeFile(wb, `تقرير-ابن-عقيل-${range.from}-${range.to}.xlsx`);
};

// ---------- التحكم ----------
document.querySelectorAll("#periodSeg button").forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll("#periodSeg button").forEach((x) => x.classList.remove("on"));
    b.classList.add("on");
    period = b.dataset.p;
    anchor = new Date();
    $("customBox").classList.toggle("hidden", period !== "custom");
    $("prevP").classList.toggle("invisible", period === "custom");
    $("nextP").classList.toggle("invisible", period === "custom");
    load();
  };
});
$("prevP").onclick = () => {
  anchor = period === "week" ? addDays(anchor, -7) : addDays(parseDate(range.from), -1);
  load();
};
$("nextP").onclick = () => {
  anchor = period === "week" ? addDays(anchor, 7) : addDays(parseDate(range.to), 1);
  load();
};
$("fromIn").onchange = load;
$("toIn").onchange = load;
$("halaqaSel").onchange = load;

// ---------- التشغيل ----------
(async () => {
  await requireRole(["admin"]);
  const [hs, ss] = await Promise.all([getDocs(collection(db, "halaqat")), getDocs(collection(db, "students"))]);
  halaqat = hs.docs.map((d) => ({ id: d.id, ...d.data() }))
    .filter((h) => h.active !== false)
    .sort((a, b) => (a.order || 0) - (b.order || 0));
  students = ss.docs.map((d) => ({ id: d.id, ...d.data() }));
  $("halaqaSel").innerHTML = `<option value="all">كل الحلقات</option>` +
    halaqat.map((h) => `<option value="${h.id}">${esc(h.name)}</option>`).join("");
  load();
})();
