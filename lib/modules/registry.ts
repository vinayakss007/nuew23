/**
 * Module Registry — central hub for NuCRM modules.
 * Modules are self-contained services (WhatsApp, AI, Forms, etc.)
 * that plug in without touching core CRM tables.
 */
import { query, queryMany, queryOne } from '@/lib/db/client';
import type { ModuleManifest, TenantModule } from '@/types';

export const BUILTIN_MODULES: ModuleManifest[] = [
  {
    id: 'core-crm', name: 'Core CRM', version: '1.0.0',
    description: 'Contacts, companies, deals, tasks, calendar, reports',
    author: 'NuCRM', category: 'utility', icon: '📋', minCrmVersion: '1.0.0',
    pricing: { free:{enabled:true},starter:{enabled:true},pro:{enabled:true},enterprise:{enabled:true} },
    features: ['Contacts','Companies','Deals (Kanban)','Tasks','Calendar','Reports','CSV Import/Export'],
    permissions: [],
  },
  {
    id: 'automation-basic', name: 'Basic Automation', version: '1.0.0',
    description: '5 pre-built one-click workflows',
    author: 'NuCRM', category: 'automation', icon: '⚡', minCrmVersion: '1.0.0',
    pricing: { free:{enabled:true},starter:{enabled:true},pro:{enabled:true},enterprise:{enabled:true} },
    features: ['Welcome email','Task reminders','Deal stage alerts','Lead assignment notify','Trial expiry warnings'],
    permissions: ['automations.view','automations.manage'],
  },
  {
    id: 'automation-pro', name: 'Automation Pro', version: '1.0.0',
    description: 'Visual workflow builder, multi-step sequences, conditional branching',
    author: 'NuCRM', category: 'automation', icon: '🚀', minCrmVersion: '1.0.0',
    pricing: { free:{enabled:false},starter:{enabled:true,price:29},pro:{enabled:true,price:29},enterprise:{enabled:true,price:0} },
    features: ['Visual drag-drop builder','Unlimited automations','Conditional logic','Multi-step sequences','Delay actions','Branching'],
    permissions: ['automations.view','automations.manage'],
    pages: ['/tenant/automation/builder','/tenant/sequences'],
    webhooks: ['automation.triggered','sequence.step_completed'],
  },
  {
    id: 'whatsapp-bot', name: 'WhatsApp Automation', version: '1.0.0',
    description: 'WhatsApp Business API — send messages, auto-replies, campaigns',
    author: 'NuCRM', category: 'messaging', icon: '💬', minCrmVersion: '1.0.0',
    pricing: { free:{enabled:false},starter:{enabled:true,price:19},pro:{enabled:true,price:19},enterprise:{enabled:true,price:0} },
    features: ['WhatsApp Business API','Template messages','Auto-replies','Bulk campaigns','Analytics'],
    permissions: ['automations.manage'],
    settings_schema: [
      { key:'phone_number_id', label:'Phone Number ID', type:'text', required:true },
      { key:'access_token', label:'Access Token', type:'password', required:true },
      { key:'verify_token', label:'Webhook Verify Token', type:'text', required:false },
    ],
    webhooks: ['whatsapp.message_received','whatsapp.message_delivered'],
  },
  {
    id: 'email-sync', name: 'Email Sync', version: '1.0.0',
    description: 'Gmail & Outlook 2-way sync — read/send email in CRM, auto-log to contacts',
    author: 'NuCRM', category: 'integration', icon: '📧', minCrmVersion: '1.0.0',
    pricing: { free:{enabled:false},starter:{enabled:true,price:15},pro:{enabled:true,price:15},enterprise:{enabled:true,price:0} },
    features: ['Gmail OAuth','Outlook OAuth','2-way sync','Auto-log to contacts','Email open tracking','Click tracking'],
    permissions: [],
    settings_schema: [
      { key:'provider', label:'Provider', type:'select', required:true,
        options:[{value:'gmail',label:'Gmail'},{value:'outlook',label:'Outlook'}] },
    ],
  },
  {
    id: 'ai-assistant', name: 'AI Assistant', version: '1.0.0',
    description: 'Claude AI — draft emails, score leads, predict deals, enrich contacts',
    author: 'NuCRM', category: 'ai', icon: '🤖', minCrmVersion: '1.0.0',
    pricing: { free:{enabled:false},starter:{enabled:false},pro:{enabled:true,price:25},enterprise:{enabled:true,price:0} },
    features: ['AI email drafting','Lead scoring (0-100)','Deal win prediction','Contact enrichment','Smart follow-ups'],
    permissions: [],
    settings_schema: [
      { key:'anthropic_api_key', label:'Anthropic API Key', type:'password', required:false,
        help:'Leave blank to use platform key' },
    ],
  },
  {
    id: 'forms-builder', name: 'Forms Builder', version: '1.0.0',
    description: 'Build custom lead capture forms — drag-drop, conditional logic, embeddable anywhere',
    author: 'NuCRM', category: 'utility', icon: '📝', minCrmVersion: '1.0.0',
    pricing: { free:{enabled:false},starter:{enabled:true,price:10},pro:{enabled:true,price:10},enterprise:{enabled:true,price:0} },
    features: ['Visual builder','Custom fields','Conditional logic','Multi-step','Embed script','Spam protection'],
    permissions: [],
    pages: ['/tenant/forms','/tenant/forms/builder'],
  },
  {
    id: 'analytics-pro', name: 'Analytics Pro', version: '1.0.0',
    description: 'Custom report builder, PDF export, scheduled reports, funnel charts',
    author: 'NuCRM', category: 'analytics', icon: '📊', minCrmVersion: '1.0.0',
    pricing: { free:{enabled:false},starter:{enabled:false},pro:{enabled:true,price:15},enterprise:{enabled:true,price:0} },
    features: ['Custom report builder','Funnel analytics','PDF export','Scheduled email reports','Revenue forecasting'],
    permissions: ['reports.view','reports.export'],
  },
];

export class ModuleRegistry {
  static getAll() { return BUILTIN_MODULES; }

  static get(moduleId: string): ModuleManifest | null {
    return BUILTIN_MODULES.find(m => m.id === moduleId) ?? null;
  }

  static async getTenantModules(tenantId: string): Promise<any[]> {
    const rows = await queryMany(
      `SELECT tm.*, m.name, m.description, m.category, m.icon, m.is_free, m.price_monthly
       FROM public.tenant_modules tm
       JOIN public.modules m ON m.id = tm.module_id
       WHERE tm.tenant_id = $1
       ORDER BY m.sort_order`,
      [tenantId]
    );
    // Merge DB data with manifest
    return rows.map(r => ({
      ...r,
      manifest: ModuleRegistry.get(r.module_id) ?? {},
    }));
  }

  static async hasModule(tenantId: string, moduleId: string): Promise<boolean> {
    const row = await queryOne<{ status: string }>(
      `SELECT status FROM public.tenant_modules WHERE tenant_id=$1 AND module_id=$2`,
      [tenantId, moduleId]
    );
    return row?.status === 'active';
  }

  static async install(tenantId: string, moduleId: string, installedBy: string, settings: Record<string,any> = {}): Promise<{ok:boolean;error?:string}> {
    if (!ModuleRegistry.get(moduleId)) return { ok: false, error: 'Module not found' };
    try {
      await query(
        `INSERT INTO public.tenant_modules (tenant_id,module_id,status,settings,installed_by)
         VALUES ($1,$2,'active',$3,$4)
         ON CONFLICT (tenant_id,module_id) DO UPDATE
           SET status='active', settings=$3, installed_by=$4`,
        [tenantId, moduleId, JSON.stringify(settings), installedBy]
      );
      // Ensure module exists in registry table
      const manifest = ModuleRegistry.get(moduleId)!;
      await query(
        `INSERT INTO public.modules (id,name,version,description,category,icon,manifest)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO NOTHING`,
        [moduleId, manifest.name, manifest.version, manifest.description,
         manifest.category, manifest.icon, JSON.stringify(manifest)]
      ).catch(() => {});
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  static async disable(tenantId: string, moduleId: string): Promise<void> {
    await query(
      `UPDATE public.tenant_modules SET status='disabled' WHERE tenant_id=$1 AND module_id=$2`,
      [tenantId, moduleId]
    );
  }

  static async getSettings(tenantId: string, moduleId: string): Promise<Record<string,any>> {
    const row = await queryOne<{settings:any}>(
      `SELECT settings FROM public.tenant_modules WHERE tenant_id=$1 AND module_id=$2`,
      [tenantId, moduleId]
    );
    return row?.settings ?? {};
  }

  static async updateSettings(tenantId: string, moduleId: string, settings: Record<string,any>): Promise<void> {
    await query(
      `UPDATE public.tenant_modules SET settings=$3, last_used_at=now() WHERE tenant_id=$1 AND module_id=$2`,
      [tenantId, moduleId, JSON.stringify(settings)]
    );
  }
}

export default ModuleRegistry;
