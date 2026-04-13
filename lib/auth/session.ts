import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import bcrypt from 'bcryptjs';

// ✅ FIXED: JWT_SECRET must be set - throw error if missing
const JWT_SECRET_ENV = process.env.JWT_SECRET;
if (!JWT_SECRET_ENV) {
  throw new Error(
    'JWT_SECRET environment variable is required. ' +
    'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
  );
}
const JWT_SECRET = new TextEncoder().encode(JWT_SECRET_ENV);
const SESSION_COOKIE = 'nucrm_session';
const SESSION_EXPIRES_DAYS = 30;

// ── Password validation ──────────────────────────────────────
export function validatePassword(password: string): string | null {
  if (!password || password.length < 12)
    return 'Password must be at least 12 characters';
  if (!/[A-Z]/.test(password))
    return 'Password must contain at least one uppercase letter';
  if (!/[0-9]/.test(password))
    return 'Password must contain at least one number';
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password))
    return 'Password must contain at least one special character';
  return null;
}

// ── Password hashing ──────────────────────────────────────────
// ✅ FIXED: Using bcrypt instead of SHA-256
const BCRYPT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ── JWT tokens ────────────────────────────────────────────────
export async function createToken(userId: string): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(`${SESSION_EXPIRES_DAYS}d`)
    .setIssuedAt()
    .sign(JWT_SECRET);
}

export async function verifyToken(token: string): Promise<{ userId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return { userId: payload.sub as string };
  } catch {
    return null;
  }
}

export async function hashToken(token: string): Promise<string> {
  const { createHash } = await import('crypto');
  return createHash('sha256').update(token).digest('hex');
}

// ── Session cookie helpers ────────────────────────────────────
export async function setSessionCookie(token: string) {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    // FIX: Changed from 'strict' to 'lax' to work with ngrok and external access
    sameSite: 'lax',
    maxAge: SESSION_EXPIRES_DAYS * 24 * 60 * 60,
    path: '/',
  });
}

export async function getSessionToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE)?.value ?? null;
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

// ── Get current user from session ────────────────────────────
export async function getCurrentUser(db: any): Promise<any | null> {
  const token = await getSessionToken();
  if (!token) return null;

  const payload = await verifyToken(token);
  if (!payload) return null;

  // ✅ FIXED: Added await to hashToken call
  const tokenHash = await hashToken(token);

  // Verify session still exists in DB
  const { rows } = await db.query(
    `SELECT s.user_id, u.*
     FROM public.sessions s
     JOIN public.users u ON u.id = s.user_id
     WHERE s.token_hash = $1
       AND s.expires_at > now()
     LIMIT 1`,
    [tokenHash]
  );

  return rows[0] ?? null;
}
