/**
 * CSRF Protection Module
 * 
 * Implements Double Submit Cookie pattern for CSRF protection
 */

import { createHash, randomBytes } from 'crypto';

const CSRF_COOKIE_NAME = 'nucrm_csrf_token';
const CSRF_HEADER_NAME = 'x-csrf-token';

/**
 * Generate a cryptographically secure CSRF token
 */
export function generateCsrfToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Hash a CSRF token for secure storage
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Set CSRF token in cookie
 */
export function setCsrfCookie(token: string, isProduction: boolean = false): string {
  const cookieOptions = [
    `${CSRF_COOKIE_NAME}=${token}`,
    'Path=/',
    'SameSite=Strict',
    isProduction ? 'Secure' : null,
  ].filter(Boolean).join('; ');
  
  return cookieOptions;
}

/**
 * Extract CSRF token from cookie header
 */
export function getCsrfTokenFromCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  
  const match = cookieHeader.match(/(?:^|;\s*)nucrm_csrf_token=([^;]+)/);
  return match?.[1] ?? null;
}

/**
 * Extract CSRF token from request header
 */
export function getCsrfTokenFromHeader(headers: Headers, headerName: string = CSRF_HEADER_NAME): string | null {
  return headers.get(headerName) ?? null;
}

/**
 * Validate CSRF token using Double Submit Cookie pattern
 * 
 * This pattern works by:
 * 1. Setting a random token in a cookie (HttpOnly: false, so JS can read it)
 * 2. Client sends the token in a custom header (X-CSRF-Token)
 * 3. Server compares cookie token with header token
 * 
 * Since attacker cannot read the cookie (same-origin policy) or set custom headers,
 * they cannot forge a valid request.
 */
export function validateCsrfToken(
  cookieToken: string | null,
  headerToken: string | null
): boolean {
  if (!cookieToken || !headerToken) {
    return false;
  }
  
  // Constant-time comparison to prevent timing attacks
  const cookieHash = hashToken(cookieToken);
  const headerHash = hashToken(headerToken);
  
  if (cookieHash.length !== headerHash.length) {
    return false;
  }
  
  let result = 0;
  for (let i = 0; i < cookieHash.length; i++) {
    result |= cookieHash.charCodeAt(i) ^ headerHash.charCodeAt(i);
  }
  
  return result === 0;
}

/**
 * Middleware to validate CSRF token for state-changing requests
 * 
 * Safe methods (GET, HEAD, OPTIONS) are exempt from CSRF protection
 */
export function isSafeMethod(method: string): boolean {
  return ['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
}

/**
 * Check if request needs CSRF validation
 * 
 * Exemptions:
 * - Safe HTTP methods (GET, HEAD, OPTIONS)
 * - API key authenticated requests (already secure)
 * - Webhook endpoints (use signature verification)
 */
export function needsCsrfValidation(method: string, path: string, authMethod?: string): boolean {
  if (isSafeMethod(method)) return false;
  if (authMethod === 'api_key') return false;
  if (path.startsWith('/api/webhooks/')) return false;
  if (path.startsWith('/api/cron/')) return false;
  
  return true;
}
