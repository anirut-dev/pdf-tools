# PDF Desk

เว็บเครื่องมือจัดการไฟล์ PDF ใช้เอง — ทำงานฝั่ง browser ทั้งหมด (client-side) ไม่มีการอัปโหลดไฟล์ไปเซิร์ฟเวอร์ไหนเลย

**🔗 ใช้งานได้ที่:** https://anirut-dev.github.io/pdf-tools/

![หน้าแรกของ PDF Desk แสดงการ์ด 4 เครื่องมือ: Merge PDF, JPG to PDF, Split PDF, Shrink Images](assets/screenshot.jpg)

## ภาพรวมโปรเจค

- เป็นเว็บ **static HTML/CSS/JS** ล้วน ๆ ไม่มี build step (ไม่ต้อง npm install ก่อนใช้งาน)
- ใช้ไลบรารี [pdf-lib](https://pdf-lib.js.org/) (สำหรับอ่าน/เขียนไฟล์ PDF) โหลดผ่าน CDN (`unpkg.com`)
- ไฟล์ PDF/รูปภาพที่ผู้ใช้เลือก จะถูกประมวลผลในเบราว์เซอร์ของผู้ใช้เองทั้งหมด ไม่ส่งไปที่ไหน

## เทคสแตค

| ส่วน | เทคโนโลยีที่ใช้ |
|---|---|
| โครงสร้างหน้าเว็บ | HTML5 |
| สไตล์ | CSS3 (ไฟล์เดียว ใช้ร่วมกันทุกหน้า: `css/style.css`) |
| ฟอนต์ | Google Fonts — Fraunces (หัวข้อ), Inter (เนื้อหา), JetBrains Mono (ตัวเลข/label) |
| ตรรกะ/การทำงาน | JavaScript (Vanilla ไม่มี framework) |
| จัดการไฟล์ PDF | pdf-lib (โหลดผ่าน CDN) |

## โครงสร้างไฟล์

```
pdf-tools/
├── index.html            # หน้าแรก แสดงการ์ด 4 เครื่องมือ
├── css/
│   └── style.css         # สไตล์ทั้งหมด ใช้ร่วมกันทุกหน้า
├── js/
│   ├── merge.js           # ตรรกะ Merge PDF
│   ├── jpg-to-pdf.js      # ตรรกะ JPG → PDF
│   ├── split.js           # ตรรกะ Split PDF
│   ├── shrink.js          # ตรรกะ Shrink Images
│   ├── pdf-to-jpg.js      # ตรรกะ PDF → JPG
│   ├── html-to-pdf.js     # ตรรกะ HTML → PDF
│   ├── pdf-to-pdfa.js     # ตรรกะ PDF → PDF/A-style
│   └── excel-to-pdf.js    # ตรรกะ Excel → PDF
├── tools/
│   ├── merge.html         # หน้า Merge PDF
│   ├── jpg-to-pdf.html    # หน้า JPG → PDF
│   ├── split.html         # หน้า Split PDF
│   ├── shrink.html        # หน้า Shrink Images
│   ├── pdf-to-jpg.html    # หน้า PDF → JPG
│   ├── html-to-pdf.html   # หน้า HTML → PDF
│   ├── pdf-to-pdfa.html   # หน้า PDF → PDF/A-style
│   └── excel-to-pdf.html  # หน้า Excel → PDF
├── assets/
│   └── screenshot.jpg     # ภาพหน้าจอสำหรับ README
└── docs/
    └── postmortems/       # บันทึกบั๊กที่เจอและแก้แล้ว
```

## สถานะเครื่องมือ (8 อย่าง)

| เครื่องมือ | สถานะ |
|---|---|
| รวมไฟล์ PDF (Merge PDF) | ✅ เสร็จแล้ว ทดสอบแล้ว |
| แปลง JPG → PDF | ✅ เสร็จแล้ว ทดสอบแล้ว |
| แยกหน้า PDF (Split PDF) | ✅ เสร็จแล้ว ทดสอบแล้ว |
| ลดขนาดรูปภาพ (Shrink Images) | ✅ เสร็จแล้ว ทดสอบแล้ว |
| แปลง PDF → JPG | ✅ เสร็จแล้ว ทดสอบแล้ว |
| แปลง HTML → PDF | ✅ เสร็จแล้ว ทดสอบแล้ว |
| แปลง PDF → PDF/A-style (best-effort, ไม่ใช่ PDF/A แบบรับรองมาตรฐาน) | ✅ เสร็จแล้ว ทดสอบแล้ว |
| แปลง Excel → PDF (ดั๊มพ์ข้อมูลตาราง ไม่ใช่ print layout จริง) | ✅ เสร็จแล้ว ทดสอบแล้ว |

## วิธีใช้งาน (dev)

เปิดไฟล์ `index.html` ผ่าน local server (เช่น VS Code Live Server หรือ `npx http-server`) แล้วเข้าเว็บผ่าน `http://localhost:...`

> หมายเหตุ: เปิดไฟล์ตรง ๆ ผ่าน `file://` อาจมีปัญหาเรื่อง CORS กับบางเบราว์เซอร์ แนะนำให้รันผ่าน local server เสมอ

## ดีไซน์

ธีม "โต๊ะทำงานกระดาษ" (paper desk) — พื้นหลังสีกระดาษอุ่น ๆ ตัวอักษรสีหมึกเข้ม และสีส้มแบบตราปั๊ม (stamp) เป็นสีเน้น
- มือถือ: การ์ดเรียงเป็นแถวเดียวแบบแอป
- PC: การ์ดจัดเป็น grid 2 คอลัมน์ (breakpoint ที่ 720px)
