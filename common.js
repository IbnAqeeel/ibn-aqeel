// أدوات مشتركة بين كل صفحات الموقع
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, SITE, ADMIN_EMAILS } from "./config.js";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export { SITE };

export const DAY_NAMES = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

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
