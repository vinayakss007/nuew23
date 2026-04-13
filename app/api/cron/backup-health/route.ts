import { verifySecret } from '@/lib/crypto';
import { NextRequest, NextResponse } from 'next/server';
import { queryOne, query } from '@/lib/db/client';
import { alertSuperAdmin } from '@/lib/email/service';

// Runs every 6 hours — checks backup health and alerts if backup is overdue
export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret');
  if (!verifySecret(secret, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const lastBackup = await queryOne<any>(
      `SELECT completed_at, size_bytes, storage_path
       FROM public.backup_records
       WHERE status='completed' ORDER BY completed_at DESC LIMIT 1`
    );

    const now = Date.now();
    const alertThresholdHours = 25; // Alert if no backup in 25 hours

    if (!lastBackup || !lastBackup.completed_at) {
      // No backup ever — critical
      const alreadyAlerted = await queryOne(
        `SELECT id FROM public.backup_alerts WHERE alert_type='no_backup' AND resolved=false AND created_at > now()-interval '6 hours'`
      );
      if (!alreadyAlerted) {
        await query(
          `INSERT INTO public.backup_alerts (alert_type, message) VALUES ('no_backup', 'No backup has ever been completed')`,
        );
        await alertSuperAdmin(
          'WARNING: No database backup has ever been run',
          'Please configure automated backups immediately.\n\nVisit: /superadmin/backups'
        );
      }
      return NextResponse.json({ ok: false, alert: 'no_backup_ever' });
    }

    const hoursSinceBackup = (now - new Date(lastBackup.completed_at).getTime()) / 3600000;

    if (hoursSinceBackup > alertThresholdHours) {
      const alreadyAlerted = await queryOne(
        `SELECT id FROM public.backup_alerts WHERE alert_type='no_backup' AND resolved=false AND created_at > now()-interval '6 hours'`
      );
      if (!alreadyAlerted) {
        await query(
          `INSERT INTO public.backup_alerts (alert_type, message) VALUES ('no_backup', $1)`,
          [`No backup in ${Math.floor(hoursSinceBackup)} hours. Last backup: ${lastBackup.completed_at}`]
        );
        await alertSuperAdmin(
          `WARNING: No backup in ${Math.floor(hoursSinceBackup)} hours`,
          `Last successful backup: ${lastBackup.completed_at}\nStorage: ${lastBackup.storage_path}\nSize: ${lastBackup.size_bytes ? (lastBackup.size_bytes/1024/1024).toFixed(1)+'MB' : 'unknown'}\n\nPlease check the backup cron job.`
        );
      }
      return NextResponse.json({ ok: false, hours_since_backup: hoursSinceBackup });
    }

    return NextResponse.json({
      ok: true,
      last_backup: lastBackup.completed_at,
      hours_since: Math.round(hoursSinceBackup * 10) / 10,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
