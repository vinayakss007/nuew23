"use client"

import { useState, useCallback, useMemo } from 'react'
import { MoreHorizontal, Crown, XCircle, ShieldOff, Plus, Mail, Loader2, Eye, CheckCircle } from 'lucide-react'
import { cn, formatDate, formatRelativeTime } from '@/lib/utils'
import { DataTable, ColumnDef, createSortableHeader } from '@/components/ui/data-table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import toast from 'react-hot-toast'

interface User {
  id: string
  email: string
  full_name: string | null
  is_super_admin: boolean
  email_verified: boolean
  last_seen_at: string | null
  created_at: string
  tenant_count?: number
}

interface Props {
  initialUsers: any[]
}

export default function UsersDataTable({ initialUsers }: Props) {
  const [users, setUsers] = useState(initialUsers)
  const [total, setTotal] = useState(initialUsers.length)
  const [loading, setLoading] = useState(false)
  const [globalFilter, setGlobalFilter] = useState('')
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ email: '', full_name: '', password: '', is_super_admin: false })
  const [saving, setSaving] = useState(false)

  const loadData = useCallback(async (page = 0) => {
    setLoading(true)
    const params = new URLSearchParams({
      limit: String(pagination.pageSize),
      offset: String(page * pagination.pageSize),
    })
    if (globalFilter) params.set('q', globalFilter)
    try {
      const res = await fetch('/api/superadmin/users?' + params)
      const data = await res.json()
      setUsers(data.data ?? [])
      setTotal(data.total ?? 0)
    } catch (error) {
      console.error('Failed to load users:', error)
    }
    setLoading(false)
  }, [pagination.pageSize, globalFilter])

  const handlePaginationChange = useCallback((page: number) => {
    setPagination(prev => ({ ...prev, pageIndex: page }))
    loadData(page)
  }, [loadData])

  const handlePageSizeChange = useCallback((size: number) => {
    setPagination(prev => ({ ...prev, pageSize: size, pageIndex: 0 }))
  }, [])

  const handleGlobalFilterChange = useCallback((filter: string) => {
    setGlobalFilter(filter)
    loadData(0)
  }, [loadData])

  const toggleSuperAdmin = async (id: string, current: boolean) => {
    if (!confirm(current ? 'You cannot remove super admin status. It can only be transferred to another user.' : 'Grant super admin? This gives full platform access.')) return
    const res = await fetch('/api/superadmin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: id, is_super_admin: !current }),
    })
    if (res.ok) {
      toast.success(current ? 'Removed' : 'Granted')
      loadData(pagination.pageIndex)
    } else {
      const data = await res.json()
      toast.error(data.error || 'Failed')
    }
  }

  const revokeAllSessions = async (id: string, name: string) => {
    if (!confirm(`Revoke all sessions for ${name}? They will be logged out everywhere.`)) return
    const res = await fetch('/api/superadmin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: id, revoke_sessions: true }),
    })
    if (res.ok) toast.success('All sessions revoked')
    else toast.error('Failed')
  }

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    const res = await fetch('/api/superadmin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const data = await res.json()
    if (res.ok) {
      toast.success('User created')
      setShowCreate(false)
      setForm({ email: '', full_name: '', password: '', is_super_admin: false })
      loadData(pagination.pageIndex)
    } else {
      toast.error(data.error)
    }
    setSaving(false)
  }

  const columns: ColumnDef<User>[] = useMemo(() => [
    {
      id: 'select',
      header: ({ table }) => (
        <Checkbox
          checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && 'indeterminate')}
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Select all"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label="Select row"
        />
      ),
      enableSorting: false,
      enableHiding: false,
    },
    {
      accessorKey: 'email',
      header: ({ column }) => createSortableHeader('Email', 'email').header({ column }),
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.original.email}</div>
          {row.original.full_name && (
            <div className="text-xs text-muted-foreground">{row.original.full_name}</div>
          )}
        </div>
      ),
    },
    {
      accessorKey: 'is_super_admin',
      header: 'Role',
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          {row.original.is_super_admin ? (
            <Badge className="text-xs bg-amber-500/15 text-amber-400 border-amber-500/20">
              <Crown className="w-3 h-3 mr-1" />
              Super Admin
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs">
              <ShieldOff className="w-3 h-3 mr-1" />
              User
            </Badge>
          )}
        </div>
      ),
    },
    {
      accessorKey: 'email_verified',
      header: 'Verified',
      cell: ({ row }) => (
        <div className="flex items-center gap-1.5">
          {row.original.email_verified ? (
            <CheckCircle className="w-4 h-4 text-emerald-500" />
          ) : (
            <XCircle className="w-4 h-4 text-red-500" />
          )}
          <span className="text-xs text-muted-foreground">
            {row.original.email_verified ? 'Verified' : 'Unverified'}
          </span>
        </div>
      ),
    },
    {
      accessorKey: 'created_at',
      header: ({ column }) => createSortableHeader('Created', 'created_at').header({ column }),
      cell: ({ row }) => (
        <div className="text-xs text-muted-foreground">{formatRelativeTime(row.original.created_at)}</div>
      ),
    },
    {
      id: 'actions',
      cell: ({ row }) => {
        const user = row.original
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => toggleSuperAdmin(user.id, user.is_super_admin)}>
                <Crown className="mr-2 h-4 w-4" />
                {user.is_super_admin ? 'Remove Super Admin' : 'Grant Super Admin'}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => revokeAllSessions(user.id, user.full_name || user.email)}>
                <ShieldOff className="mr-2 h-4 w-4" />
                Revoke All Sessions
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-red-600 dark:text-red-400">
                <XCircle className="mr-2 h-4 w-4" />
                Suspend User
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
    },
  ], [pagination.pageIndex, loadData])

  const inp = "w-full px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-violet-500"

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white flex items-center gap-2">
            <Mail className="w-5 h-5 text-violet-400" />
            All Users
          </h1>
          <p className="text-xs text-white/40">{users.length} users across all organizations</p>
        </div>
        <Button onClick={() => setShowCreate(!showCreate)}>
          <Plus className="w-4 h-4 mr-2" />
          Create User
        </Button>
      </div>

      {/* Create User Form */}
      {showCreate && (
        <form onSubmit={createUser} className="rounded-xl border border-white/10 bg-white/[0.03] p-5 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-white">Create User</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-white/50 mb-1">Email *</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))}
                required
                className={inp}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-white/50 mb-1">Full Name</label>
              <input
                value={form.full_name}
                onChange={(e) => setForm(f => ({ ...f, full_name: e.target.value }))}
                className={inp}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-white/50 mb-1">Password *</label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm(f => ({ ...f, password: e.target.value }))}
                required
                minLength={12}
                className={inp}
              />
            </div>
            <div className="flex items-center gap-2 mt-5">
              <input
                type="checkbox"
                checked={form.is_super_admin}
                onChange={(e) => setForm(f => ({ ...f, is_super_admin: e.target.checked }))}
                className="accent-violet-500 w-4 h-4"
              />
              <label className="text-xs text-white/60">Super Admin</label>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />}
              Create User
            </Button>
          </div>
        </form>
      )}

      {/* DataTable */}
      <DataTable
        columns={columns}
        data={users}
        total={total}
        loading={loading}
        pageSize={pagination.pageSize}
        onPageSizeChange={handlePageSizeChange}
        globalFilter={globalFilter}
        onGlobalFilterChange={handleGlobalFilterChange}
        enableRowSelection
        searchPlaceholder="Search by email or name..."
        manualPagination
        pageIndex={pagination.pageIndex}
        onPaginationChange={handlePaginationChange}
        emptyState={{
          icon: <Mail className="w-6 h-6 text-white/30" />,
          title: "No users found",
          description: "Try adjusting your search filters",
        }}
      />
    </div>
  )
}
