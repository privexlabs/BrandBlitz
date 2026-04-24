import { authenticate, authenticateOptional } from "./authenticate";
import jwt from "jsonwebtoken";

const SECRET = "test_secret";

// Mock req/res/next
const mockReq = () => ({
  headers: {},
  user: undefined as any,
});

const mockRes = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const next = jest.fn();

// Helper to generate JWTs
const signToken = (payload: any, options = {}) =>
  jwt.sign(payload, SECRET, options);

describe("authenticate middleware", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------
  // VALID TOKEN
  // -------------------------
  it("valid Bearer token → sets req.user and calls next", () => {
    const token = signToken({ id: "user1" }, { expiresIn: "1h" });

    const req = mockReq();
    req.headers.authorization = `Bearer ${token}`;
    const res = mockRes();

    authenticate(req as any, res, next);

    expect(req.user).toBeDefined();
    expect(req.user.id).toBe("user1");
    expect(next).toHaveBeenCalled();
  });

  // -------------------------
  // MISSING HEADER
  // -------------------------
  it("missing header → 401", () => {
    const req = mockReq();
    const res = mockRes();

    authenticate(req as any, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(String) })
    );
  });

  // -------------------------
  // MALFORMED HEADER
  // -------------------------
  it('malformed header "Token foo" → 401', () => {
    const req = mockReq();
    req.headers.authorization = "Token abc";
    const res = mockRes();

    authenticate(req as any, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  // -------------------------
  // EXPIRED TOKEN
  // -------------------------
  it("expired token → 401 token_expired", () => {
    const token = signToken(
      { id: "user1" },
      { expiresIn: "-1s" } // already expired
    );

    const req = mockReq();
    req.headers.authorization = `Bearer ${token}`;
    const res = mockRes();

    authenticate(req as any, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "token_expired",
      })
    );
  });

  // -------------------------
  // WRONG SECRET
  // -------------------------
  it("wrong secret → 401 invalid_signature", () => {
    const badToken = jwt.sign({ id: "user1" }, "wrong_secret");

    const req = mockReq();
    req.headers.authorization = `Bearer ${badToken}`;
    const res = mockRes();

    authenticate(req as any, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "invalid_signature",
      })
    );
  });
});

describe("authenticateOptional middleware", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("valid token → sets req.user and calls next", () => {
    const token = signToken({ id: "user1" });

    const req = mockReq();
    req.headers.authorization = `Bearer ${token}`;
    const res = mockRes();

    authenticateOptional(req as any, res, next);

    expect(req.user).toBeDefined();
    expect(next).toHaveBeenCalled();
  });

  it("invalid token → does NOT throw, sets req.user undefined", () => {
    const req = mockReq();
    req.headers.authorization = "Bearer invalid_token";
    const res = mockRes();

    authenticateOptional(req as any, res, next);

    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });

  it("missing token → continues without user", () => {
    const req = mockReq();
    const res = mockRes();

    authenticateOptional(req as any, res, next);

    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });
});