# Lab Analysis Tracker

ระบบติดตามความคืบหน้างานวิเคราะห์ ต่อกับ Firebase Realtime Database
(ข้อมูล sync แบบเรียลไทม์ ทุกคนที่เปิดเว็บนี้เห็นข้อมูลเดียวกันทันที)

## รันบนเครื่องตัวเอง (ทดสอบ)

```bash
npm install
npm run dev
```

จะเปิดที่ `http://localhost:5173`

## Deploy ขึ้นเว็บจริง (แนะนำ Vercel)

1. Push โปรเจกต์นี้ขึ้น GitHub repo
2. ไปที่ https://vercel.com → New Project → เลือก repo นี้
3. Vercel จะ detect ว่าเป็น Vite ให้อัตโนมัติ (Build command: `npm run build`, Output: `dist`) — กด Deploy ได้เลย

หรือใช้ Netlify แบบเดียวกัน (Build command: `npm run build`, Publish directory: `dist`)

## ⚠️ ก่อนใช้งานจริงกับทีม — ต้องแก้ Firebase Rules

ตอนนี้ Rules เปิดให้ **อ่าน/เขียนได้ทุกคนบนโลก** (public) เพื่อให้ทดสอบง่าย
ก่อนใช้งานจริง ควรจำกัดสิทธิ์ อย่างน้อยที่สุดควรเปิด **Authentication** แล้วเปลี่ยน rule เป็น:

```json
{
  "rules": {
    ".read": "auth != null",
    ".write": "auth != null"
  }
}
```

แล้วเพิ่ม sign-in (เช่น Google Sign-In หรือ Email link) ในแอป — บอกได้ถ้าต้องการให้ช่วยทำส่วนนี้

## โครงสร้างข้อมูลใน Firebase

```
jobs/
  LAB6907001/
    jobNo: "LAB6907001"
    sample: "Soil-01"
    createdAt: 1234567890
    parameters:
      - id, name, analyst, status, start, finish, ...
```

## ไฟล์สำคัญ

- `src/firebase.js` — การตั้งค่าเชื่อมต่อ Firebase (มี config ของโปรเจกต์อยู่แล้ว)
- `src/App.jsx` — ตัวแอปทั้งหมด (Dashboard / Jobs / Analysts)
