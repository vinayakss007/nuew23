'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard, Users, Building2, TrendingUp, CheckSquare,
  BarChart3, Settings, Bell, Calendar, FileBarChart,
  Crown, ChevronDown, UserCheck, Trash2, Search, X, Menu, Zap, Book,
} from 'lucide-react';
import { cn, getInitials } from '@/lib/utils';
import { useState, useEffect } from 'react';

const CRM_NAV = [
  { href:'/tenant/dashboard',     label:'Dashboard',    icon:LayoutDashboard, exact:true },
  { href:'/tenant/leads',         label:'Leads',        icon:UserCheck },
  { href:'/tenant/contacts',      label:'Contacts',     icon:Users },
  { href:'/tenant/companies',     label:'Companies',    icon:Building2 },
  { href:'/tenant/deals',         label:'Deals',        icon:TrendingUp },
  { href:'/tenant/tasks',         label:'Tasks',        icon:CheckSquare },
  { href:'/tenant/calendar',      label:'Calendar',     icon:Calendar },
  { href:'/tenant/reports',       label:'Reports',      icon:FileBarChart, perm:'reports.view' },
  { href:'/tenant/analytics',     label:'Analytics',    icon:BarChart3, perm:'reports.view' },
  { href:'/tenant/automation',    label:'Automation',    icon:Zap },
  { href:'/tenant/forms',         label:'Forms',         icon:FileBarChart },
  { href:'/tenant/notifications', label:'Notifications',icon:Bell },
  { href:'/tenant/modules',        label:'Modules',       icon:Zap },
  { href:'/tenant/search',        label:'Search',       icon:Search },
  { href:'/tenant/trash',         label:'Trash',        icon:Trash2 },
  { href:'/docs',                 label:'Documentation', icon:Book, perm:'docs.view' },
];
const SETTINGS_NAV = [
  { href:'/tenant/settings/general',       label:'General' },
  { href:'/tenant/settings/team',          label:'Team' },
  { href:'/tenant/settings/roles',         label:'Roles & Permissions', adminOnly:true },
  { href:'/tenant/settings/billing',       label:'Billing' },
  { href:'/tenant/settings/integrations',  label:'Integrations' },
  { href:'/tenant/settings/webhooks',      label:'Webhooks' },
  { href:'/tenant/settings/pipelines',     label:'Pipelines',          adminOnly:true },
  { href:'/tenant/settings/email',         label:'Email' },
  { href:'/tenant/settings/backup',        label:'Backup',             adminOnly:true },
  { href:'/tenant/settings/sessions',      label:'Active Sessions' },
  { href:'/tenant/settings/audit',         label:'Audit Log', adminOnly:true },
  { href:'/tenant/settings/custom-fields', label:'Custom Fields', adminOnly:true },
  { href:'/tenant/settings/api-keys',      label:'API Keys', adminOnly:true },
  { href:'/tenant/settings/profile',       label:'My Profile' },
  { href:'/tenant/settings/security',      label:'Security & 2FA' },
  { href:'/tenant/settings/telegram',      label:'Telegram Alerts' },
];

interface Props {
  tenant:any; profile:any; roleSlug:string;
  permissions:Record<string,boolean>; isAdmin:boolean; isSuperAdmin:boolean;
  collapsed?: boolean; onToggle?: () => void;
}

export default function TenantSidebar({ tenant, profile, roleSlug, permissions, isAdmin, isSuperAdmin, collapsed=false, onToggle }: Props) {
  const pathname = usePathname();
  const [settingsOpen, setSettingsOpen] = useState(pathname.startsWith('/tenant/settings'));
  const color = tenant?.primary_color || '#7c3aed';

  const hasPerm = (perm?: string) => !perm || isAdmin || permissions?.['all'] || permissions?.[perm];
  const isActive = (href: string, exact?: boolean) => exact ? pathname === href : pathname.startsWith(href);

  // Close settings accordion when navigating away
  useEffect(() => {
    if (!pathname.startsWith('/tenant/settings')) setSettingsOpen(false);
  }, [pathname]);

  if (collapsed) {
    return (
      <aside className="tenant-sidebar w-[56px] shrink-0 h-full flex flex-col items-center py-3 gap-1 transition-all duration-200">
        <button onClick={onToggle} className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-accent text-muted-foreground transition-colors mb-2">
          <Menu className="w-4 h-4" />
        </button>
        {CRM_NAV.filter(n=>hasPerm(n.perm)).slice(0,8).map(({href,icon:Icon,label,exact})=>{
          const active = isActive(href, exact);
          return (
            <Link key={href} href={href} title={label}
              className={cn('w-9 h-9 flex items-center justify-center rounded-lg transition-all',
                active ? 'bg-violet-50 dark:bg-violet-950/50 text-violet-700 dark:text-violet-400' : 'text-muted-foreground hover:bg-accent hover:text-foreground')}>
              <Icon className="w-4 h-4" />
            </Link>
          );
        })}
        {isSuperAdmin && (
          <Link href="/superadmin/dashboard" title="Super Admin" className="w-9 h-9 flex items-center justify-center rounded-lg text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/20 transition-colors mt-auto">
            <Crown className="w-4 h-4" />
          </Link>
        )}
      </aside>
    );
  }

  return (
    <aside className="tenant-sidebar w-[240px] shrink-0 h-full flex flex-col transition-all duration-200">
      {/* Brand header */}
      <div className="h-14 flex items-center gap-2.5 px-4 border-b border-border shrink-0">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm font-bold shrink-0 shadow-sm" style={{ background: color }}>
          {tenant?.name?.charAt(0)?.toUpperCase() ?? 'W'}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold truncate leading-tight">{tenant?.name ?? 'Workspace'}</p>
          <p className="text-[10px] text-muted-foreground leading-tight capitalize">{tenant?.plan?.name ?? 'Free'} plan</p>
        </div>
        {onToggle && (
          <button onClick={onToggle} className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg hover:bg-accent text-muted-foreground transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-3 overflow-y-auto scrollbar-thin space-y-0.5">
        {CRM_NAV.filter(n => hasPerm(n.perm)).map(({ href, label, icon: Icon, exact }) => {
          const active = isActive(href, exact);
          return (
            <Link key={href} href={href}
              className={cn('tenant-nav-item',
                active ? 'active'
                       : '')}>
              <Icon className={cn('w-4 h-4 shrink-0', active && 'text-violet-600 dark:text-violet-400')} />
              {label}
            </Link>
          );
        })}

        {/* Settings accordion */}
        <div className="pt-2">
          <button onClick={() => setSettingsOpen(o => !o)}
            className={cn('flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all w-full',
              pathname.startsWith('/tenant/settings')
                ? 'bg-violet-50 dark:bg-violet-950/50 text-violet-700 dark:text-violet-400'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground')}>
            <Settings className={cn('w-4 h-4 shrink-0', pathname.startsWith('/tenant/settings') && 'text-violet-600')} />
            <span className="flex-1 text-left">Settings</span>
            <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', settingsOpen && 'rotate-180')} />
          </button>
          {settingsOpen && (
            <div className="ml-7 mt-0.5 pl-3 border-l border-border space-y-0.5">
              {SETTINGS_NAV.filter(item => !item.adminOnly || isAdmin).map(item => (
                <Link key={item.href} href={item.href}
                  className={cn('flex items-center px-2.5 py-1.5 rounded-md text-[12.5px] font-medium transition-colors',
                    pathname === item.href
                      ? 'text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-950/30 font-semibold'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent')}>
                  {item.label}
                </Link>
              ))}
            </div>
          )}
        </div>
      </nav>

      {/* Footer */}
      <div className="p-3 border-t border-border space-y-0.5 shrink-0">
        {isSuperAdmin && (
          <Link href="/superadmin/dashboard" className="flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-semibold text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/20 transition-colors">
            <Crown className="w-3.5 h-3.5" />Super Admin
          </Link>
        )}
      </div>
    </aside>
  );
}
