import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, signToken, verifyToken } from "../auth";

describe("password hashing", () => {
  it("hashes and verifies password", async () => {
    const hash = await hashPassword("secret123");
    expect(hash).not.toBe("secret123");
    expect(await verifyPassword("secret123", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });
});

describe("JWT", () => {
  it("signs and verifies token", () => {
    const token = signToken({ userId: "abc123", role: "admin" });
    const payload = verifyToken(token);
    expect(payload?.userId).toBe("abc123");
    expect(payload?.role).toBe("admin");
  });

  it("returns null for invalid token", () => {
    expect(verifyToken("garbage")).toBeNull();
  });
});
