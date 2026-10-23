// =====================================================================================
// KIỂM THỬ HỘP ĐEN CHỨC NĂNG ĐẶT LỊCH KHÁM  (POST /api/dat-lich)  - Nhóm 10
// Chỉ dựa trên đặc tả (dữ liệu vào -> kết quả ra), gọi API thật qua HTTP, không đọc mã nguồn khi chấm kết quả.
// Yêu cầu: Node 18+, server đang chạy (npm start) và đã import database.sql.
// Chạy:   node blackbox-datlich.js            (mặc định http://localhost:3000)
//         $env:BASE_URL="http://localhost:3000"; node blackbox-datlich.js
// Kết quả: in ra màn hình + ghi blackbox-results.json + blackbox-report.html (mở bằng trình duyệt để chụp)
// =====================================================================================
const fs = require("fs");
const BASE = process.env.BASE_URL || "http://localhost:3000";

// ---------- tiện ích ----------
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dmy = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
const plusDays = (n) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return d; };
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const randomTime = () => `${pad(rnd(7, 17))}:${pad(rnd(0, 59))}`;

// Mỗi lần gọi slot() trả về một ngày khám MỚI trong tương lai xa -> các test không đụng nhau, chạy lại nhiều lần vẫn được
const baseOffset = rnd(120, 600);
let slotCounter = 0;
const slot = (gio) => { slotCounter += 1; const d = plusDays(baseOffset + slotCounter); return { date: d, ngay: ymd(d), gio: gio || randomTime() }; };

async function call(method, url, { token, body, raw, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  let payload;
  if (raw !== undefined) payload = raw;
  else if (body !== undefined) { h["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  const r = await fetch(BASE + url, { method, headers: h, body: payload });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch (_) {}
  return { status: r.status, json, text };
}
const book = (body, token) => call("POST", "/api/dat-lich", { token, body });
const login = async (sdt, matkhau) => (await call("POST", "/login", { body: { sdt, matkhau } })).json?.token;
const myAppointments = async (token, id) => (await call("GET", `/api/lich-user/${id}`, { token })).json || [];
const describe = (r) => `HTTP ${r.status}${r.json && r.json.message ? " - " + r.json.message : ""}`;
const body0 = (s, over = {}) => ({ hoTen: "Nguyen Van A", lyDo: "Kham tong quat", idBacSi: 1, idKhoa: 1, ngayKham: s.ngay, gioKham: s.gio, ...over });
const without = (o, k) => { const c = { ...o }; delete c[k]; return c; };

// kết quả mỗi case: { pass, actual }
const expectStatus = (r, status, msgRe) => {
  const pass = r.status === status && (!msgRe || (r.json && msgRe.test(r.json.message || "")));
  return { pass, actual: describe(r) };
};

// ---------- danh sách test case ----------
const C = [];
const T = (id, group, tech, name, input, expected, run) => C.push({ id, group, tech, name, input, expected, run });
const G = {
  auth: "1. Xác thực & phân quyền", main: "2. Luồng chính & dữ liệu lưu", eq: "3. Dữ liệu bắt buộc", date: "4. Ngày khám",
  time: "5. Giờ khám", doc: "6. Bác sĩ (idBacSi)", dep: "7. Khoa (idKhoa)", len: "8. Họ tên / lý do", dup: "9. Trùng lịch & trạng thái", guess: "10. Đoán lỗi & bảo mật",
};
const EP = "Phân vùng tương đương", BVA = "Giá trị biên", DT = "Bảng quyết định", ST = "Chuyển trạng thái", EG = "Đoán lỗi", SC = "Kịch bản";

// 1. Xác thực / phân quyền
T("BB01", G.auth, DT, "Không gửi token", "Không có header Authorization", "401 - chưa xác thực", async (x) => expectStatus(await book(body0(slot())), 401));
T("BB02", G.auth, DT, "Header chỉ có chữ Bearer", "Authorization: Bearer", "401 - chưa xác thực", async () => expectStatus(await call("POST", "/api/dat-lich", { headers: { Authorization: "Bearer" }, body: body0(slot()) }), 401));
T("BB03", G.auth, DT, "Token giả", "Authorization: Bearer abc.def.ghi", "403 - token không hợp lệ", async () => expectStatus(await book(body0(slot()), "abc.def.ghi"), 403));
T("BB04", G.auth, DT, "Tài khoản admin đặt lịch", "Token admin + dữ liệu hợp lệ", "403 - chỉ khách hàng được đặt lịch", async (x) => expectStatus(await book(body0(slot()), x.admin), 403));
T("BB05", G.auth, DT, "Khách hàng đặt lịch hợp lệ", "Token khách + dữ liệu hợp lệ", "200 - đặt thành công, có idLichKham", async (x) => {
  const r = await book(body0(slot()), x.A);
  return { pass: r.status === 200 && r.json.success === true && Number.isInteger(r.json.idLichKham), actual: describe(r) };
});

// 2. Luồng chính
T("BB06", G.main, SC, "Lịch vừa đặt xuất hiện trong danh sách lịch của khách, trạng thái 'chờ xác nhận'", "Đặt lịch rồi gọi GET /api/lich-user/1", "Có bản ghi: đúng bác sĩ, ngày, giờ, hoTen; trạng thái 'chờ xác nhận'", async (x) => {
  const s = slot("10:30"); const r = await book(body0(s), x.A);
  const mine = (await myAppointments(x.A, 1)).find((l) => l.idLichKham === r.json.idLichKham);
  const pass = r.status === 200 && !!mine && mine.trangThai === "chờ xác nhận" && mine.ngayKham.slice(0, 10) === s.ngay && mine.gioKham.slice(0, 5) === "10:30" && mine.idBacSi === 1 && mine.hoTen === "Nguyen Van A";
  return { pass, actual: mine ? `HTTP 200; ${mine.ngayKham.slice(0, 10)} ${mine.gioKham}; ${mine.trangThai}` : describe(r) };
});
T("BB07", G.main, EP, "Không gửi idKhoa (chọn 'tất cả chuyên khoa')", "Bỏ trường idKhoa, idBacSi=3 (khoa Ngoại)", "200; lịch lưu với khoa của bác sĩ (idKhoa=2)", async (x) => {
  const r = await book(without(body0(slot(), { idBacSi: 3 }), "idKhoa"), x.A);
  const mine = (await myAppointments(x.A, 1)).find((l) => l.idLichKham === r.json?.idLichKham);
  return { pass: r.status === 200 && !!mine && mine.idKhoa === 2, actual: mine ? `HTTP 200; idKhoa lưu = ${mine.idKhoa}` : describe(r) };
});
T("BB08", G.main, EP, "Không gửi lý do khám (trường tùy chọn)", "Bỏ trường lyDo", "200 - đặt thành công", async (x) => expectStatus(await book(without(body0(slot()), "lyDo"), x.A), 200));
T("BB09", G.main, EP, "Ngày khám định dạng dd/mm/yyyy", "ngayKham = dd/mm/yyyy của một ngày tương lai", "200; lưu đúng ngày", async (x) => {
  const s = slot(); const r = await book(body0(s, { ngayKham: dmy(s.date) }), x.A);
  const mine = (await myAppointments(x.A, 1)).find((l) => l.idLichKham === r.json?.idLichKham);
  return { pass: r.status === 200 && !!mine && mine.ngayKham.slice(0, 10) === s.ngay, actual: mine ? `HTTP 200; lưu ${mine.ngayKham.slice(0, 10)}` : describe(r) };
});
T("BB10", G.main, EP, "Họ tên tiếng Việt có dấu", "hoTen = 'Nguyễn Thị Ánh Tuyết'", "200; tên lưu đúng, không lỗi font", async (x) => {
  const r = await book(body0(slot(), { hoTen: "Nguyễn Thị Ánh Tuyết" }), x.A);
  const mine = (await myAppointments(x.A, 1)).find((l) => l.idLichKham === r.json?.idLichKham);
  return { pass: r.status === 200 && !!mine && mine.hoTen === "Nguyễn Thị Ánh Tuyết", actual: mine ? `HTTP 200; hoTen = ${mine.hoTen}` : describe(r) };
});

// 3. Dữ liệu bắt buộc
for (const [i, f] of ["hoTen", "idBacSi", "ngayKham", "gioKham"].entries()) {
  T(`BB${11 + i}`, G.eq, EP, `Thiếu trường bắt buộc ${f}`, `Bỏ trường ${f}`, "400 - Thiếu thông tin đặt lịch", async (x) => expectStatus(await book(without(body0(slot()), f), x.A), 400, /Thiếu/));
}
T("BB15", G.eq, EP, "Body rỗng {}", "{}", "400 - Thiếu thông tin đặt lịch", async (x) => expectStatus(await book({}, x.A), 400, /Thiếu/));
T("BB16", G.eq, EP, "Họ tên là chuỗi rỗng", "hoTen = \"\"", "400", async (x) => expectStatus(await book(body0(slot(), { hoTen: "" }), x.A), 400));

// 4. Ngày khám - giá trị biên
T("BB17", G.date, BVA, "Ngày hôm qua (biên dưới - 1)", "ngayKham = hôm qua", "400 - không thể đặt lịch quá khứ", async (x) => expectStatus(await book(body0(slot(), { ngayKham: ymd(plusDays(-1)) }), x.A), 400, /quá khứ/));
T("BB18", G.date, BVA, "Ngày hôm nay (biên)", "ngayKham = hôm nay", "200 - đặt thành công", async (x) => expectStatus(await book(body0(slot(), { ngayKham: ymd(plusDays(0)) }), x.A), 200));
T("BB19", G.date, BVA, "Ngày mai (biên + 1)", "ngayKham = ngày mai", "200 - đặt thành công", async (x) => expectStatus(await book(body0(slot(), { ngayKham: ymd(plusDays(1)) }), x.A), 200));
T("BB20", G.date, BVA, "Ngày không tồn tại 31/02", "ngayKham = 31/02/<năm sau>", "400 - ngày không hợp lệ", async (x) => expectStatus(await book(body0(slot(), { ngayKham: `31/02/${new Date().getFullYear() + 1}` }), x.A), 400));
T("BB21", G.date, BVA, "29/02 của năm không nhuận", "ngayKham = 29/02/2027", "400 - ngày không hợp lệ", async (x) => expectStatus(await book(body0(slot(), { ngayKham: "29/02/2027" }), x.A), 400));
T("BB22", G.date, BVA, "29/02 của năm nhuận (tương lai)", "ngayKham = 29/02 của năm nhuận gần nhất", "200 - đặt thành công", async (x) => {
  let y = new Date().getFullYear() + 1; while (!((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0)) y++;
  return expectStatus(await book(body0(slot(), { ngayKham: `${y}-02-29` }), x.A), 200);
});
T("BB23", G.date, EP, "Ngày sai định dạng (chữ)", "ngayKham = 'abc'", "400 - ngày không hợp lệ", async (x) => expectStatus(await book(body0(slot(), { ngayKham: "abc" }), x.A), 400));
T("BB24", G.date, BVA, "Tháng 13", "ngayKham = <năm sau>-13-01", "400 - ngày không hợp lệ", async (x) => expectStatus(await book(body0(slot(), { ngayKham: `${new Date().getFullYear() + 1}-13-01` }), x.A), 400));

// 5. Giờ khám - giá trị biên
const timeCase = (id, gio, status, name, tech = BVA) => T(id, G.time, tech, name, `gioKham = "${gio}"`, status === 200 ? "200 - đặt thành công" : "400 - giờ không hợp lệ", async (x) => expectStatus(await book(body0(slot(), { gioKham: gio }), x.A), status));
timeCase("BB25", "00:00", 200, "Giờ nhỏ nhất 00:00");
timeCase("BB26", "23:59", 200, "Giờ lớn nhất 23:59");
timeCase("BB27", "24:00", 400, "Giờ 24:00 (ngoài biên trên)");
timeCase("BB28", "23:60", 400, "Phút 60 (ngoài biên trên)");
timeCase("BB29", "9:00", 400, "Giờ thiếu số 0 đứng đầu", EP);
timeCase("BB30", "abc", 400, "Giờ là chuỗi chữ", EP);

// 6. idBacSi
const docCase = (id, v, status, name, tech, expText) => T(id, G.doc, tech, name, `idBacSi = ${JSON.stringify(v)}${id === "BB36" ? ", bỏ idKhoa" : ""}`, expText || (status === 200 ? "200 - đặt thành công" : "400"), async (x) => {
  let b = body0(slot(), { idBacSi: v }); if (id === "BB36") b = without(b, "idKhoa");
  return expectStatus(await book(b, x.A), status);
});
docCase("BB31", 0, 400, "idBacSi = 0 (dưới biên)", BVA, "400 - bị từ chối (ID không hợp lệ hoặc thiếu)");
docCase("BB32", -1, 400, "idBacSi âm", BVA, "400 - ID bác sĩ không hợp lệ");
docCase("BB33", "abc", 400, "idBacSi là chữ", EP, "400 - ID bác sĩ không hợp lệ");
docCase("BB34", 1.5, 400, "idBacSi là số thập phân", EP, "400 - ID bác sĩ không hợp lệ");
docCase("BB35", 7, 400, "idBacSi = 7 (lớn nhất có là 6, không tồn tại)", BVA, "400 - bác sĩ không tồn tại");
docCase("BB36", 6, 200, "idBacSi = 6 (biên trên hợp lệ, thuộc khoa 5)", BVA, "200 - đặt thành công");
docCase("BB37", "1e0", 400, "idBacSi viết dạng khoa học '1e0'", EG, "400 - ID không hợp lệ (không phải số nguyên dạng thập phân)");

// 7. idKhoa
T("BB38", G.dep, EP, "Bác sĩ và khoa khớp nhau", "idBacSi=3, idKhoa=2", "200 - đặt thành công", async (x) => expectStatus(await book(body0(slot(), { idBacSi: 3, idKhoa: 2 }), x.A), 200));
T("BB39", G.dep, EP, "Bác sĩ không thuộc khoa đã chọn", "idBacSi=1 (khoa 1), idKhoa=2", "400 - bác sĩ không thuộc khoa", async (x) => expectStatus(await book(body0(slot(), { idBacSi: 1, idKhoa: 2 }), x.A), 400, /không thuộc khoa/));
T("BB40", G.dep, EP, "Khoa không tồn tại", "idBacSi=1, idKhoa=99", "400", async (x) => expectStatus(await book(body0(slot(), { idKhoa: 99 }), x.A), 400));

// 8. Họ tên / lý do
T("BB41", G.len, BVA, "Họ tên 1 ký tự (biên dưới)", "hoTen = 'A'", "200 - đặt thành công", async (x) => expectStatus(await book(body0(slot(), { hoTen: "A" }), x.A), 200));
T("BB42", G.len, BVA, "Họ tên 100 ký tự (biên trên của cột VARCHAR(100))", "hoTen dài 100 ký tự", "200 - đặt thành công", async (x) => expectStatus(await book(body0(slot(), { hoTen: "A".repeat(100) }), x.A), 200));
T("BB43", G.len, BVA, "Họ tên 101 ký tự (vượt biên trên)", "hoTen dài 101 ký tự", "400 - báo lỗi dữ liệu, không được lỗi máy chủ", async (x) => expectStatus(await book(body0(slot(), { hoTen: "A".repeat(101) }), x.A), 400));
T("BB44", G.len, EP, "Họ tên chỉ gồm khoảng trắng", "hoTen = '   '", "400 - thiếu họ tên", async (x) => expectStatus(await book(body0(slot(), { hoTen: "   " }), x.A), 400));
T("BB45", G.len, BVA, "Lý do khám rất dài (5000 ký tự)", "lyDo dài 5000 ký tự", "200 - đặt thành công", async (x) => expectStatus(await book(body0(slot(), { lyDo: "x".repeat(5000) }), x.A), 200));

// 9. Trùng lịch & chuyển trạng thái
T("BB46", G.dup, DT, "Khách khác đặt trùng bác sĩ/ngày/giờ", "Khách A đặt trước, khách B đặt cùng bác sĩ + ngày + giờ", "Lần 2: 400 - bác sĩ đã có lịch", async (x) => {
  const s = slot(); const r1 = await book(body0(s), x.A); const r2 = await book(body0(s), x.B);
  return { pass: r1.status === 200 && r2.status === 400 && /đã có lịch/.test(r2.json.message), actual: `Lần 1: ${r1.status}; Lần 2: ${describe(r2)}` };
});
T("BB47", G.dup, DT, "Chính khách đó đặt lại cùng khung giờ", "Khách A đặt 2 lần cùng bác sĩ + ngày + giờ", "Lần 2: 400 - bác sĩ đã có lịch", async (x) => {
  const s = slot(); const r1 = await book(body0(s), x.A); const r2 = await book(body0(s), x.A);
  return { pass: r1.status === 200 && r2.status === 400, actual: `Lần 1: ${r1.status}; Lần 2: ${describe(r2)}` };
});
T("BB48", G.dup, DT, "Cùng ngày giờ nhưng khác bác sĩ", "Bác sĩ 1 rồi bác sĩ 2 (cùng khoa 1), cùng ngày giờ", "Cả hai: 200", async (x) => {
  const s = slot(); const r1 = await book(body0(s, { idBacSi: 1 }), x.A); const r2 = await book(body0(s, { idBacSi: 2 }), x.B);
  return { pass: r1.status === 200 && r2.status === 200, actual: `Lần 1: ${r1.status}; Lần 2: ${r2.status}` };
});
T("BB49", G.dup, DT, "Cùng bác sĩ, cùng ngày, giờ khác", "09:00 rồi 09:30", "Cả hai: 200", async (x) => {
  const s = slot("09:00"); const r1 = await book(body0(s), x.A); const r2 = await book(body0({ ...s, gio: "09:30" }), x.B);
  return { pass: r1.status === 200 && r2.status === 200, actual: `Lần 1: ${r1.status}; Lần 2: ${r2.status}` };
});
T("BB50", G.dup, ST, "Hủy lịch giải phóng khung giờ", "A đặt -> A hủy -> B đặt đúng khung giờ đó", "B đặt được: 200", async (x) => {
  const s = slot(); const r1 = await book(body0(s), x.A);
  const h = await call("POST", "/api/huy-lich", { token: x.A, body: { idLichKham: r1.json.idLichKham } });
  const r2 = await book(body0(s), x.B);
  return { pass: r1.status === 200 && h.status === 200 && r2.status === 200, actual: `Đặt: ${r1.status}; Hủy: ${h.status}; Đặt lại: ${describe(r2)}` };
});
T("BB51", G.dup, ST, "Hủy một lịch đã hủy", "Hủy cùng một lịch 2 lần", "Lần 2: 400 - đã được hủy trước đó", async (x) => {
  const r1 = await book(body0(slot()), x.A); const id = r1.json.idLichKham;
  await call("POST", "/api/huy-lich", { token: x.A, body: { idLichKham: id } });
  const h2 = await call("POST", "/api/huy-lich", { token: x.A, body: { idLichKham: id } });
  return { pass: h2.status === 400 && /đã được hủy/.test(h2.json.message), actual: describe(h2) };
});
T("BB52", G.dup, DT, "Khách khác hủy lịch của người khác", "B gọi hủy lịch của A", "403; lịch của A vẫn 'chờ xác nhận'", async (x) => {
  const r1 = await book(body0(slot()), x.A); const id = r1.json.idLichKham;
  const h = await call("POST", "/api/huy-lich", { token: x.B, body: { idLichKham: id } });
  const mine = (await myAppointments(x.A, 1)).find((l) => l.idLichKham === id);
  return { pass: h.status === 403 && mine && mine.trangThai === "chờ xác nhận", actual: `${describe(h)}; trạng thái lịch: ${mine && mine.trangThai}` };
});

// 10. Đoán lỗi & bảo mật
T("BB53", G.guess, EG, "SQL Injection trong họ tên", "hoTen = Robert'); DROP TABLE LICHKHAM;--", "200; bảng LICHKHAM vẫn còn; tên được lưu như dữ liệu thường", async (x) => {
  const r = await book(body0(slot(), { hoTen: "Robert'); DROP TABLE LICHKHAM;--" }), x.A);
  const list = await call("GET", "/api/lich-user/1", { token: x.A });
  return { pass: r.status === 200 && list.status === 200 && Array.isArray(list.json), actual: `Đặt: ${r.status}; bảng LICHKHAM vẫn truy vấn được: ${list.status === 200}` };
});
T("BB54", G.guess, EG, "XSS trong họ tên", "hoTen = <script>alert(1)</script>", "200; dữ liệu lưu đã bị vô hiệu hóa (không còn thẻ <script> nguyên bản)", async (x) => {
  const r = await book(body0(slot(), { hoTen: "<script>alert(1)</script>" }), x.A);
  const mine = (await myAppointments(x.A, 1)).find((l) => l.idLichKham === r.json?.idLichKham);
  return { pass: r.status === 200 && !!mine && !mine.hoTen.includes("<script>"), actual: mine ? `hoTen lưu = ${mine.hoTen}` : describe(r) };
});
T("BB55", G.guess, EG, "Giả mạo idKH trong body (IDOR)", "Token khách A, body có idKH = 2", "Lịch thuộc khách A (lấy theo token), không thuộc khách 2", async (x) => {
  const r = await book({ ...body0(slot()), idKH: 2 }, x.A);
  const inA = (await myAppointments(x.A, 1)).some((l) => l.idLichKham === r.json?.idLichKham);
  const inB = (await myAppointments(x.B, 2)).some((l) => l.idLichKham === r.json?.idLichKham);
  return { pass: r.status === 200 && inA && !inB, actual: `Đặt: ${r.status}; thuộc khách 1: ${inA}; thuộc khách 2: ${inB}` };
});
T("BB56", G.guess, EG, "SQL Injection trong idBacSi", "idBacSi = '1 OR 1=1'", "400 - ID bác sĩ không hợp lệ", async (x) => expectStatus(await book(body0(slot(), { idBacSi: "1 OR 1=1" }), x.A), 400));
T("BB57", G.guess, EG, "Gửi body không phải JSON (text/plain)", "Content-Type: text/plain, body = 'hello'", "Mã 4xx (từ chối dữ liệu sai), không phải 5xx", async (x) => {
  const r = await call("POST", "/api/dat-lich", { token: x.A, raw: "hello", headers: { "Content-Type": "text/plain" } });
  return { pass: r.status >= 400 && r.status < 500, actual: `HTTP ${r.status}` };
});
T("BB58", G.guess, EG, "JSON sai cú pháp", "Body = {\"hoTen\": ", "400", async (x) => {
  const r = await call("POST", "/api/dat-lich", { token: x.A, raw: '{"hoTen": ', headers: { "Content-Type": "application/json" } });
  return { pass: r.status === 400, actual: `HTTP ${r.status}` };
});
T("BB59", G.guess, BVA, "Body vượt 100 KB", "lyDo dài 150 000 ký tự", "413 - Payload quá lớn", async (x) => {
  const r = await call("POST", "/api/dat-lich", { token: x.A, body: body0(slot(), { lyDo: "x".repeat(150000) }) });
  return { pass: r.status === 413, actual: `HTTP ${r.status}` };
});
T("BB60", G.guess, EG, "Hai yêu cầu đặt đồng thời cùng một khung giờ (thử 6 lần)", "A và B gửi cùng lúc (Promise.all), lặp 6 lần với 6 khung giờ khác nhau", "Mỗi lần: đúng 1 yêu cầu thành công (200), yêu cầu còn lại bị từ chối rõ ràng bằng 400 (đã có lịch), không có lỗi 5xx", async (x) => {
  let oneOk = 0, loser400 = 0, loser500 = 0, bothOk = 0;
  for (let i = 0; i < 6; i++) {
    const s = slot(); const rs = await Promise.all([book(body0(s), x.A), book(body0(s), x.B)]);
    const wins = rs.filter((r) => r.status === 200).length;
    if (wins === 2) bothOk++; if (wins === 1) { oneOk++; const l = rs.find((r) => r.status !== 200); if (l.status === 400) loser400++; else loser500++; }
  }
  return { pass: bothOk === 0 && oneOk === 6 && loser500 === 0, actual: `6 lần thử: không có lịch trùng (2 yêu cầu cùng thành công: ${bothOk}); yêu cầu thua nhận 400: ${loser400} lần, nhận 500: ${loser500} lần` };
});

// ---------- chạy ----------
(async () => {
  const ctx = { A: await login("0912345678", "User@1234"), B: await login("0987654321", "User@1234"), admin: await login("0900000000", "Admin@123") };
  if (!ctx.A || !ctx.B || !ctx.admin) { console.error("Không đăng nhập được các tài khoản mẫu. Kiểm tra server và dữ liệu database.sql (mật khẩu mẫu: User@1234 / Admin@123)."); process.exit(1); }
  const results = [];
  for (const c of C) {
    let r; try { r = await c.run(ctx); } catch (e) { r = { pass: false, actual: "Lỗi khi chạy: " + e.message }; }
    results.push({ id: c.id, group: c.group, tech: c.tech, name: c.name, input: c.input, expected: c.expected, actual: r.actual, pass: r.pass });
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${c.id}  ${c.name}  ->  ${r.actual}`);
  }
  const passed = results.filter((r) => r.pass).length;
  console.log(`\nTổng: ${results.length} test case | Đạt: ${passed} | Không đạt: ${results.length - passed}`);
  fs.writeFileSync("blackbox-results.json", JSON.stringify({ base: BASE, time: new Date().toISOString(), results }, null, 2));

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  let html = `<!doctype html><meta charset="utf-8"><title>Kết quả kiểm thử hộp đen - Đặt lịch khám</title><style>
  body{font-family:Segoe UI,Arial,sans-serif;margin:24px;color:#1a1a1a} h1{font-size:20px} .sum{margin:8px 0 16px;font-size:15px}
  table{border-collapse:collapse;width:100%;font-size:13px} th,td{border:1px solid #cfd4da;padding:6px 8px;vertical-align:top} th{background:#e8eef7}
  tr.g td{background:#f3f5f8;font-weight:600} .p{color:#0a7d33;font-weight:700} .f{color:#c62828;font-weight:700} tr.fail td{background:#fdecea}</style>
  <h1>Kết quả kiểm thử hộp đen - chức năng Đặt lịch khám (POST /api/dat-lich)</h1>
  <div class="sum">Tổng <b>${results.length}</b> | Đạt <b class="p">${passed}</b> | Không đạt <b class="f">${results.length - passed}</b> | Máy chủ: ${esc(BASE)}</div>
  <table><tr><th>Mã</th><th>Kỹ thuật</th><th>Tên test case</th><th>Dữ liệu vào</th><th>Kết quả mong đợi</th><th>Kết quả thực tế</th><th>Trạng thái</th></tr>`;
  let g = "";
  for (const r of results) {
    if (r.group !== g) { g = r.group; html += `<tr class="g"><td colspan="7">${esc(g)}</td></tr>`; }
    html += `<tr class="${r.pass ? "" : "fail"}"><td>${r.id}</td><td>${esc(r.tech)}</td><td>${esc(r.name)}</td><td>${esc(r.input)}</td><td>${esc(r.expected)}</td><td>${esc(r.actual)}</td><td class="${r.pass ? "p" : "f"}">${r.pass ? "PASS" : "FAIL"}</td></tr>`;
  }
  fs.writeFileSync("blackbox-report.html", html + "</table>");
  console.log("Đã ghi blackbox-results.json và blackbox-report.html");
})();
