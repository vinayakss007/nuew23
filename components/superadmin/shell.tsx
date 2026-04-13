'use client';
import { useState } from 'react';
import SuperAdminSidebar from './sidebar';
import SuperAdminHeader from './header';

export default function SuperAdminShell({ user, stats, children }: { user: any; stats: any; children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const toggle = () => setCollapsed(o => !o);

  return (
    <div className="dark flex h-screen overflow-hidden bg-gray-950">
      <SuperAdminSidebar profile={user} collapsed={collapsed} onToggle={toggle} />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <SuperAdminHeader profile={user} stats={stats} onToggleSidebar={toggle} />
        <main className="flex-1 overflow-y-auto scrollbar-thin p-4 sm:p-6 bg-gray-950">
          {children}
        </main>
      </div>
    </div>
  );
}
