// Unit test các hàm thuần trong server.js (nhóm 1-6)
process.env.JWT_SECRET = "test-secret";

const {
  db, isValidId, sameId, normalizeDateInput, isPastDate, normalizeTimeInput,
  toDisplayTime, formatTime, hasStrongPassword, hashPassword, isHashedPassword,
  safeCompareString, verifyPassword, escapeHtml,
} = require("../server");

afterAll(() => db.end());

const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const offsetDay = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };

describe("1. isValidId / sameId", () => {
  test.each([1, "5", "123"])("isValidId(%p) = true", (v) => expect(isValidId(v)).toBe(true));
  test.each([0, -1, "", null, undefined, "abc", "1.5"])("isValidId(%p) = false", (v) => expect(isValidId(v)).toBe(false));
  // Các ca dưới đây dự kiến FAIL: hàm hiện chấp nhận (Number() quá rộng)
  test.each(["1e2", "0x10", " 5 ", true, [5]])("[BUG] isValidId(%p) nên = false", (v) => expect(isValidId(v)).toBe(false));

  test("sameId so sánh số và chuỗi", () => {
    expect(sameId("1", 1)).toBe(true);
    expect(sameId(2, "2")).toBe(true);
    expect(sameId(1, 2)).toBe(false);
    expect(sameId(undefined, undefined)).toBe(false);
  });
  test('[BUG] sameId("", 0) nên = false', () => expect(sameId("", 0)).toBe(false));
});

describe("2. Ngày giờ", () => {
  test.each([
    ["2026-10-15", "2026-10-15"],
    ["15/10/2026", "2026-10-15"],
    ["5/1/2026", "2026-01-05"],
    ["29/02/2028", "2028-02-29"],
  ])("normalizeDateInput(%p) = %p", (input, out) => expect(normalizeDateInput(input)).toBe(out));

  test.each(["29/02/2026", "2026-02-30", "31/04/2026", "2026-1-5", 20261010, null, "", "15/10"])(
    "normalizeDateInput(%p) = null", (v) => expect(normalizeDateInput(v)).toBeNull());

  test("allowShortDate thêm năm", () => {
    const out = normalizeDateInput("15/10", true);
    expect(out).toMatch(/^\d{4}-10-15$/);
  });

  test("isPastDate: hôm qua / hôm nay / ngày mai", () => {
    expect(isPastDate(iso(offsetDay(-1)))).toBe(true);
    expect(isPastDate(iso(offsetDay(0)))).toBe(false);
    expect(isPastDate(iso(offsetDay(1)))).toBe(false);
  });

  test.each([["09:00", "09:00:00"], ["23:59", "23:59:00"], ["00:00", "00:00:00"], ["09:00:30", "09:00:00"]])(
    "normalizeTimeInput(%p) = %p", (i, o) => expect(normalizeTimeInput(i)).toBe(o));
  test.each(["24:00", "09:60", "9:00", "abc", 900, null])("normalizeTimeInput(%p) = null", (v) =>
    expect(normalizeTimeInput(v)).toBeNull());

  test("toDisplayTime / formatTime", () => {
    expect(toDisplayTime("09:00:00")).toBe("09:00");
    expect(toDisplayTime(null)).toBe("");
    expect(formatTime(null)).toBe("");
    expect(formatTime(new Date(2026, 0, 1, 9, 5))).toBe("09:05");
  });
});

describe("3. Mật khẩu", () => {
  test.each([["abcdefg1", true], ["abcdef1", false], ["12345678", false], ["abcdefgh", false], ["", false], [12345678, false], [null, false]])(
    "hasStrongPassword(%p) = %p", (v, exp) => expect(hasStrongPassword(v)).toBe(exp));

  test("hashPassword: salt ngẫu nhiên và đúng định dạng", () => {
    const h1 = hashPassword("Abc12345");
    const h2 = hashPassword("Abc12345");
    expect(h1).not.toBe(h2);
    const parts = h1.split("$");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("pbkdf2_sha256");
    expect(parts[1]).toBe("100000");
  });

  test("verifyPassword với hash", () => {
    const h = hashPassword("Abc12345");
    expect(verifyPassword("Abc12345", h)).toBe(true);
    expect(verifyPassword("sai-mat-khau", h)).toBe(false);
  });
  test("verifyPassword với plaintext cũ", () => {
    expect(verifyPassword("User@1234", "User@1234")).toBe(true);
    expect(verifyPassword("khac", "User@1234")).toBe(false);
  });
  test("verifyPassword với hash hỏng không ném lỗi", () => {
    expect(verifyPassword("a", "pbkdf2_sha256$100000$salt")).toBe(false);
    expect(verifyPassword("a", "pbkdf2_sha256$0$s$h")).toBe(false);
    expect(verifyPassword("a", "pbkdf2_sha256$-5$s$h")).toBe(false);
    expect(verifyPassword("a", "pbkdf2_sha256$abc$s$h")).toBe(false);
  });
  test("verifyPassword('abc', null) = false", () => expect(verifyPassword("abc", null)).toBe(false));
  test('[BUG] verifyPassword("", null) nên = false', () => expect(verifyPassword("", null)).toBe(false));

  test("isHashedPassword", () => {
    expect(isHashedPassword(hashPassword("x1234567"))).toBe(true);
    expect(isHashedPassword("plaintext")).toBe(false);
    expect(isHashedPassword(null)).toBe(false);
  });
  test("safeCompareString", () => {
    expect(safeCompareString("abc", "abc")).toBe(true);
    expect(safeCompareString("abc", "abcd")).toBe(false);
    expect(safeCompareString(null, "abc")).toBe(false);
  });
});

describe("5. escapeHtml", () => {
  test("chặn thẻ script", () => {
    const out = escapeHtml("<script>alert(1)</script>");
    expect(out).not.toMatch(/[<>]/);
  });
  test("escape đủ 5 ký tự", () => expect(escapeHtml(`& < > " '`)).toBe("&amp; &lt; &gt; &quot; &#039;"));
  test("escape lại chuỗi đã escape", () => expect(escapeHtml("&lt;")).toBe("&amp;lt;"));
  test("giữ nguyên chuỗi thường / rỗng", () => {
    expect(escapeHtml("Nguyen Van A")).toBe("Nguyen Van A");
    expect(escapeHtml("")).toBe("");
  });
  test("không phải chuỗi thì trả nguyên", () => {
    expect(escapeHtml(123)).toBe(123);
    expect(escapeHtml(null)).toBeNull();
  });
  test("[BUG] object chứa <script> nên bị escape hoặc từ chối", () => {
    expect(JSON.stringify(escapeHtml({ a: "<script>" }))).not.toContain("<script>");
  });
});

describe("6. Regex số điện thoại (/^[0-9]{10,11}$/)", () => {
  const re = /^[0-9]{10,11}$/;
  test.each([["0912345678", true], ["09123456789", true], ["091234567", false], ["091234567890", false],
    ["09123abcde", false], ["0912 345 678", false], ["0912345678\n", false]])(
    "%p -> %p", (v, exp) => expect(re.test(v)).toBe(exp));
});
