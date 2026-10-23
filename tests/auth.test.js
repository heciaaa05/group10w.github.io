// Unit test JWT và middleware (nhóm 4, 7)
process.env.JWT_SECRET = "test-secret";
process.env.TOKEN_TTL_SECONDS = "3600";

const crypto = require("crypto");
const { db, generateToken, verifyToken, authenticateToken, requireAdmin, rateLimitLogin } = require("../server");

afterAll(() => db.end());
afterEach(() => jest.useRealTimers());

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const sign = (h, b, secret = "test-secret") => crypto.createHmac("sha256", secret).update(`${h}.${b}`).digest("base64url");
const forge = (payload, secret) => {
  const h = b64({ alg: "HS256", typ: "JWT" });
  const b = b64(payload);
  return `${h}.${b}.${sign(h, b, secret)}`;
};
const now = () => Math.floor(Date.now() / 1000);

function mockRes() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

describe("4. Token JWT", () => {
  const payload = { id: 1, sdt: "0912345678", role: "customer" };

  test("tạo rồi verify", () => {
    const user = verifyToken(generateToken(payload));
    expect(user).toMatchObject(payload);
    expect(user.exp - user.iat).toBe(3600);
  });
  test("sửa signature -> null", () => {
    const [h, b, s] = generateToken(payload).split(".");
    const first = s[0] === "A" ? "B" : "A"; // đổi ký tự đầu (ký tự cuối chỉ chứa bit đệm nên đổi không ảnh hưởng)
    expect(verifyToken(`${h}.${b}.${first}${s.slice(1)}`)).toBeNull();
  });
  test("sửa payload (role admin), giữ signature -> null", () => {
    const [h, , s] = generateToken(payload).split(".");
    const evil = b64({ ...payload, role: "admin", iat: now(), exp: now() + 3600 });
    expect(verifyToken(`${h}.${evil}.${s}`)).toBeNull();
  });
  test("sửa header (alg none) -> null", () => {
    const [, b, s] = generateToken(payload).split(".");
    expect(verifyToken(`${b64({ alg: "none", typ: "JWT" })}.${b}.${s}`)).toBeNull();
  });
  test("token hết hạn -> null", () => {
    jest.useFakeTimers();
    const t = generateToken(payload);
    jest.setSystemTime(Date.now() + 3601 * 1000);
    expect(verifyToken(t)).toBeNull();
  });
  test("secret khác -> null", () => {
    expect(verifyToken(forge({ ...payload, iat: now(), exp: now() + 3600 }, "secret-khac"))).toBeNull();
  });
  test.each(["a.b", "a.b.c.d", "", undefined, null, 123])("định dạng sai %p -> null, không ném lỗi", (t) => {
    expect(verifyToken(t)).toBeNull();
  });
  test.each([["superadmin"], [undefined]])("role %p -> null", (role) => {
    expect(verifyToken(forge({ id: 1, role, iat: now(), exp: now() + 3600 }))).toBeNull();
  });
  test.each([0, -1, "abc"])("id %p -> null", (id) => {
    expect(verifyToken(forge({ id, role: "customer", iat: now(), exp: now() + 3600 }))).toBeNull();
  });
  test("thiếu exp -> null", () => {
    expect(verifyToken(forge({ id: 1, role: "customer", iat: now() }))).toBeNull();
  });
});

describe("7. authenticateToken", () => {
  const run = (headers) => {
    const req = { headers }; const res = mockRes(); const next = jest.fn();
    authenticateToken(req, res, next);
    return { req, res, next };
  };
  test("không có header -> 401", () => { const { res, next } = run({}); expect(res.statusCode).toBe(401); expect(next).not.toHaveBeenCalled(); });
  test('"Bearer" không kèm token -> 401', () => expect(run({ authorization: "Bearer" }).res.statusCode).toBe(401));
  test("không có tiền tố Bearer -> 401", () => expect(run({ authorization: "abc.def.ghi" }).res.statusCode).toBe(401));
  test("token sai -> 403", () => expect(run({ authorization: "Bearer abc.def.ghi" }).res.statusCode).toBe(403));
  test("token đúng -> gán req.user và gọi next()", () => {
    const t = generateToken({ id: 7, sdt: "0912345678", role: "customer" });
    const { req, next } = run({ authorization: `Bearer ${t}` });
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toMatchObject({ id: 7, role: "customer" });
  });
});

describe("7. requireAdmin", () => {
  const run = (user) => { const res = mockRes(); const next = jest.fn(); requireAdmin({ user }, res, next); return { res, next }; };
  test("admin -> next()", () => expect(run({ role: "admin" }).next).toHaveBeenCalled());
  test("customer -> 403", () => expect(run({ role: "customer" }).res.statusCode).toBe(403));
  test("không có user -> 403", () => expect(run(undefined).res.statusCode).toBe(403));
});

describe("7. rateLimitLogin", () => {
  const call = (ip) => {
    const req = { ip, headers: {}, socket: { remoteAddress: ip } }; const res = mockRes(); const next = jest.fn();
    rateLimitLogin(req, res, next);
    return { req, res, next };
  };
  const fail = (ip) => { const c = call(ip); if (c.next.mock.calls.length) c.req.recordFailedAttempt(); return c; };

  test("5 lần sai liên tiếp, lần thứ 6 bị 429", () => {
    for (let i = 0; i < 5; i++) expect(fail("10.0.0.1").next).toHaveBeenCalled();
    const sixth = call("10.0.0.1");
    expect(sixth.res.statusCode).toBe(429);
    expect(sixth.next).not.toHaveBeenCalled();
  });
  test("sau 60 giây được đăng nhập lại", () => {
    jest.useFakeTimers();
    for (let i = 0; i < 5; i++) fail("10.0.0.2");
    expect(call("10.0.0.2").res.statusCode).toBe(429);
    jest.setSystemTime(Date.now() + 61 * 1000);
    expect(call("10.0.0.2").next).toHaveBeenCalled();
  });
  test("đăng nhập đúng thì xóa bộ đếm", () => {
    for (let i = 0; i < 4; i++) fail("10.0.0.3");
    call("10.0.0.3").req.clearFailedAttempts();
    for (let i = 0; i < 5; i++) expect(fail("10.0.0.3").next).toHaveBeenCalled();
  });
  test("mỗi IP đếm riêng", () => {
    for (let i = 0; i < 5; i++) fail("10.0.0.4");
    expect(call("10.0.0.4").res.statusCode).toBe(429);
    expect(call("10.0.0.5").next).toHaveBeenCalled();
  });
});
