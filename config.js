// إعدادات الاتصال بـ Firebase (هذي البيانات مو سرية، عادي تكون ظاهرة)
export const firebaseConfig = {
  apiKey: "AIzaSyBe2fxLasTsMpjJ3Jf1VJVCR-UTVM4Wxp8",
  authDomain: "ibn-aqeel.firebaseapp.com",
  projectId: "ibn-aqeel",
  storageBucket: "ibn-aqeel.firebasestorage.app",
  messagingSenderId: "518270885794",
  appId: "1:518270885794:web:362e5a4fe11ecafeff5cfb"
};

// اسم الموقع والشعار: لتغيير الشعار ارفع صورة جديدة بنفس الاسم logo.png
export const SITE = {
  name: "حلقة ابن عقيل",
  logo: "logo.png"
};

// إيميلات المشرفين (لازم تكون نفسها في قواعد الحماية firestore.rules)
export const ADMIN_EMAILS = [
  "youseffsalemm29@gmail.com"
];
