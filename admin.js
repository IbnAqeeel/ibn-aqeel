import { db, requireRole, logout, toast, esc, normEmail, DAY_NAMES } from "./common.js?v=5";
import {
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  onSnapshot, serverTimestamp, writeBatch, query, where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
let halaqat = [];
let teachers = [];
let students = [];
let selectedDays = [];
let studentFilter = "all";

document.getElementById("logoutBtn").onclick = () => logout();

// ---------- التبويبات ----------
const TABS = ["students", "halaqat", "teachers", "settings"];
document.querySelectorAll(".tabs button").forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll(".tabs button").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    TABS.forEach((t) => $("tab-" + t).classList.toggle("hidden", t !== b.dataset.tab));
  };
});

// ---------- النافذة المنبثقة ----------
function openModal(title, bodyHTML, { okText = "حفظ", cancel = true } = {}) {
  $("modalTitle").textContent = title;
  $("modalBody").innerHTML = bodyHTML;
  $("modalOk").textContent = okText;
  $("modalCancel").classList.toggle("hidden", !cancel);
  const modal = $("modal");
  modal.returnValue = "";
  modal.showModal();
  return new Promise((resolve) => {
    modal.onclose = () => resolve(modal.returnValue === "ok" ? new FormData($("modalForm")) : null);
  });
}

// ---------- أدوات ----------
// رابط عشوائي صعب التخمين (٢٢ حرف)
function makeToken(n = 22) {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  return [...crypto.getRandomValues(new Uint8Array(n))].map((x) => a[x % a.length]).join("");
}
function studentLink(token) {
  return location.origin + location.pathname.replace(/[^/]*$/, "") + "s.html?k=" + token;
}
function halaqaName(id) {
  const h = halaqat.find((x) => x.id === id);
  return h ? h.name : "بدون حلقة";
}
function halaqaOptions(selected) {
  return halaqat.filter((h) => h.active !== false || h.id === selected)
    .map((h) => `<option value="${h.id}" ${h.id === selected ? "selected" : ""}>${esc(h.name)}</option>`).join("");
}
// توحيد الكتابة العربية للمقارنة (أ إ آ ← ا ، ة ← ه ، ى ← ي)
function normAr(s) {
  return String(s || "").replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
    .replace(/\s+/g, " ").trim();
}

// ---------- أول تشغيل: إنشاء الحلقتين والأيام الافتراضية ----------
async function seedIfEmpty() {
  const hs = await getDocs(collection(db, "halaqat"));
  if (hs.empty) {
    const batch = writeBatch(db);
    batch.set(doc(collection(db, "halaqat")), { name: "حلقة أبي بكر الصديق", active: true, order: 1, createdAt: serverTimestamp() });
    batch.set(doc(collection(db, "halaqat")), { name: "حلقة عمر بن الخطاب", active: true, order: 2, createdAt: serverTimestamp() });
    await batch.commit();
  }
  const s = await getDoc(doc(db, "settings", "main"));
  if (!s.exists()) {
    await setDoc(doc(db, "settings", "main"), { days: [0, 1, 2, 3] }); // الأحد - الأربعاء
  }
}

// =====================================================
// الطلاب
// =====================================================
function renderStudentFilter() {
  const opts = [{ id: "all", name: "الكل" }, ...halaqat.filter((h) => h.active !== false), { id: "stopped", name: "الموقوفون" }];
  $("studentFilter").innerHTML = opts.map((o) =>
    `<button class="chip ${studentFilter === o.id ? "on" : ""}" data-f="${o.id}">${esc(o.name.replace("حلقة ", ""))}</button>`).join("");
  $("studentFilter").querySelectorAll(".chip").forEach((c) => {
    c.onclick = () => { studentFilter = c.dataset.f; renderStudents(); };
  });
}

function filteredStudents() {
  const q = normAr($("studentSearch").value);
  return students.filter((s) => {
    if (studentFilter === "stopped") { if (s.active !== false) return false; }
    else if (studentFilter !== "all" && s.halaqaId !== studentFilter) return false;
    if (q && !normAr(s.name).includes(q)) return false;
    return true;
  });
}

function renderStudents() {
  renderStudentFilter();
  const list = filteredStudents();
  const activeCount = students.filter((s) => s.active !== false).length;
  $("studentCount").textContent = `${list.length} طالب معروض • ${activeCount} طالب نشط`;
  $("studentsList").innerHTML = list.map((s) => `
    <div class="item ${s.active === false ? "inactive" : ""}">
      <div class="item-main">
        <div class="item-title">${esc(s.name)} ${s.active === false ? '<span class="badge">موقوف</span>' : ""}</div>
        <div class="item-sub">${esc(halaqaName(s.halaqaId))}</div>
      </div>
      <div class="item-actions">
        <button class="small-btn" data-act="link-s" data-id="${s.id}">🔗 الرابط</button>
        <button class="small-btn" data-act="edit-s" data-id="${s.id}">تعديل / نقل</button>
        <button class="small-btn" data-act="toggle-s" data-id="${s.id}">${s.active === false ? "تفعيل" : "إيقاف"}</button>
        <button class="small-btn danger" data-act="del-s" data-id="${s.id}">حذف</button>
      </div>
    </div>`).join("") || '<p class="muted center">لا يوجد طلاب هنا</p>';
}
$("studentSearch").oninput = renderStudents;

// إضافة طالب (مع صفحته العامة)
function addStudentOps(batch, name, halaqaId) {
  const token = makeToken();
  const ref = doc(collection(db, "students"));
  batch.set(ref, { name, halaqaId, active: true, token, createdAt: serverTimestamp() });
  batch.set(doc(db, "portal", token), { studentId: ref.id, name, halaqaId, halaqaName: halaqaName(halaqaId), active: true });
}

$("addStudentBtn").onclick = async () => {
  const f = await openModal("إضافة طالب", `
    <label>اسم الطالب<input name="name" placeholder="الاسم الثلاثي"></label>
    <label>الحلقة<select name="halaqaId">${halaqaOptions(studentFilter !== "all" && studentFilter !== "stopped" ? studentFilter : undefined)}</select></label>`);
  if (!f) return;
  const name = (f.get("name") || "").trim();
  if (!name) return toast("اكتب اسم الطالب", true);
  const batch = writeBatch(db);
  addStudentOps(batch, name, f.get("halaqaId"));
  await batch.commit();
  toast("تمت إضافة الطالب ✅");
};

async function editStudent(id) {
  const s = students.find((x) => x.id === id);
  const f = await openModal("تعديل / نقل الطالب", `
    <label>اسم الطالب<input name="name" value="${esc(s.name)}"></label>
    <label>الحلقة (لنقله اختر حلقة ثانية)<select name="halaqaId">${halaqaOptions(s.halaqaId)}</select></label>`);
  if (!f) return;
  const name = (f.get("name") || "").trim();
  if (!name) return toast("اكتب اسم الطالب", true);
  const halaqaId = f.get("halaqaId");
  const batch = writeBatch(db);
  batch.update(doc(db, "students", id), { name, halaqaId });
  batch.set(doc(db, "portal", s.token), { name, halaqaId, halaqaName: halaqaName(halaqaId) }, { merge: true });
  await batch.commit();
  toast(halaqaId !== s.halaqaId ? "تم نقل الطالب ✅" : "تم الحفظ ✅");
}

async function toggleStudent(id) {
  const s = students.find((x) => x.id === id);
  const stop = s.active !== false;
  if (stop && !confirm(`إيقاف الطالب ${s.name}؟\n(بياناته تبقى محفوظة، وما يظهر في التحضير)`)) return;
  const batch = writeBatch(db);
  batch.update(doc(db, "students", id), { active: !stop });
  batch.set(doc(db, "portal", s.token), { active: !stop }, { merge: true });
  await batch.commit();
  toast(stop ? "تم إيقاف الطالب" : "تم تفعيل الطالب ✅");
}

async function deleteStudent(id) {
  const s = students.find((x) => x.id === id);
  if (!confirm(`حذف الطالب ${s.name} نهائياً؟\nإذا تبي توقفه مؤقتاً استخدم "إيقاف" بدل الحذف.`)) return;
  const batch = writeBatch(db);
  batch.delete(doc(db, "students", id));
  batch.delete(doc(db, "portal", s.token));
  const old = await getDocs(collection(db, "portal", s.token, "records"));
  old.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  toast("تم الحذف");
}

// رابط ولي الأمر
async function showLink(id) {
  const s = students.find((x) => x.id === id);
  const link = studentLink(s.token);
  const msg = `السلام عليكم ورحمة الله،\nهذا رابط متابعة الطالب ${s.name} في ${halaqaName(s.halaqaId)}:\n${link}`;
  await openModal("رابط ولي الأمر", `
    <p class="hint">رابط خاص بـ <b>${esc(s.name)}</b>. يفتحه ولي الأمر ويشوف إنجاز ابنه فقط.</p>
    <input value="${esc(link)}" dir="ltr" readonly onclick="this.select()">
    <div class="link-actions">
      <button type="button" class="btn" id="copyLinkBtn">📋 نسخ الرابط</button>
      <a class="btn whatsapp" target="_blank" href="https://wa.me/?text=${encodeURIComponent(msg)}">إرسال بالواتساب</a>
      <a class="btn secondary" target="_blank" href="${esc(link)}">👁️ فتح الصفحة</a>
      <button type="button" class="small-btn danger" id="newLinkBtn">توليد رابط جديد (يلغي القديم)</button>
    </div>`, { okText: "تم", cancel: false });
}

document.addEventListener("click", async (e) => {
  if (e.target.id === "copyLinkBtn") {
    const input = $("modalBody").querySelector("input");
    try { await navigator.clipboard.writeText(input.value); }
    catch { input.select(); document.execCommand("copy"); }
    toast("تم نسخ الرابط ✅");
  }
  if (e.target.id === "newLinkBtn") {
    const link = $("modalBody").querySelector("input").value;
    const s = students.find((x) => link.endsWith(x.token));
    if (!s || !confirm("الرابط القديم بيتوقف عن العمل. متأكد؟")) return;
    const token = makeToken();
    const batch = writeBatch(db);
    batch.set(doc(db, "portal", token),
      { studentId: s.id, name: s.name, halaqaId: s.halaqaId, halaqaName: halaqaName(s.halaqaId), active: s.active !== false });
    batch.delete(doc(db, "portal", s.token));
    // ننقل سجل الطالب للرابط الجديد
    const old = await getDocs(collection(db, "portal", s.token, "records"));
    old.forEach((d) => {
      batch.set(doc(db, "portal", token, "records", d.id), d.data());
      batch.delete(d.ref);
    });
    batch.update(doc(db, "students", s.id), { token });
    await batch.commit();
    $("modal").close();
    toast("تم توليد رابط جديد ✅");
  }
});

// تصدير كل الروابط في ملف Excel
$("exportLinksBtn").onclick = () => {
  const rows = students
    .sort((a, b) => halaqaName(a.halaqaId).localeCompare(halaqaName(b.halaqaId), "ar") || a.name.localeCompare(b.name, "ar"))
    .map((s) => ({
      "الاسم": s.name,
      "الحلقة": halaqaName(s.halaqaId),
      "الحالة": s.active === false ? "موقوف" : "نشط",
      "رابط ولي الأمر": studentLink(s.token)
    }));
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [{ wch: 28 }, { wch: 22 }, { wch: 8 }, { wch: 70 }];
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, ws, "الطلاب");
  XLSX.writeFile(wb, "روابط-طلاب-ابن-عقيل.xlsx");
};

// ---------- الاستيراد من Excel ----------
const STOP_WORDS = ["حلقه", "بن", "ابو", "ابي", "ابا", "الصديق"];
function matchHalaqa(text) {
  const t = normAr(text);
  if (!t) return null;
  const words = t.split(" ").filter((w) => w.length >= 2 && !STOP_WORDS.includes(w));
  const active = halaqat.filter((h) => h.active !== false);
  return active.find((h) => normAr(h.name) === t || normAr(h.name).includes(t))
    || active.find((h) => normAr(h.name).split(" ").some((w) => words.includes(w)))
    || null;
}

$("importBtn").onclick = () => { $("importFile").value = ""; $("importFile").click(); };

$("importFile").onchange = async () => {
  const file = $("importFile").files[0];
  if (!file) return;
  let wb;
  try {
    wb = XLSX.read(await file.arrayBuffer());
  } catch {
    return toast("ما قدرت أقرأ الملف. تأكد إنه ملف Excel", true);
  }

  // نقرأ كل الأوراق (الشيتات) في الملف
  const preview = [];
  const sheetInfo = [];
  for (const sheetName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "" });
    // نبحث عن صف العناوين (اللي فيه كلمة "اسم")
    const headerRow = rows.findIndex((r) => r.some((c) => normAr(c).includes("اسم")));
    let nameCol = 0, halaqaCol = -1;
    if (headerRow >= 0) {
      nameCol = rows[headerRow].findIndex((c) => normAr(c).includes("اسم"));
      halaqaCol = rows[headerRow].findIndex((c) => normAr(c).includes("حلق"));
    }
    // إذا اسم الورقة فيه اسم حلقة، نستخدمه
    const sheetHalaqa = matchHalaqa(sheetName);
    const data = rows.slice(headerRow + 1)
      .map((r) => ({
        name: String(r[nameCol] || "").trim(),
        halaqa: (halaqaCol >= 0 && matchHalaqa(r[halaqaCol])) || sheetHalaqa
      }))
      .filter((r) => r.name && !normAr(r.name).includes("اسم"));
    if (data.length) sheetInfo.push(`${esc(sheetName)}: ${data.length}`);
    preview.push(...data);
  }
  if (!preview.length) return toast("ما لقيت أسماء في الملف", true);

  const existing = new Set(students.map((s) => normAr(s.name) + "|" + s.halaqaId));
  const unknown = preview.filter((r) => !r.halaqa).length;

  const f = await openModal("استيراد الطلاب", `
    <p class="hint">لقيت <b>${preview.length}</b> اسم في الملف (${sheetInfo.join(" • ")}).
    ${unknown ? `فيه <b>${unknown}</b> طالب ما عرفت حلقته، بينضافون للحلقة اللي تختارها تحت.` : "عرفت حلقة كل الطلاب ✅"}</p>
    <label>الحلقة الافتراضية<select name="defaultHalaqa">${halaqaOptions()}</select></label>
    <div class="preview">
      ${preview.map((r) => `<div class="preview-row"><span>${esc(r.name)}</span><span class="${r.halaqa ? "" : "warn"}">${r.halaqa ? esc(r.halaqa.name.replace("حلقة ", "")) : "← الافتراضية"}</span></div>`).join("")}
    </div>`, { okText: "استيراد" });
  if (!f) return;

  const def = f.get("defaultHalaqa");
  let added = 0, skipped = 0;
  let batch = writeBatch(db), ops = 0;
  for (const r of preview) {
    const hId = r.halaqa ? r.halaqa.id : def;
    const key = normAr(r.name) + "|" + hId;
    if (existing.has(key)) { skipped++; continue; }
    existing.add(key);
    addStudentOps(batch, r.name, hId);
    added++; ops += 2;
    if (ops >= 400) { await batch.commit(); batch = writeBatch(db); ops = 0; }
  }
  if (ops) await batch.commit();
  toast(`تمت إضافة ${added} طالب ✅` + (skipped ? ` • تخطيت ${skipped} مكرر` : ""));
};

// =====================================================
// الحلقات
// =====================================================
function renderHalaqat() {
  $("halaqatList").innerHTML = halaqat.map((h) => {
    const ts = teachers.filter((t) => t.halaqaId === h.id && t.active !== false).map((t) => t.name);
    const count = students.filter((s) => s.halaqaId === h.id && s.active !== false).length;
    return `
      <div class="item ${h.active === false ? "inactive" : ""}">
        <div class="item-main">
          <div class="item-title">${esc(h.name)} ${h.active === false ? '<span class="badge">موقوفة</span>' : ""}</div>
          <div class="item-sub">${ts.length ? "المعلم: " + esc(ts.join("، ")) : "لا يوجد معلم بعد"} • ${count} طالب</div>
        </div>
        <div class="item-actions">
          <button class="small-btn" data-act="edit-h" data-id="${h.id}">تعديل</button>
          <button class="small-btn" data-act="toggle-h" data-id="${h.id}">${h.active === false ? "تفعيل" : "إيقاف"}</button>
        </div>
      </div>`;
  }).join("") || '<p class="muted center">لا توجد حلقات</p>';
}

$("addHalaqaBtn").onclick = async () => {
  const f = await openModal("إضافة حلقة", `
    <label>اسم الحلقة<input name="name" placeholder="مثال: حلقة عثمان بن عفان"></label>`);
  if (!f) return;
  const name = (f.get("name") || "").trim();
  if (!name) return toast("اكتب اسم الحلقة", true);
  await addDoc(collection(db, "halaqat"), { name, active: true, order: halaqat.length + 1, createdAt: serverTimestamp() });
  toast("تمت إضافة الحلقة ✅");
};

async function editHalaqa(id) {
  const h = halaqat.find((x) => x.id === id);
  const f = await openModal("تعديل الحلقة", `
    <label>اسم الحلقة<input name="name" value="${esc(h.name)}"></label>`);
  if (!f) return;
  const name = (f.get("name") || "").trim();
  if (!name) return toast("اكتب اسم الحلقة", true);
  const batch = writeBatch(db);
  batch.update(doc(db, "halaqat", id), { name });
  // تحديث اسم الحلقة في صفحات الطلاب
  const snap = await getDocs(query(collection(db, "students"), where("halaqaId", "==", id)));
  snap.forEach((d) => batch.set(doc(db, "portal", d.data().token), { halaqaName: name }, { merge: true }));
  await batch.commit();
  toast("تم الحفظ ✅");
}

async function toggleHalaqa(id) {
  const h = halaqat.find((x) => x.id === id);
  const stop = h.active !== false;
  if (stop && !confirm(`إيقاف ${h.name}؟ (ما راح تنحذف بياناتها)`)) return;
  await updateDoc(doc(db, "halaqat", id), { active: !stop });
  toast(stop ? "تم إيقاف الحلقة" : "تم تفعيل الحلقة ✅");
}

// =====================================================
// المعلمون
// =====================================================
function renderTeachers() {
  $("teachersList").innerHTML = teachers.map((t) => `
    <div class="item ${t.active === false ? "inactive" : ""}">
      <div class="item-main">
        <div class="item-title">${esc(t.name)} ${t.active === false ? '<span class="badge">موقوف</span>' : ""}</div>
        <div class="item-sub">${esc(halaqaName(t.halaqaId))}</div>
        <div class="item-sub ltr">${esc(t.email)}</div>
      </div>
      <div class="item-actions">
        <button class="small-btn" data-act="edit-t" data-id="${t.id}">تعديل</button>
        <button class="small-btn" data-act="toggle-t" data-id="${t.id}">${t.active === false ? "تفعيل" : "إيقاف"}</button>
        <button class="small-btn danger" data-act="del-t" data-id="${t.id}">حذف</button>
      </div>
    </div>`).join("") || '<p class="muted center">ما أضفت معلمين بعد</p>';
}

$("addTeacherBtn").onclick = async () => {
  const f = await openModal("إضافة معلم", `
    <label>اسم المعلم<input name="name" placeholder="مثال: ممدوح علي"></label>
    <label>إيميل Gmail<input name="email" type="email" dir="ltr" placeholder="name@gmail.com" autocapitalize="off"></label>
    <label>الحلقة<select name="halaqaId">${halaqaOptions()}</select></label>`);
  if (!f) return;
  const name = (f.get("name") || "").trim();
  const email = normEmail(f.get("email"));
  if (!name) return toast("اكتب اسم المعلم", true);
  if (!email.includes("@")) return toast("اكتب إيميل صحيح", true);
  const ref = doc(db, "teachers", email);
  if ((await getDoc(ref)).exists()) return toast("هذا الإيميل مضاف من قبل", true);
  await setDoc(ref, { name, email, halaqaId: f.get("halaqaId"), active: true, createdAt: serverTimestamp() });
  toast("تمت إضافة المعلم ✅");
};

async function editTeacher(id) {
  const t = teachers.find((x) => x.id === id);
  const f = await openModal("تعديل المعلم", `
    <label>اسم المعلم<input name="name" value="${esc(t.name)}"></label>
    <label>الإيميل<input value="${esc(t.email)}" dir="ltr" disabled></label>
    <p class="hint">لتغيير الإيميل: احذف المعلم وأضفه من جديد.</p>
    <label>الحلقة<select name="halaqaId">${halaqaOptions(t.halaqaId)}</select></label>`);
  if (!f) return;
  const name = (f.get("name") || "").trim();
  if (!name) return toast("اكتب اسم المعلم", true);
  await updateDoc(doc(db, "teachers", id), { name, halaqaId: f.get("halaqaId") });
  toast("تم الحفظ ✅");
}

async function toggleTeacher(id) {
  const t = teachers.find((x) => x.id === id);
  const stop = t.active !== false;
  await updateDoc(doc(db, "teachers", id), { active: !stop });
  toast(stop ? "تم إيقاف المعلم" : "تم تفعيل المعلم ✅");
}

async function deleteTeacher(id) {
  const t = teachers.find((x) => x.id === id);
  if (!confirm(`حذف المعلم ${t.name}؟`)) return;
  await deleteDoc(doc(db, "teachers", id));
  toast("تم الحذف");
}

// ---------- أزرار القوائم ----------
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const actions = {
    "link-s": showLink, "edit-s": editStudent, "toggle-s": toggleStudent, "del-s": deleteStudent,
    "edit-h": editHalaqa, "toggle-h": toggleHalaqa,
    "edit-t": editTeacher, "toggle-t": toggleTeacher, "del-t": deleteTeacher
  };
  try { await actions[b.dataset.act](b.dataset.id); }
  catch (err) { toast("ما تم الحفظ: " + (err.code || err.message), true); }
});

// =====================================================
// أيام الحلقة
// =====================================================
function renderDays() {
  $("daysBox").innerHTML = DAY_NAMES.map((d, i) =>
    `<button class="chip ${selectedDays.includes(i) ? "on" : ""}" data-day="${i}">${d}</button>`).join("");
  $("daysBox").querySelectorAll(".chip").forEach((c) => {
    c.onclick = () => {
      const d = +c.dataset.day;
      selectedDays = selectedDays.includes(d) ? selectedDays.filter((x) => x !== d) : [...selectedDays, d].sort();
      renderDays();
    };
  });
}

$("saveDaysBtn").onclick = async () => {
  try {
    await setDoc(doc(db, "settings", "main"), { days: selectedDays }, { merge: true });
    toast("تم حفظ الأيام ✅");
  } catch (err) { toast("ما تم الحفظ: " + (err.code || err.message), true); }
};

// =====================================================
// التشغيل
// =====================================================
function renderAll() { renderStudents(); renderHalaqat(); renderTeachers(); }

(async () => {
  await requireRole(["admin"]);
  try {
    await seedIfEmpty();
  } catch (err) {
    $("loading").textContent = "مشكلة في قاعدة البيانات: " + (err.code || err.message);
    return;
  }
  $("loading").remove();
  $("tab-students").classList.remove("hidden");

  const onErr = (err) => toast("مشكلة في القراءة: " + err.code, true);
  onSnapshot(collection(db, "halaqat"), (snap) => {
    halaqat = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    renderAll();
  }, onErr);
  onSnapshot(collection(db, "teachers"), (snap) => {
    teachers = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => a.name.localeCompare(b.name, "ar"));
    renderAll();
  }, onErr);
  onSnapshot(collection(db, "students"), (snap) => {
    students = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => a.name.localeCompare(b.name, "ar"));
    renderAll();
  }, onErr);

  const s = await getDoc(doc(db, "settings", "main"));
  selectedDays = s.exists() ? s.data().days || [] : [];
  renderDays();

  // تحديث لمرة وحدة: نضيف رقم الحلقة لصفحات الطلاب القديمة
  if (!s.exists() || s.data().portalV !== 2) {
    const hs = await getDocs(collection(db, "halaqat"));
    const names = Object.fromEntries(hs.docs.map((d) => [d.id, d.data().name]));
    const st = await getDocs(collection(db, "students"));
    const batch = writeBatch(db);
    st.forEach((d) => {
      const x = d.data();
      batch.set(doc(db, "portal", x.token),
        { studentId: d.id, name: x.name, halaqaId: x.halaqaId, halaqaName: names[x.halaqaId] || "", active: x.active !== false },
        { merge: true });
    });
    batch.set(doc(db, "settings", "main"), { portalV: 2 }, { merge: true });
    await batch.commit();
  }
})();
