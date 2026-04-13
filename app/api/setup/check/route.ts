import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db/client';

// Public endpoint — checks if any SUPER ADMIN users exist yet
export async function GET() {
  try {
    const row = await queryOne<{ count: number }>(
      'SELECT count(*)::int as count FROM public.users WHERE is_super_admin = true'
    );
    // In development mode, allow setup even if users exist
    if (process.env.NODE_ENV === 'development') {
      return NextResponse.json({ setup_done: false });
    }
    return NextResponse.json({ setup_done: (row?.count ?? 0) > 0 });
  } catch {
    // DB not connected yet — setup not done
    return NextResponse.json({ setup_done: false });
  }
}
