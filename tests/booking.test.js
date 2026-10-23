// ===================== UNIT TEST ĐẶT LỊCH KHÁM (TS_BOOKING_01) =====================
// Đối tượng kiểm thử: API đặt lịch khám POST /api/dat-lich trong server.js
// Cơ sở dữ liệu được giả lập bằng Jest mock nên không cần MySQL.

process.env.JWT_SECRET = "test-secret";

const request = require("supertest");
const { app, db, generateToken } = require("../server");

// ---------- Dữ liệu và hàm hỗ trợ ----------
const pad = (n) => String(n).padStart(2, "0");

function dateFromToday(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const customerToken = generateToken({ id: 7, sdt: "0912345678", role: "customer" });
const adminToken = generateToken({ id: 1, sdt: "0900000000", role: "admin" });

function validBody() {
  return {
    hoTen: "Nguyen Van A",
    lyDo: "Kham tong quat",
    idBacSi: 1,
    idKhoa: 2,
    ngayKham: dateFromToday(30),
    gioKham: "09:00",
  };
}

function bookAppointment(body, token = customerToken) {
  return request(app)
    .post("/api/dat-lich")
    .set("Authorization", `Bearer ${token}`)
    .send(body);
}

// ---------- Bộ test ----------
describe("Unit Test - Đặt lịch khám", () => {
  let dbState;      // dữ liệu mà DB giả sẽ trả về
  let mockConn;     // kết nối DB giả
  let getConnection;

  beforeEach(() => {
    dbState = {
      doctorRows: [{ idBacSi: 1, idKhoa: 2 }],  // bác sĩ thuộc khoa
      duplicateRows: [],                        // chưa có lịch trùng
      insertError: null,
      insertId: 101,
    };

    mockConn = {
      beginTransaction: jest.fn((cb) => cb(null)),
      query: jest.fn((sql, params, cb) => {
        if (/FROM BACSI/.test(sql)) return cb(null, dbState.doctorRows);
        if (/FROM LICHKHAM/.test(sql)) return cb(null, dbState.duplicateRows);
        if (/INSERT INTO LICHKHAM/.test(sql)) {
          return cb(dbState.insertError, { insertId: dbState.insertId });
        }
        return cb(null, []);
      }),
      commit: jest.fn((cb) => cb(null)),
      rollback: jest.fn((cb) => cb()),
      release: jest.fn(),
    };

    getConnection = jest
      .spyOn(db, "getConnection")
      .mockImplementation((cb) => cb(null, mockConn));

    // Hàm ghi nhật ký hoạt động dùng db.query nên cũng được giả lập
    jest.spyOn(db, "query").mockImplementation((...args) => {
      const cb = args[args.length - 1];
      if (typeof cb === "function") cb(null, {});
    });
  });

  afterEach(() => jest.restoreAllMocks());
  afterAll(() => db.end());

  // Lấy tham số của câu INSERT để kiểm tra dữ liệu thực sự được lưu
  function insertParams() {
    const call = mockConn.query.mock.calls.find(([sql]) => /INSERT INTO LICHKHAM/.test(sql));
    return call ? call[1] : null;
  }

  // UT01: Đặt lịch với thông tin hợp lệ
  test("UT01 - Khách hàng đặt lịch với thông tin hợp lệ", async () => {
    const res = await bookAppointment(validBody());

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.idLichKham).toBe(101);

    expect(mockConn.commit).toHaveBeenCalledTimes(1);
    expect(mockConn.rollback).not.toHaveBeenCalled();
    expect(mockConn.release).toHaveBeenCalledTimes(1);
  });

  // UT02: Tài khoản quản trị viên không được đặt lịch
  test("UT02 - Quản trị viên đặt lịch bị từ chối", async () => {
    const res = await bookAppointment(validBody(), adminToken);

    expect(res.status).toBe(403);
    expect(getConnection).not.toHaveBeenCalled();
  });

  // UT03: Thiếu thông tin bắt buộc
  test("UT03 - Thiếu thông tin bắt buộc", async () => {
    for (const field of ["hoTen", "idBacSi", "ngayKham", "gioKham"]) {
      const body = validBody();
      delete body[field];

      const res = await bookAppointment(body);

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Thiếu thông tin đặt lịch!");
    }
    expect(getConnection).not.toHaveBeenCalled();
  });

  // UT04: Ngày khám trong quá khứ
  test("UT04 - Ngày khám trong quá khứ", async () => {
    const res = await bookAppointment({ ...validBody(), ngayKham: dateFromToday(-5) });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Không thể đặt lịch khám trong quá khứ!");
    expect(getConnection).not.toHaveBeenCalled();
  });

  // UT05: Giờ khám sai định dạng
  test("UT05 - Giờ khám sai định dạng", async () => {
    const res = await bookAppointment({ ...validBody(), gioKham: "24:00" });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Giờ không hợp lệ!");
    expect(getConnection).not.toHaveBeenCalled();
  });

  // UT06: Bác sĩ không thuộc khoa đã chọn
  test("UT06 - Bác sĩ không thuộc khoa đã chọn", async () => {
    dbState.doctorRows = [];

    const res = await bookAppointment(validBody());

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/không thuộc khoa/);
    expect(mockConn.rollback).toHaveBeenCalled();
    expect(mockConn.commit).not.toHaveBeenCalled();
  });

  // UT07: Bác sĩ đã có lịch cùng khung giờ
  test("UT07 - Bác sĩ đã có lịch cùng khung giờ", async () => {
    dbState.duplicateRows = [{ idLichKham: 55 }];

    const res = await bookAppointment(validBody());

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/đã có lịch khám/);
    expect(mockConn.rollback).toHaveBeenCalled();
    expect(mockConn.commit).not.toHaveBeenCalled();
  });

  // UT08: idKH lấy từ token, không lấy từ body (chống IDOR)
  test("UT08 - idKH lấy từ token, bỏ qua idKH trong body", async () => {
    const res = await bookAppointment({ ...validBody(), idKH: 999 });

    expect(res.status).toBe(200);
    expect(insertParams()[4]).toBe(7);
    expect(insertParams()).not.toContain(999);
  });

  // UT09: Lỗi khi lưu lịch khám vào cơ sở dữ liệu
  test("UT09 - Lỗi khi lưu lịch khám vào cơ sở dữ liệu", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    dbState.insertError = new Error("Lỗi ghi dữ liệu");

    const res = await bookAppointment(validBody());

    expect(res.status).toBe(500);
    expect(mockConn.rollback).toHaveBeenCalled();
    expect(mockConn.commit).not.toHaveBeenCalled();
    expect(mockConn.release).toHaveBeenCalled();
  });

  // UT10: Họ tên chứa mã HTML được escape trước khi lưu (chống XSS)
  test("UT10 - Họ tên chứa mã HTML được escape trước khi lưu", async () => {
    const res = await bookAppointment({ ...validBody(), hoTen: "<script>alert(1)</script>" });

    expect(res.status).toBe(200);
    expect(insertParams()[0]).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});
