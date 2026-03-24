# JWT Auth Middleware

A complete JWT-based authentication middleware implementation for Node.js/TypeScript applications.

## Features

- ✅ **JWT Access Tokens** - HMAC-SHA256 signed tokens with configurable expiration
- ✅ **Refresh Token Rotation** - Secure refresh tokens with automatic rotation
- ✅ **In-Memory & Custom Storage** - Pluggable storage for refresh tokens
- ✅ **Express-Style Middleware** - Easy integration with web frameworks
- ✅ **Configurable Options** - Token lifetimes, issuer, audience, clock tolerance
- ✅ **Type-Safe API** - Full TypeScript support with comprehensive types

## Installation

The module is included at `src/services/auth/JwtAuthMiddleware.ts`.

## Quick Start

```typescript
import JwtAuthMiddleware from "./src/services/auth/JwtAuthMiddleware";

// Initialize with your secret
const auth = new JwtAuthMiddleware({
  secret: "your-secret-key-here",
  issuer: "your-app",
  audience: "your-api",
  accessTokenLifetime: 900,  // 15 minutes
  refreshTokenLifetime: 604800,  // 7 days
});

// Generate tokens for a user
const pair = await auth.generateTokenPair("user-123");

// Access token: used for API calls
console.log(pair.accessToken);
console.log("Expires at:", new Date(pair.accessTokenExpiresAt));

// Refresh token: used to get new access tokens
console.log(pair.refreshToken);
console.log("Expires at:", new Date(pair.refreshTokenExpiresAt));

// Validate an access token
const payload = auth.validateToken(pair.accessToken);
console.log("User ID:", payload.sub);
console.log("Custom claims:", payload.role, payload.email);
```

## Express Middleware Example

```typescript
import express from "express";
import { expressMiddleware } from "./src/services/auth/JwtAuthMiddleware";

const app = express();
const auth = new JwtAuthMiddleware({ secret: "your-secret" });

// Protect routes
app.use("/api/*", expressMiddleware(auth));

// Your protected routes
app.get("/api/user", (req: any, res) => {
  res.json({ userId: req.user.sub, email: req.user.email });
});
```

## Authentication Flow

### 1. User Login
```typescript
// In your login handler
app.post("/auth/login", async (req, res) => {
  const { email, password } = req.body;
  
  // Validate credentials
  const user = await authenticateUser(email, password);
  if (!user) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  // Generate tokens
  const pair = await auth.generateTokenPair(user.id, {
    email: user.email,
    role: user.role,
  });

  res.json(pair);
});
```

### 2. Protecting Routes
```typescript
// Express middleware
app.use("/api/*", expressMiddleware(auth));

// Or manual validation
app.get("/api/protected", (req, res) => {
  try {
    const payload = auth.authenticate(req.headers.authorization);
    // Process request...
    res.json({ data: "protected data", user: payload.sub });
  } catch (error) {
    res.status(401).json({ error: "Unauthorized" });
  }
});
```

### 3. Token Refresh
```typescript
app.post("/auth/refresh", async (req, res) => {
  try {
    const { refreshToken } = req.body;
    const newPair = await auth.refreshToken(refreshToken);
    res.json(newPair);
  } catch (error) {
    res.status(401).json({ error: "Invalid refresh token" });
  }
});
```

### 4. Logout
```typescript
app.post("/auth/logout", async (req, res) => {
  const { refreshToken } = req.body;
  const tokenId = Buffer.from(refreshToken, "base64url").toString("utf-8");
  auth.revokeRefreshToken(tokenId);
  res.json({ message: "Logged out" });
});
```

## API Reference

### `JwtAuthMiddleware`

#### Constructor Options

```typescript
interface JwtAuthConfig {
  secret: string;                      // Required: Secret key for signing
  issuer?: string;                     // Token issuer (default: "rudu-auth")
  audience?: string;                   // Token audience (default: "rudu-api")
  accessTokenLifetime?: number;        // Seconds (default: 900 = 15 mins)
  refreshTokenLifetime?: number;       // Seconds (default: 604800 = 7 days)
  clockTolerance?: number;             // Seconds for clock skew (default: 30)
  refreshStorage?: RefreshTokenStorage; // Custom storage implementation
}
```

#### Methods

##### `generateAccessToken(userId, customClaims?)`

Generate a new access token.

```typescript
const result = auth.generateAccessToken("user-123", {
  email: "user@example.com",
  role: "admin",
});
// Returns: { token: string, expiresAt: number }
```

##### `generateTokenPair(userId, customClaims?)`

Generate both access and refresh tokens.

```typescript
const pair = await auth.generateTokenPair("user-123", {
  email: "user@example.com",
  role: "admin",
});
// Returns: { accessToken, refreshToken, accessTokenExpiresAt, refreshTokenExpiresAt }
```

##### `validateToken(token)`

Validate and decode a JWT token. Throws `JwtValidationError` if invalid.

```typescript
const payload = auth.validateToken(token);
// Returns: JwtPayload
```

##### `refreshToken(refreshToken, customClaims?)`

Generate a new token pair using a refresh token. The old refresh token is revoked.

```typescript
const newPair = await auth.refreshToken(refreshToken);
// Returns: TokenPair
```

##### `revokeRefreshToken(tokenId)`

Revoke a refresh token.

```typescript
auth.revokeRefreshToken(tokenId);
```

##### `authenticate(authHeader)`

Authenticate a request's Authorization header. Throws `JwtValidationError` if invalid.

```typescript
const payload = auth.authenticate(req.headers.authorization);
// Returns: JwtPayload
```

##### `tryGetUserId(authHeader)`

Safely get user ID from auth header. Returns `null` if invalid (no throw).

```typescript
const userId = auth.tryGetUserId(req.headers.authorization);
// Returns: string | null
```

##### `cleanup()`

Clean up expired refresh tokens from storage.

```typescript
auth.cleanup();
```

### `JwtValidationError`

Error thrown when authentication fails.

```typescript
class JwtValidationError extends Error {
  code: string;  // Error code: INVALID_FORMAT, INVALID_SIGNATURE, TOKEN_EXPIRED, etc.
}
```

### Error Codes

| Code | Description |
|------|-------------|
| `INVALID_FORMAT` | Token has wrong format |
| `INVALID_SIGNATURE` | Token signature verification failed |
| `INVALID_PAYLOAD` | Token payload is malformed |
| `MISSING_SUBJECT` | Token missing subject claim |
| `INVALID_ISSUER` | Token issuer doesn't match |
| `INVALID_AUDIENCE` | Token audience doesn't match |
| `TOKEN_EXPIRED` | Token has expired |
| `TOKEN_NOT_VALID` | Token not yet valid (nbf check) |
| `MISSING_AUTH_HEADER` | No Authorization header |
| `INVALID_AUTH_FORMAT` | Wrong Bearer format |
| `EMPTY_TOKEN` | Empty token value |
| `REFRESH_TOKEN_NOT_FOUND` | Refresh token not found |
| `REFRESH_TOKEN_EXPIRED` | Refresh token expired |

## Custom Storage

You can implement custom refresh token storage:

```typescript
import type { RefreshTokenStorage, RefreshTokenData } from "./JwtAuthMiddleware";

class RedisRefreshTokenStorage implements RefreshTokenStorage {
  async set(tokenId: string, data: RefreshTokenData): Promise<void> {
    await redis.setex(`refresh:${tokenId}`, 86400, JSON.stringify(data));
  }

  async get(tokenId: string): Promise<RefreshTokenData | undefined> {
    const data = await redis.get(`refresh:${tokenId}`);
    return data ? JSON.parse(data) : undefined;
  }

  async delete(tokenId: string): Promise<void> {
    await redis.del(`refresh:${tokenId}`);
  }
}

const auth = new JwtAuthMiddleware({
  secret: "your-secret",
  refreshStorage: new RedisRefreshTokenStorage(),
});
```

## Security Best Practices

1. **Use strong secrets** - At least 32 characters of random data
2. **HTTPS only** - Never send tokens over unencrypted connections
3. **Short-lived access tokens** - 5-15 minutes is typical
4. **Refresh token rotation** - Always issue new refresh tokens on refresh
5. **Secure token storage** - Store refresh tokens in HTTP-only cookies
6. **Validate all tokens** - Always use `validateToken()` or `authenticate()`
7. **Clock tolerance** - Keep it low (30s default) to reduce replay windows

## Testing

Run the test suite:

```bash
bun test src/services/auth/JwtAuthMiddleware.test.ts
```

## License

MIT
