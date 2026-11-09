import { db, requireRole, logout, toast, esc, normEmail, DAY_NAMES } from "./common.js";
import {
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  onSnapshot, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
let halaqat = [];
let teachers = [];
let selectedDays = [];

document.getElementById("logoutBtn").onclick = () => logout();

// ---------- التبويبات ----------
document.querySelectorAll(".tabs button").forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll(".tabs button").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    ["halaqat", "teachers", "settings"].forEach((t) =>
      $("tab-" + t).classList.toggle("hidden", t !== b.dataset.tab));
  };
});

// ---------- النافذة المنبثقة ----------
function openModal(title, bodyHTML) {
  $("modalTitle").textContent = title;
  $("modalBody").innerHTML = bodyHTML;
  const modal = $("modal");
  modal.returnValue = "";
  modal.showModal();
  return new Promise((resolve) => {
    modal.onclose = () => resolve(modal.returnValue === "ok" ? new FormData($("modalForm")) : null);
  });
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

// ---------- الحلقات ----------
function halaqaName(id) {
  const h = halaqat.find((x) => x.id === id);
  return h ? h.name : "بدون حلقة";
}

function renderHalaqat() {
  $("halaqatList").innerHTML = halaqat.map((h) => {
    const ts = teachers.filter((t) => t.halaqaId === h.id && t.active !== false).map((t) => t.name);
    return `
      <div class="item ${h.active === false ? "inactive" : ""}">
        <div class="item-main">
          <div class="item-title">${esc(h.name)} ${h.active === false ? '<span class="badge">موقوفة</span>' : ""}</div>
          <div class="item-sub">${ts.length ? "المعلم: " + esc(ts.join("، ")) : "لا يوجد معلم بعد"}</div>
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
  await updateDoc(doc(db, "halaqat", id), { name });
  toast("تم الحفظ ✅");
}

async function toggleHalaqa(id) {
  const h = halaqat.find((x) => x.id === id);
  const stop = h.active !== false;
  if (stop && !confirm(`إيقاف ${h.name}؟ (ما راح تنحذف بياناتها)`)) return;
  await updateDoc(doc(db, "halaqat", id), { active: !stop });
  toast(stop ? "تم إيقاف الحلقة" : "تم تفعيل الحلقة ✅");
}

// ---------- المعلمون ----------
function halaqaOptions(selected) {
  return halaqat.filter((h) => h.active !== false || h.id === selected)
    .map((h) => `<option value="${h.id}" ${h.id === selected ? "selected" : ""}>${esc(h.name)}</option>`).join("");
}

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
    "edit-h": editHalaqa, "toggle-h": toggleHalaqa,
    "edit-t": editTeacher, "toggle-t": toggleTeacher, "del-t": deleteTeacher
  };
  try { await actions[b.dataset.act](b.dataset.id); }
  catch (err) { toast("ما تم الحفظ: " + (err.code || err.message), true); }
});

// ---------- أيام الحلقة ----------
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

// ---------- التشغيل ----------
(async () => {
  await requireRole(["admin"]);
  try {
    await seedIfEmpty();
  } catch (err) {
    $("loading").textContent = "مشكلة في قاعدة البيانات: " + (err.code || err.message);
    return;
  }
  $("loading").remove();
  $("tab-halaqat").classList.remove("hidden");

  onSnapshot(collection(db, "halaqat"), (snap) => {
    halaqat = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    renderHalaqat(); renderTeachers();
  });
  onSnapshot(collection(db, "teachers"), (snap) => {
    teachers = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => a.name.localeCompare(b.name, "ar"));
    renderHalaqat(); renderTeachers();
  });
  const s = await getDoc(doc(db, "settings", "main"));
  selectedDays = s.exists() ? s.data().days || [] : [];
  renderDays();
})();
