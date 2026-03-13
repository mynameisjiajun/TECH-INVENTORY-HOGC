import test from "node:test";
import assert from "node:assert";
import jwt from "jsonwebtoken";
import {
  createResetToken,
  verifyResetToken,
  decodeResetTokenUnsafely,
} from "./auth.js";

test("Password Reset Token Security Tests", async (t) => {
  const originalEnv = process.env.JWT_SECRET;

  t.beforeEach(() => {
    process.env.JWT_SECRET = "test-secret-1234567890";
  });

  t.afterEach(() => {
    process.env.JWT_SECRET = originalEnv;
  });

  await t.test("createResetToken includes password_hash in signature", () => {
    const user = {
      id: 1,
      username: "testuser",
      password_hash: "hash_version_1",
    };

    const token = createResetToken(user);
    const decoded = jwt.decode(token);

    assert.strictEqual(decoded.id, 1);
    assert.strictEqual(decoded.username, "testuser");
    assert.strictEqual(decoded.purpose, "password_reset");

    // Verification should fail if using just the JWT_SECRET
    assert.throws(() => {
      jwt.verify(token, process.env.JWT_SECRET);
    });

    // Verification should succeed with JWT_SECRET + password_hash
    const payload = jwt.verify(token, process.env.JWT_SECRET + user.password_hash);
    assert.strictEqual(payload.id, 1);
  });

  await t.test("verifyResetToken accepts correct password_hash", () => {
    const user = {
      id: 2,
      username: "user2",
      password_hash: "old_hash_123",
    };

    const token = createResetToken(user);
    const payload = verifyResetToken(token, user.password_hash);

    assert.ok(payload);
    assert.strictEqual(payload.id, 2);
    assert.strictEqual(payload.username, "user2");
  });

  await t.test("verifyResetToken rejects wrong password_hash (replay attack mitigation)", () => {
    const user = {
      id: 3,
      username: "user3",
      password_hash: "old_hash_123",
    };

    const token = createResetToken(user);

    // User resets password, so hash changes
    const newPasswordHash = "new_hash_456";

    // Replay attack with old token but new hash in db
    const payload = verifyResetToken(token, newPasswordHash);

    assert.strictEqual(payload, null);
  });

  await t.test("decodeResetTokenUnsafely correctly decodes without verifying", () => {
    const user = {
      id: 4,
      username: "user4",
      password_hash: "hash",
    };

    const token = createResetToken(user);
    const decoded = decodeResetTokenUnsafely(token);

    assert.ok(decoded);
    assert.strictEqual(decoded.id, 4);
    assert.strictEqual(decoded.username, "user4");
  });

  await t.test("decodeResetTokenUnsafely returns null for non-reset tokens", () => {
    const normalToken = jwt.sign({ id: 5, username: "user5", purpose: "login" }, "secret");
    const decoded = decodeResetTokenUnsafely(normalToken);

    assert.strictEqual(decoded, null);
  });
});
