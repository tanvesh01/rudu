// src/services/auth/JwtAuthMiddleware.ts

/**
 * JWT-based Authentication Middleware
 *
 * Provides JWT token generation, validation, and middleware for protecting routes.
 * Supports access tokens and refresh tokens with automatic refresh rotation.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Represents a JWT payload
 */
export interface JwtPayload {
  /** Subject (typically user ID) */
  sub: string;
  /** Issuer */
  iss?: string;
  /** Audience */
  aud?: string;
  /** Issued at timestamp (seconds since epoch) */
  iat: number;
  /** Expiration timestamp (seconds since epoch) */
  exp: number;
  /** Not before timestamp (seconds since epoch) */
  nbf?: number;
  /** Issued at in milliseconds for API use */
  iatMs: number;
  /** Custom claims */
  [key: string]: unknown;
}

/**
 * JWT token result
 */
export interface TokenResult {
  /** The encoded JWT token */
  token: string;
  /** When the token expires (in milliseconds) */
  expiresAt: number;
}

/**
 * Token pair with refresh token
 */
export interface TokenPair {
  /** Access token for API calls */
  accessToken: string;
  /** Access token expiration */
  accessTokenExpiresAt: number;
  /** Refresh token for obtaining new access tokens */
  refreshToken: string;
  /** Refresh token expiration */
  refreshTokenExpiresAt: number;
}

/**
 * Refresh token data
 */
export interface RefreshTokenData {
  /** User ID */
  userId: string;
  /** Token ID */
  tokenId: string;
  /** Issued at timestamp */
  issuedAt: number;
  /** Expires at timestamp */
  expiresAt: number;
}

/**
 * Configuration for JWT auth middleware
 */
export interface JwtAuthConfig {
  /** Secret key for signing tokens (required) */
  secret: string;
  /** Token issuer identifier */
  issuer?: string;
  /** Audience identifier */
  audience?: string;
  /** Access token lifetime in seconds (default: 15 minutes) */
  accessTokenLifetime?: number;
  /** Refresh token lifetime in seconds (default: 7 days) */
  refreshTokenLifetime?: number;
  /** Clock tolerance in seconds to account for clock skew (default: 30 seconds) */
  clockTolerance?: number;
  /** Refresh token storage implementation (default: in-memory) */
  refreshStorage?: RefreshTokenStorage;
}

/**
 * Storage interface for refresh tokens
 */
export interface RefreshTokenStorage {
  /** Store a refresh token */
  set(tokenId: string, data: RefreshTokenData): Promise<void> | void;
  /** Retrieve a refresh token */
  get(tokenId: string): Promise<RefreshTokenData | undefined> | RefreshTokenData | undefined;
  /** Delete a refresh token */
  delete(tokenId: string): Promise<void> | void;
  /** Clean up expired tokens */
  cleanup?: () => Promise<void> | void;
}

/**
 * In-memory refresh token storage (default implementation)
 */
export class InMemoryRefreshTokenStorage implements RefreshTokenStorage {
  private tokens = new Map<string, RefreshTokenData>();

  set(tokenId: string, data: RefreshTokenData): void {
    this.tokens.set(tokenId, data);
  }

  get(tokenId: string): RefreshTokenData | undefined {
    const data = this.tokens.get(tokenId);
    if (!data) return undefined;
    // Check if expired
    if (data.expiresAt < Date.now()) {
      this.tokens.delete(tokenId);
      return undefined;
    }
    return data;
  }

  delete(tokenId: string): void {
    this.tokens.delete(tokenId);
  }

  cleanup(): void {
    const now = Date.now();
    for (const [tokenId, data] of this.tokens.entries()) {
      if (data.expiresAt < now) {
        this.tokens.delete(tokenId);
      }
    }
  }
}

/**
 * Error thrown when JWT validation fails
 */
export class JwtValidationError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = "JwtValidationError";
  }
}

/**
 * Parse JWT token without validation (for debugging/inspection)
 */
export function parseJwt(token: string): JwtPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    
    const payloadBase64Url = parts[1];
    // Add padding if needed
    const payloadBase64 = payloadBase64Url.replace(/[-_]/g, (char) =>
      char === "-" ? "+" : "/"
    ) + "===".slice(0, (4 - (payloadBase64Url.length % 4)) % 4);
    
    const payloadStr = Buffer.from(payloadBase64, "base64").toString("utf-8");
    return JSON.parse(payloadStr) as JwtPayload;
  } catch {
    return null;
  }
}

/**
 * Encode with Base64 URL encoding
 */
function base64UrlEncode(input: string): string {
  const base64 = Buffer.from(input).toString("base64");
  return base64
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * HMAC SHA-256 signing
 */
function signHmacSha256(data: string, secret: string): string {
  const hmac = createHmac("sha256", secret);
  hmac.update(data);
  return hmac.digest("base64url");
}

/**
 * Verify HMAC SHA-256 signature
 */
function verifyHmacSha256(data: string, signature: string, secret: string): boolean {
  const expected = signHmacSha256(data, secret);
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

/**
 * JWT Auth Middleware implementation
 */
export class JwtAuthMiddleware {
  private config: Required<
    Pick<JwtAuthConfig, "secret" | "issuer" | "audience" | "accessTokenLifetime" | "refreshTokenLifetime" | "clockTolerance">
  >;
  private refreshStorage: RefreshTokenStorage;

  constructor(config: JwtAuthConfig) {
    if (!config.secret) {
      throw new Error("JWT auth middleware requires a 'secret' configuration");
    }

    this.config = {
      secret: config.secret,
      issuer: config.issuer ?? "rudu-auth",
      audience: config.audience ?? "rudu-api",
      accessTokenLifetime: config.accessTokenLifetime ?? 900, // 15 minutes
      refreshTokenLifetime: config.refreshTokenLifetime ?? 604800, // 7 days
      clockTolerance: config.clockTolerance ?? 30, // 30 seconds
    };
    this.refreshStorage = config.refreshStorage ?? new InMemoryRefreshTokenStorage();
  }

  /**
   * Generate an access JWT token for a user
   */
  generateAccessToken(userId: string, customClaims: Record<string, unknown> = {}): TokenResult {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + this.config.accessTokenLifetime;

    const header = base64UrlEncode(JSON.stringify({ typ: "JWT", alg: "HS256" }));

    const payload: JwtPayload = {
      sub: userId,
      iss: this.config.issuer,
      aud: this.config.audience,
      iat: now,
      iatMs: Date.now(),
      exp,
      ...customClaims,
    };

    const payloadEnc = base64UrlEncode(JSON.stringify(payload));
    const signingData = `${header}.${payloadEnc}`;
    const signature = signHmacSha256(signingData, this.config.secret);

    const token = `${signingData}.${signature}`;

    return {
      token,
      expiresAt: exp * 1000,
    };
  }

  /**
   * Generate a refresh token
   */
  private generateRefreshToken(): string {
    return base64UrlEncode(
      Buffer.concat([
        Buffer.from(crypto.getRandomValues(new Uint8Array(16))),
        Buffer.from(Date.now().toString()),
      ]).toString("hex")
    );
  }

  /**
   * Generate a token pair (access + refresh)
   */
  async generateTokenPair(userId: string, customClaims: Record<string, unknown> = {}): Promise<TokenPair> {
    const accessTokenResult = this.generateAccessToken(userId, customClaims);
    
    const tokenId = base64UrlEncode(crypto.randomUUID());
    const refreshToken = base64UrlEncode(tokenId);
    const now = Date.now();

    const refreshTokenData: RefreshTokenData = {
      userId,
      tokenId,
      issuedAt: now,
      expiresAt: now + this.config.refreshTokenLifetime * 1000,
    };

    this.refreshStorage.set(tokenId, refreshTokenData);

    return {
      accessToken: accessTokenResult.token,
      accessTokenExpiresAt: accessTokenResult.expiresAt,
      refreshToken,
      refreshTokenExpiresAt: refreshTokenData.expiresAt,
    };
  }

  /**
   * Validate and decode a JWT token
   */
  validateToken(token: string): JwtPayload {
    const parts = token.split(".");
    if (parts.length !== 3) {
      throw new JwtValidationError("Invalid token format", "INVALID_FORMAT");
    }

    const [headerBase64, payloadBase64, signature] = parts;

    // Verify signature
    const signingData = `${headerBase64}.${payloadBase64}`;
    if (!verifyHmacSha256(signingData, signature, this.config.secret)) {
      throw new JwtValidationError("Invalid token signature", "INVALID_SIGNATURE");
    }

    // Decode payload
    let payload: JwtPayload;
    try {
      const payloadStr = Buffer.from(
        payloadBase64.replace(/[-_]/g, (char) => (char === "-" ? "+" : "/")) + "===".slice(0, (4 - (payloadBase64.length % 4)) % 4),
        "base64"
      ).toString("utf-8");
      payload = JSON.parse(payloadStr) as JwtPayload;
    } catch {
      throw new JwtValidationError("Invalid token payload", "INVALID_PAYLOAD");
    }

    // Validate payload structure
    if (!payload.sub || typeof payload.sub !== "string") {
      throw new JwtValidationError("Token must have a subject (sub) claim", "MISSING_SUBJECT");
    }

    // Check issuer if configured
    if (this.config.issuer && payload.iss && payload.iss !== this.config.issuer) {
      throw new JwtValidationError("Invalid token issuer", "INVALID_ISSUER");
    }

    // Check audience if configured  
    if (this.config.audience && payload.aud && payload.aud !== this.config.audience) {
      throw new JwtValidationError("Invalid token audience", "INVALID_AUDIENCE");
    }

    const now = Math.floor(Date.now() / 1000);

    // Check expiration time
    if (payload.exp && payload.exp < now - this.config.clockTolerance) {
      throw new JwtValidationError("Token has expired", "TOKEN_EXPIRED");
    }

    // Check not before time
    if (payload.nbf && payload.nbf > now + this.config.clockTolerance) {
      throw new JwtValidationError("Token not yet valid", "TOKEN_NOT_VALID");
    }

    return payload;
  }

  /**
   * Refresh an access token using a refresh token
   */
  async refreshToken(refreshToken: string, customClaims: Record<string, unknown> = {}): Promise<TokenPair> {
    // Decode refresh token (just base64, not signed JWT)
    let tokenId: string;
    try {
      tokenId = Buffer.from(refreshToken, "base64url").toString("utf-8");
      tokenId = base64UrlEncode(tokenId); // Extract the token ID
    } catch {
      throw new JwtValidationError("Invalid refresh token", "INVALID_REFRESH_TOKEN");
    }

    const refreshData = this.refreshStorage.get(tokenId);

    if (!refreshData) {
      throw new JwtValidationError("Refresh token not found or expired", "REFRESH_TOKEN_NOT_FOUND");
    }

    // Check if refresh token is expired
    if (refreshData.expiresAt < Date.now()) {
      this.refreshStorage.delete(tokenId);
      throw new JwtValidationError("Refresh token expired", "REFRESH_TOKEN_EXPIRED");
    }

    // Delete old refresh token and generate new pair
    this.refreshStorage.delete(tokenId);

    return this.generateTokenPair(refreshData.userId, customClaims);
  }

  /**
   * Revoke a refresh token
   */
  revokeRefreshToken(tokenId: string): void {
    this.refreshStorage.delete(tokenId);
  }

  /**
   * Middleware function to protect routes
   * Returns the decoded payload if valid, throws error otherwise
   */
  authenticate(authHeader: string | undefined | null): JwtPayload {
    if (!authHeader) {
      throw new JwtValidationError("Missing Authorization header", "MISSING_AUTH_HEADER");
    }

    if (!authHeader.startsWith("Bearer ")) {
      throw new JwtValidationError("Invalid Authorization header format (expected 'Bearer <token>')", "INVALID_AUTH_FORMAT");
    }

    const token = authHeader.slice(7); // Remove "Bearer " prefix

    // Validate Bearer token format
    if (!token || token.trim().length === 0) {
      throw new JwtValidationError("Empty token in Authorization header", "EMPTY_TOKEN");
    }

    return this.validateToken(token);
  }

  /**
   * Get user ID from auth header without throwing (returns null if invalid)
   */
  tryGetUserId(authHeader: string | undefined | null): string | null {
    try {
      const payload = this.authenticate(authHeader);
      return payload.sub;
    } catch {
      return null;
    }
  }

  /**
   * Clean up expired refresh tokens
   */
  cleanup(): void {
    if (this.refreshStorage.cleanup) {
      this.refreshStorage.cleanup();
    }
  }
}

/**
 * Express-style middleware factory
 * Creates an Express middleware for protecting routes
 */
export function expressMiddleware(jwtAuth: JwtAuthMiddleware) {
  return function middleware(req: Request & { headers: { authorization?: string } }, res: any | null, next: () => void) {
    try {
      const payload = jwtAuth.authenticate(req.headers.authorization);
      (req as any).user = payload;
      next();
    } catch (error) {
      if (error instanceof JwtValidationError) {
        res?.status(401).json({ error: error.message, code: error.code });
      } else {
        res?.status(401).json({ error: "Unauthorized" });
      }
    }
  };
}

/**
 * Default export
 */
export default JwtAuthMiddleware;
