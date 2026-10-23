// ===== KIỂM THỬ HỘP TRẮNG BỔ SUNG CHO POST /api/dat-lich (TS_BOOKING_02) =====
// Mục đích: phủ các nhánh mà UT01–UT10 chưa đi qua (idBacSi/ngày không hợp lệ, không có idKhoa,
// lỗi kết nối, lỗi transaction, lỗi truy vấn, lỗi commit, lyDo rỗng).

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
describe("White-box - Đặt lịch khám (bổ sung phủ nhánh)", () => {
  let dbState, mockConn, getConnection;

  beforeEach(() => {
    dbState = { doctorRows: [{ idBacSi: 1, idKhoa: 2 }], duplicateRows: [], doctorError: null, dupError: null, insertError: null, commitError: null, beginError: null };

    mockConn = {
      beginTransaction: jest.fn((cb) => cb(dbState.beginError)),
      query: jest.fn((sql, params, cb) => {
        if (/FROM BACSI/.test(sql)) return cb(dbState.doctorError, dbState.doctorRows);
        if (/FROM LICHKHAM/.test(sql)) return cb(dbState.dupError, dbState.duplicateRows);
        if (/INSERT INTO LICHKHAM/.test(sql)) return cb(dbState.insertError, { insertId: 101 });
        return cb(null, []);
      }),
      commit: jest.fn((cb) => cb(dbState.commitError)),
      rollback: jest.fn((cb) => cb()),
      release: jest.fn(),
    };

    getConnection = jest.spyOn(db, "getConnection").mockImplementation((cb) => cb(null, mockConn));
    jest.spyOn(db, "query").mockImplementation((...args) => {
      const cb = args[args.length - 1];
      if (typeof cb === "function") cb(null, {});
    });
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());
  afterAll(() => db.end());

  const insertCall = () => mockConn.query.mock.calls.find(([sql]) => /INSERT INTO LICHKHAM/.test(sql));

  // UT11: nhánh idBacSi không phải số nguyên dương
  test("UT11 - idBacSi không hợp lệ", async () => {
    const res = await bookAppointment({ ...validBody(), idBacSi: "abc" });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("ID bác sĩ không hợp lệ!");
    expect(getConnection).not.toHaveBeenCalled();
  });

  // UT12: nhánh ngày sai định dạng (khác với ngày quá khứ ở UT04)
  test("UT12 - Ngày khám sai định dạng", async () => {
    const res = await bookAppointment({ ...validBody(), ngayKham: "khong-phai-ngay" });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Ngày không hợp lệ!");
    expect(getConnection).not.toHaveBeenCalled();
  });

  // UT13: nhánh không gửi idKhoa -> dùng câu SQL chỉ lọc theo idBacSi, lấy idKhoa từ bác sĩ
  test("UT13 - Không gửi idKhoa, hệ thống lấy khoa từ bác sĩ", async () => {
    const body = validBody();
    delete body.idKhoa;
    dbState.doctorRows = [{ idBacSi: 1, idKhoa: 5 }];

    const res = await bookAppointment(body);

    const doctorCall = mockConn.query.mock.calls.find(([sql]) => /FROM BACSI/.test(sql));
    expect(doctorCall[0]).not.toMatch(/idKhoa = \?/);
    expect(doctorCall[1]).toEqual([1]);
    expect(res.status).toBe(200);
    expect(insertCall()[1][6]).toBe(5);       // idKhoa lưu = khoa của bác sĩ
  });

  // UT14: nhánh lyDo rỗng -> lưu NULL
  test("UT14 - Lý do khám để trống thì lưu NULL", async () => {
    const body = validBody();
    delete body.lyDo;

    const res = await bookAppointment(body);

    expect(res.status).toBe(200);
    expect(insertCall()[1][1]).toBeNull();
  });

  // UT15: lỗi lấy kết nối từ pool
  test("UT15 - Lỗi kết nối cơ sở dữ liệu", async () => {
    getConnection.mockImplementation((cb) => cb(new Error("ECONNREFUSED")));
    const res = await bookAppointment(validBody());
    expect(res.status).toBe(500);
    expect(res.body.message).toBe("Lỗi kết nối máy chủ!");
  });

  // UT16: lỗi beginTransaction -> phải release kết nối
  test("UT16 - Lỗi khi bắt đầu transaction", async () => {
    dbState.beginError = new Error("tx fail");
    const res = await bookAppointment(validBody());
    expect(res.status).toBe(500);
    expect(mockConn.release).toHaveBeenCalledTimes(1);
    expect(mockConn.query).not.toHaveBeenCalled();
  });

  // UT17: lỗi truy vấn kiểm tra bác sĩ
  test("UT17 - Lỗi truy vấn kiểm tra bác sĩ", async () => {
    dbState.doctorError = new Error("sql error");
    const res = await bookAppointment(validBody());
    expect(res.status).toBe(500);
    expect(res.body.message).toBe("Lỗi kiểm tra bác sĩ!");
    expect(mockConn.rollback).toHaveBeenCalled();
    expect(mockConn.release).toHaveBeenCalled();
  });

  // UT18: lỗi truy vấn kiểm tra trùng lịch
  test("UT18 - Lỗi truy vấn kiểm tra trùng lịch", async () => {
    dbState.dupError = new Error("sql error");
    const res = await bookAppointment(validBody());
    expect(res.status).toBe(500);
    expect(res.body.message).toBe("Lỗi kiểm tra trùng lịch!");
    expect(mockConn.rollback).toHaveBeenCalled();
    expect(insertCall()).toBeUndefined();     // không được chèn khi chưa kiểm tra xong
  });

  // UT19: lỗi commit -> rollback, không báo thành công
  test("UT19 - Lỗi khi commit transaction", async () => {
    dbState.commitError = new Error("commit fail");
    const res = await bookAppointment(validBody());
    expect(res.status).toBe(500);
    expect(res.body.success).toBeUndefined();
    expect(mockConn.rollback).toHaveBeenCalled();
    expect(mockConn.release).toHaveBeenCalledTimes(1);
  });
});
