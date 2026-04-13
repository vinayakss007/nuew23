export class ValidationError extends Error {
  status = 400;
  constructor(message: string) { super(message); this.name = 'ValidationError'; }
}

// String: trim, enforce max length, required
export function str(val: any, field: string, opts: { required?: boolean; max?: number; min?: number } = {}): string | null {
  if (val === undefined || val === null || val === '') {
    if (opts.required) throw new ValidationError(`${field} is required`);
    return null;
  }
  const s = String(val).trim();
  if (opts.min && s.length < opts.min) throw new ValidationError(`${field} must be at least ${opts.min} characters`);
  if (opts.max && s.length > opts.max) throw new ValidationError(`${field} must be ${opts.max} characters or less`);
  return s;
}

// Email: validate format
export function email(val: any, field = 'email'): string | null {
  const s = str(val, field);
  if (!s) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new ValidationError(`${field} is not a valid email address`);
  return s.toLowerCase();
}

// Number: parse, range check
export function num(val: any, field: string, opts: { required?: boolean; min?: number; max?: number } = {}): number | null {
  if (val === undefined || val === null || val === '') {
    if (opts.required) throw new ValidationError(`${field} is required`);
    return null;
  }
  const n = Number(val);
  if (isNaN(n)) throw new ValidationError(`${field} must be a number`);
  if (opts.min !== undefined && n < opts.min) throw new ValidationError(`${field} must be at least ${opts.min}`);
  if (opts.max !== undefined && n > opts.max) throw new ValidationError(`${field} must be ${opts.max} or less`);
  return n;
}

// Enum: must be one of allowed values
export function enumVal<T extends string>(val: any, field: string, allowed: T[], required = false): T | null {
  if (!val) {
    if (required) throw new ValidationError(`${field} is required`);
    return null;
  }
  if (!allowed.includes(val)) throw new ValidationError(`${field} must be one of: ${allowed.join(', ')}`);
  return val as T;
}

// Return 400 response from a caught ValidationError
export function validationResponse(err: unknown) {
  if (err instanceof ValidationError) {
    const { NextResponse } = require('next/server');
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  return null;
}
