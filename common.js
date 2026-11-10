// أدوات مشتركة بين كل صفحات الموقع
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initializeFirestore, memoryLocalCache, doc, getDoc }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, SITE, ADMIN_EMAILS } from "./config.js?v=5";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// ذاكرة مؤقتة داخل الصفحة: أسرع بكثير في التنقل بين الصفحات (خصوصاً الآيفون)
// ولو انقطع النت، التسجيل ينتظر ويُرسل أول ما يرجع (ما دامت الصفحة مفتوحة)
export const db = initializeFirestore(app, { localCache: memoryLocalCache() });
export { SITE };

export const DAY_NAMES = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

// تاريخ اليوم بصيغة 2026-11-10 (بتوقيت الجهاز)
export function dateStr(d = new Date()) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
export function parseDate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
export function prettyDate(s) {
  const d = parseDate(s);
  const day = DAY_NAMES[d.getDay()];
  let hijri = "";
  try {
    hijri = new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura", { day: "numeric", month: "long", year: "numeric" }).format(d);
  } catch {}
  const greg = new Intl.DateTimeFormat("ar-EG", { day: "numeric", month: "long" }).format(d);
  return { day, hijri, greg };
}

export const normEmail = (e) => (e || "").trim().toLowerCase();

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function login() {
  const p = new GoogleAuthProvider();
  p.setCustomParameters({ prompt: "select_account" });
  return signInWithPopup(auth, p);
}

export function logout() {
  return signOut(auth).then(() => (location.href = "index.html"));
}

// يحدد دور المستخدم: مشرف / معلم / غير مسجل
export async function getRole(user) {
  const email = normEmail(user.email);
  if (ADMIN_EMAILS.map(normEmail).includes(email)) return { role: "admin", email };

  const snap = await getDoc(doc(db, "teachers", email));
  if (snap.exists() && snap.data().active !== false) {
    const teacher = { id: snap.id, ...snap.data() };
    let halaqa = null;
    if (teacher.halaqaId) {
      const h = await getDoc(doc(db, "halaqat", teacher.halaqaId));
      if (h.exists()) halaqa = { id: h.id, ...h.data() };
    }
    return { role: "teacher", email, teacher, halaqa };
  }
  return { role: "none", email };
}

// تستخدمها الصفحات الداخلية: إذا المستخدم مو مسجل أو ما له صلاحية يرجع لصفحة الدخول
export function requireRole(allowed) {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      unsub();
      if (!user) { location.href = "index.html"; return; }
      try {
        const r = await getRole(user);
        if (!allowed.includes(r.role)) { location.href = "index.html"; return; }
        resolve({ user, ...r });
      } catch (e) {
        toast("مشكلة في الاتصال: " + (e.code || e.message), true);
      }
    });
  });
}

export function toast(msg, isError = false) {
  let t = document.getElementById("toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "toast";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.className = "toast show" + (isError ? " error" : "");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => (t.className = "toast"), isError ? 5000 : 2500);
}
