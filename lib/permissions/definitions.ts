/**
 * Permission Definitions
 * ─────────────────────
 * Format: resource.action
 * These are checked via has_permission() DB function.
 */

export interface Permission {
  id: string;
  label: string;
  description: string;
  category: string;
  dangerLevel: 'safe' | 'moderate' | 'danger';
}

export const PERMISSIONS: Permission[] = [
  // ── Contacts ─────────────────────────────────────────────
  { id: 'contacts.view_all',   label: 'View All Contacts',   description: 'See contacts created by others', category: 'Contacts', dangerLevel: 'safe' },
  { id: 'contacts.create',     label: 'Create Contacts',     description: 'Add new contacts',               category: 'Contacts', dangerLevel: 'safe' },
  { id: 'contacts.edit',       label: 'Edit Contacts',       description: 'Modify existing contacts',       category: 'Contacts', dangerLevel: 'moderate' },
  { id: 'contacts.delete',     label: 'Delete Contacts',     description: 'Permanently remove contacts',    category: 'Contacts', dangerLevel: 'danger' },
  { id: 'contacts.import',     label: 'Import Contacts',     description: 'Bulk import via CSV',            category: 'Contacts', dangerLevel: 'moderate' },
  { id: 'contacts.export',     label: 'Export Contacts',     description: 'Download contact data',          category: 'Contacts', dangerLevel: 'moderate' },
  { id: 'contacts.merge',      label: 'Merge Contacts',      description: 'Merge duplicate contacts',       category: 'Contacts', dangerLevel: 'danger' },
  { id: 'contacts.assign',     label: 'Assign Contacts',     description: 'Change contact owner',           category: 'Contacts', dangerLevel: 'moderate' },

  // ── Leads ────────────────────────────────────────────────
  { id: 'leads.view_all',      label: 'View All Leads',      description: 'See leads created by others',    category: 'Leads',    dangerLevel: 'safe' },
  { id: 'leads.create',        label: 'Create Leads',        description: 'Add new leads',                  category: 'Leads',    dangerLevel: 'safe' },
  { id: 'leads.edit',          label: 'Edit Leads',          description: 'Modify existing leads',          category: 'Leads',    dangerLevel: 'moderate' },
  { id: 'leads.delete',        label: 'Delete Leads',        description: 'Permanently remove leads',       category: 'Leads',    dangerLevel: 'moderate' },
  { id: 'leads.import',        label: 'Import Leads',        description: 'Bulk import via CSV',            category: 'Leads',    dangerLevel: 'moderate' },
  { id: 'leads.export',        label: 'Export Leads',        description: 'Download lead data',             category: 'Leads',    dangerLevel: 'moderate' },
  { id: 'leads.assign',        label: 'Assign Leads',        description: 'Change lead owner',              category: 'Leads',    dangerLevel: 'moderate' },

  // ── Companies ────────────────────────────────────────────
  { id: 'companies.view_all',  label: 'View All Companies',  description: 'See all companies',              category: 'Companies', dangerLevel: 'safe' },
  { id: 'companies.create',    label: 'Create Companies',    description: 'Add new companies',              category: 'Companies', dangerLevel: 'safe' },
  { id: 'companies.edit',      label: 'Edit Companies',      description: 'Modify companies',               category: 'Companies', dangerLevel: 'moderate' },
  { id: 'companies.delete',    label: 'Delete Companies',    description: 'Remove companies',               category: 'Companies', dangerLevel: 'danger' },

  // ── Deals ────────────────────────────────────────────────
  { id: 'deals.view_all',      label: 'View All Deals',      description: 'See deals assigned to others',  category: 'Deals', dangerLevel: 'safe' },
  { id: 'deals.create',        label: 'Create Deals',        description: 'Add new deals',                 category: 'Deals', dangerLevel: 'safe' },
  { id: 'deals.edit',          label: 'Edit Deals',          description: 'Update deal info/stage',        category: 'Deals', dangerLevel: 'moderate' },
  { id: 'deals.delete',        label: 'Delete Deals',        description: 'Remove deals permanently',      category: 'Deals', dangerLevel: 'danger' },
  { id: 'deals.assign',        label: 'Assign Deals',        description: 'Change deal owner',             category: 'Deals', dangerLevel: 'moderate' },
  { id: 'deals.view_value',    label: 'View Deal Values',    description: 'See financial amounts',         category: 'Deals', dangerLevel: 'safe' },

  // ── Tasks ────────────────────────────────────────────────
  { id: 'tasks.view_all',      label: 'View All Tasks',      description: 'See tasks of all team members', category: 'Tasks', dangerLevel: 'safe' },
  { id: 'tasks.create',        label: 'Create Tasks',        description: 'Create new tasks',              category: 'Tasks', dangerLevel: 'safe' },
  { id: 'tasks.edit',          label: 'Edit Tasks',          description: 'Update tasks',                  category: 'Tasks', dangerLevel: 'moderate' },
  { id: 'tasks.delete',        label: 'Delete Tasks',        description: 'Remove tasks',                  category: 'Tasks', dangerLevel: 'danger' },
  { id: 'tasks.assign',        label: 'Assign Tasks',        description: 'Assign tasks to team members',  category: 'Tasks', dangerLevel: 'moderate' },

  // ── Reports ──────────────────────────────────────────────
  { id: 'reports.view',        label: 'View Reports',        description: 'Access analytics & reports',    category: 'Reports', dangerLevel: 'safe' },
  { id: 'reports.export',      label: 'Export Reports',      description: 'Download report data',          category: 'Reports', dangerLevel: 'moderate' },

  // ── Settings ─────────────────────────────────────────────
  { id: 'settings.view',       label: 'View Settings',       description: 'See workspace settings',        category: 'Settings', dangerLevel: 'safe' },
  { id: 'settings.manage',     label: 'Manage Settings',     description: 'Change workspace settings',     category: 'Settings', dangerLevel: 'danger' },

  // ── Team ─────────────────────────────────────────────────
  { id: 'team.view',           label: 'View Team',           description: 'See team members',              category: 'Team', dangerLevel: 'safe' },
  { id: 'team.invite',         label: 'Invite Members',      description: 'Send team invitations',         category: 'Team', dangerLevel: 'moderate' },
  { id: 'team.remove',         label: 'Remove Members',      description: 'Remove users from workspace',   category: 'Team', dangerLevel: 'danger' },
  { id: 'team.manage_roles',   label: 'Manage Roles',        description: 'Create/edit roles & permissions', category: 'Team', dangerLevel: 'danger' },

  // ── Automations ──────────────────────────────────────────
  { id: 'automations.view',    label: 'View Automations',    description: 'See automations',               category: 'Automations', dangerLevel: 'safe' },
  { id: 'automations.manage',  label: 'Manage Automations',  description: 'Create/edit/delete automations', category: 'Automations', dangerLevel: 'moderate' },

  // ── Billing ──────────────────────────────────────────────
  { id: 'billing.view',        label: 'View Billing',        description: 'See subscription info',         category: 'Billing', dangerLevel: 'safe' },
  { id: 'billing.manage',      label: 'Manage Billing',      description: 'Change plan, billing details',  category: 'Billing', dangerLevel: 'danger' },
];

export const PERMISSION_CATEGORIES = [...new Set(PERMISSIONS.map(p => p.category))];

// ── Default permission sets per role ─────────────────────────
export const DEFAULT_ROLE_PERMISSIONS: Record<string, Record<string, boolean>> = {
  admin: Object.fromEntries(PERMISSIONS.map(p => [p.id, true])),
  manager: Object.fromEntries(PERMISSIONS.filter(p => p.dangerLevel !== 'danger' || ['contacts.delete', 'companies.delete'].includes(p.id) === false).map(p => [p.id, p.dangerLevel !== 'danger'])),
  sales_rep: {
    'contacts.create': true, 'contacts.edit': true, 'contacts.view_all': false,
    'deals.create': true, 'deals.edit': true, 'deals.view_all': false, 'deals.view_value': true,
    'tasks.create': true, 'tasks.edit': true,
    'companies.create': true, 'companies.edit': true,
    'team.view': true, 'reports.view': false,
  },
  viewer: Object.fromEntries(PERMISSIONS.map(p => [p.id, p.id.endsWith('.view') || p.id.endsWith('.view_all')])),
};

// ── Check if a permissions object allows a given permission ──
export function checkPermission(permissions: Record<string, boolean>, permission: string): boolean {
  if (permissions['all'] === true) return true;
  return permissions[permission] === true;
}

// ── Get permissions diff between two roles ────────────────────
export function getPermissionsDiff(base: Record<string, boolean>, override: Record<string, boolean>) {
  const added: string[] = [];
  const removed: string[] = [];
  for (const perm of PERMISSIONS.map(p => p.id)) {
    const baseHas = checkPermission(base, perm);
    const overrideHas = checkPermission(override, perm);
    if (!baseHas && overrideHas) added.push(perm);
    if (baseHas && !overrideHas) removed.push(perm);
  }
  return { added, removed };
}
