// src/services/auth/JwtAuthMiddleware.test.ts

/**
 * Tests for JWT Auth Middleware
 */

import { describe, expect, it } from "bun:test";
import {
  JwtAuthMiddleware,
  JwtValidationError,
  InMemoryRefreshTokenStorage,
  parseJwt,
  type JwtPayload,
  type TokenPair,
} from "./JwtAuthMiddleware";

describe("JwtAuthMiddleware", () => {
  const secret = "test-secret-key-for-testing-purposes-only";
  
  describe("generateAccessToken", () => {
    it("should generate a valid JWT token", () => {
      const auth = new JwtAuthMiddleware({ secret });
      const result = auth.generateAccessToken("user-123");

      expect(result.token).toBeTruthy();
      expect(typeof result.expiresAt).toBe("number");
      expect(result.expiresAt).toBeGreaterThan(Date.now());
    });

    it("should generate token with correct structure", () => {
      const auth = new JwtAuthMiddleware({ secret });
      const result = auth.generateAccessToken("user-123");
      const payload = parseJwt(result.token);

      expect(payload).toBeTruthy();
      expect(payload?.sub).toBe("user-123");
      expect(payload?.iat).toBeGreaterThan(0);
      expect(payload?.exp).toBeGreaterThan((Date.now() / 1000));
    });

    it("should include custom claims in token", () => {
      const auth = new JwtAuthMiddleware({ secret });
      const customClaims = { role: "admin", email: "test@example.com" };
      const result = auth.generateAccessToken("user-123", customClaims);
      const payload = parseJwt(result.token);

      expect(payload?.role).toBe("admin");
      expect(payload?.email).toBe("test@example.com");
    });

    it("should use custom access token lifetime", () => {
      const auth = new JwtAuthMiddleware({ secret, accessTokenLifetime: 60 });
      const result = auth.generateAccessToken("user-123");
      const payload = parseJwt(result.token);

      const now = Math.floor(Date.now() / 1000);
      expect(payload?.exp).toBeGreaterThan(now + 50);
      expect(payload?.exp).toBeLessThanOrEqual(now + 70);
    });
  });

  describe("generateTokenPair", () => {
    it("should generate both access and refresh tokens", async () => {
      const auth = new JwtAuthMiddleware({ secret });
      const pair = await auth.generateTokenPair("user-123");

      expect(pair.accessToken).toBeTruthy();
      expect(pair.refreshToken).toBeTruthy();
      expect(pair.accessTokenExpiresAt).toBeGreaterThan(Date.now());
      expect(pair.refreshTokenExpiresAt).toBeGreaterThan(Date.now());
      expect(pair.refreshTokenExpiresAt).toBeGreaterThan(pair.accessTokenExpiresAt);
    });

    it("should refresh tokens with new pair", async () => {
      const auth = new JwtAuthMiddleware({ 
        secret,
        refreshTokenLifetime: 86400, // 1 day for testing
      });
      
      const pair1 = await auth.generateTokenPair("user-123");
      const refreshedPair = await auth.refreshToken(pair1.refreshToken);

      expect(refreshedPair.accessToken).not.toBe(pair1.accessToken);
      expect(refreshedPair.refreshToken).not.toBe(pair1.refreshToken);

      // Original access token should still be valid
      const originalPayload = auth.validateToken(pair1.accessToken);
      expect(originalPayload.sub).toBe("user-123");
    });
  });

  describe("validateToken", () => {
    it("should validate a valid token", () => {
      const auth = new JwtAuthMiddleware({ secret });
      const result = auth.generateAccessToken("user-123");
      const payload = auth.validateToken(result.token);

      expect(payload.sub).toBe("user-123");
      expect(payload.iat).toBeGreaterThan(0);
    });

    it("should throw for invalid token format", () => {
      const auth = new JwtAuthMiddleware({ secret });

      expect(() => auth.validateToken("invalid")).toThrow(JwtValidationError);
      expect(() => auth.validateToken("invalid")).toThrow("Invalid token format");
    });

    it("should throw for tampered token", () => {
      const auth = new JwtAuthMiddleware({ secret });
      const result = auth.generateAccessToken("user-123");
      const tampered = result.token.slice(0, -1) + "X";

      expect(() => auth.validateToken(tampered)).toThrow(JwtValidationError);
      expect(() => auth.validateToken(tampered)).toThrow("Invalid token signature");
    });

    it("should throw for expired token", () => {
      const auth = new JwtAuthMiddleware({ secret, accessTokenLifetime: -1 });
      const result = auth.generateAccessToken("user-123");

      expect(() => auth.validateToken(result.token)).toThrow(JwtValidationError);
      expect(() => auth.validateToken(result.token)).toThrow("expired");
    });

    it("should throw for invalid token from different secret", () => {
      const auth1 = new JwtAuthMiddleware({ secret: "secret1" });
      const auth2 = new JwtAuthMiddleware({ secret: "secret2" });
      const result = auth1.generateAccessToken("user-123");

      expect(() => auth2.validateToken(result.token)).toThrow(JwtValidationError);
      expect(() => auth2.validateToken(result.token)).toThrow("Invalid token signature");
    });

    it("should reject token if issuer doesn't match", () => {
      const auth = new JwtAuthMiddleware({ secret, issuer: "test-issuer" });
      const otherAuth = new JwtAuthMiddleware({ secret, issuer: "other-issuer" });
      const result = otherAuth.generateAccessToken("user-123");

      expect(() => auth.validateToken(result.token)).toThrow(JwtValidationError);
      expect(() => auth.validateToken(result.token)).toThrow("Invalid token issuer");
    });

    it("should reject token if audience doesn't match", () => {
      const auth = new JwtAuthMiddleware({ secret, audience: "test-audience" });
      const otherAuth = new JwtAuthMiddleware({ secret, audience: "other-audience" });
      const result = otherAuth.generateAccessToken("user-123");

      expect(() => auth.validateToken(result.token)).toThrow(JwtValidationError);
      expect(() => auth.validateToken(result.token)).toThrow("Invalid token audience");
    });

    it("should allow tokens without audience if no audience configured", () => {
      const auth = new JwtAuthMiddleware({ secret });
      const result = auth.generateAccessToken("user-123");
      const payload = auth.validateToken(result.token);

      expect(payload.sub).toBe("user-123");
    });

    it("should allow tokens with correct issuer/audience", () => {
      const auth = new JwtAuthMiddleware({ 
        secret,
        issuer: "test-issuer",
        audience: "test-audience",
      });
      const result = auth.generateAccessToken("user-123");
      const payload = auth.validateToken(result.token);

      expect(payload.sub).toBe("user-123");
      expect(payload.iss).toBe("test-issuer");
      expect(payload.aud).toBe("test-audience");
    });
  });

  describe("refreshToken", () => {
    it("should issue new token pair for valid refresh token", async () => {
      const auth = new JwtAuthMiddleware({ secret });
      const pair = await auth.generateTokenPair("user-123");
      const refreshed = await auth.refreshToken(pair.refreshToken);

      expect(refreshed.accessToken).not.toBe(pair.accessToken);
      expect(refreshed.refreshToken).not.toBe(pair.refreshToken);
    });

    it("should throw for invalid refresh token", async () => {
      const auth = new JwtAuthMiddleware({ secret });

      await expect(auth.refreshToken("invalid")).toThrow(JwtValidationError);
      await expect(auth.refreshToken("invalid")).toThrow("Invalid refresh token");
    });

    it("should throw for used refresh token", async () => {
      const auth = new JwtAuthMiddleware({ secret });
      const pair = await auth.generateTokenPair("user-123");

      // First refresh
      await auth.refreshToken(pair.refreshToken);

      // Second refresh with same token should fail
      await expect(auth.refreshToken(pair.refreshToken)).toThrow(JwtValidationError);
      await expect(auth.refreshToken(pair.refreshToken)).toThrow("not found or expired");
    });

    it("should throw for expired refresh token", async () => {
      const auth = new JwtAuthMiddleware({ 
        secret,
        refreshTokenLifetime: -1, // Expired
      });

      const pair = await auth.generateTokenPair("user-123");

      await expect(auth.refreshToken(pair.refreshToken)).toThrow(JwtValidationError);
      await expect(auth.refreshToken(pair.refreshToken)).toThrow("expired");
    });
  });

  describe("revokeRefreshToken", () => {
    it("should revoke refresh token", async () => {
      const auth = new JwtAuthMiddleware({ secret });
      const pair = await auth.generateTokenPair("user-123");

      // Decode token ID from refresh token
      const tokenId = Buffer.from(pair.refreshToken, "base64url").toString("utf-8");

      auth.revokeRefreshToken(tokenId);

      await expect(auth.refreshToken(pair.refreshToken)).toThrow(JwtValidationError);
    });
  });

  describe("authenticate", () => {
    it("should authenticate valid bearer token", () => {
      const auth = new JwtAuthMiddleware({ secret });
      const result = auth.generateAccessToken("user-123");
      const payload = auth.authenticate(`Bearer ${result.token}`);

      expect(payload.sub).toBe("user-123");
    });

    it("should throw for missing header", () => {
      const auth = new JwtAuthMiddleware({ secret });

      expect(() => auth.authenticate(undefined)).toThrow(JwtValidationError);
      expect(() => auth.authenticate(undefined)).toThrow("Missing Authorization header");

      expect(() => auth.authenticate(null)).toThrow(JwtValidationError);
      expect(() => auth.authenticate(null)).toThrow("Missing Authorization header");

      expect(() => auth.authenticate("")).toThrow(JwtValidationError);
      expect(() => auth.authenticate("")).toThrow("Missing Authorization header");
    });

    it("should throw for invalid auth header format", () => {
      const auth = new JwtAuthMiddleware({ secret });

      expect(() => auth.authenticate("invalid")).toThrow(JwtValidationError);
      expect(() => auth.authenticate("invalid")).toThrow("Authorization header format");

      expect(() => auth.authenticate("Basic abc")).toThrow(JwtValidationError);
      expect(() => auth.authenticate("Basic abc")).toThrow("Authorization header format");
    });

    it("should throw for invalid Bearer token", () => {
      const auth = new JwtAuthMiddleware({ secret });

      expect(() => auth.authenticate("Bearer")).toThrow(JwtValidationError);
      expect(() => auth.authenticate("Bearer")).toThrow("Empty token");

      expect(() => auth.authenticate("Bearer   ")).toThrow(JwtValidationError);
      expect(() => auth.authenticate("Bearer   ")).toThrow("Empty token");
    });

    it("should throw for invalid token in header", () => {
      const auth = new JwtAuthMiddleware({ secret });

      expect(() => auth.authenticate("Bearer invalid")).toThrow(JwtValidationError);
    });
  });

  describe("tryGetUserId", () => {
    it("should return user ID for valid token", () => {
      const auth = new JwtAuthMiddleware({ secret });
      const result = auth.generateAccessToken("user-123");
      const userId = auth.tryGetUserId(`Bearer ${result.token}`);

      expect(userId).toBe("user-123");
    });

    it("should return null for invalid token", () => {
      const auth = new JwtAuthMiddleware({ secret });

      expect(auth.tryGetUserId(undefined)).toBeNull();
      expect(auth.tryGetUserId(null)).toBeNull();
      expect(auth.tryGetUserId("")).toBeNull();
      expect(auth.tryGetUserId("Bearer invalid")).toBeNull();
    });
  });

  describe("cleanup", () => {
    it("should clean up expired refresh tokens", () => {
      const storage = new InMemoryRefreshTokenStorage();
      const auth = new JwtAuthMiddleware({ secret, refreshStorage: storage });

      // Add expired token manually
      storage.set("expired-1", {
        userId: "user-123",
        tokenId: "expired-1",
        issuedAt: Date.now() - 10000,
        expiresAt: Date.now() - 5000,
      });

      expect(storage.get("expired-1")).toBeUndefined();

      auth.cleanup();
      // Token should already be gone
      expect(storage.get("expired-1")).toBeUndefined();
    });
  });

  describe("InMemoryRefreshTokenStorage", () => {
    it("should store and retrieve tokens", () => {
      const storage = new InMemoryRefreshTokenStorage();
      const data = {
        userId: "user-123",
        tokenId: "token-1",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 86400000,
      };

      storage.set("token-1", data);
      const retrieved = storage.get("token-1");

      expect(retrieved).toBeTruthy();
      expect(retrieved?.userId).toBe("user-123");
    });

    it("should return undefined for expired tokens", () => {
      const storage = new InMemoryRefreshTokenStorage();
      const data = {
        userId: "user-123",
        tokenId: "token-1",
        issuedAt: Date.now() - 10000,
        expiresAt: Date.now() - 5000,
      };

      storage.set("token-1", data);
      const retrieved = storage.get("token-1");

      expect(retrieved).toBeUndefined();
    });

    it("should delete tokens", () => {
      const storage = new InMemoryRefreshTokenStorage();
      const data = {
        userId: "user-123",
        tokenId: "token-1",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 86400000,
      };

      storage.set("token-1", data);
      storage.delete("token-1");

      expect(storage.get("token-1")).toBeUndefined();
    });

    it("should clean up all expired tokens", () => {
      const storage = new InMemoryRefreshTokenStorage();
      const now = Date.now();

      storage.set("expired-1", {
        userId: "user-123",
        tokenId: "expired-1",
        issuedAt: now - 10000,
        expiresAt: now - 5000,
      });

      storage.set("valid-2", {
        userId: "user-456",
        tokenId: "valid-2",
        issuedAt: now,
        expiresAt: now + 86400000,
      });

      storage.cleanup();

      expect(storage.get("valid-2")).toBeTruthy();
      expect(storage.get("expired-1")).toBeUndefined();
    });
  });

  describe("parseJwt", () => {
    it("should parse valid JWT", () => {
      const auth = new JwtAuthMiddleware({ secret });
      const result = auth.generateAccessToken("user-123");
      const payload = parseJwt(result.token);

      expect(payload).toBeTruthy();
      expect(payload?.sub).toBe("user-123");
    });

    it("should return null for invalid JWT", () => {
      expect(parseJwt("invalid")).toBeNull();
      expect(parseJwt("a.b")).toBeNull();
      expect(parseJwt("")).toBeNull();
    });
  });
});
