'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, Sun, Moon, Search, LogOut, X, Users, TrendingUp,
  Building2, Menu, ChevronDown, User, Settings, Crown, KeyRound, RefreshCw } from 'lucide-react';
import { useTheme } from 'next-themes';
import Link from 'next/link';
import { cn, formatCurrency, getInitials } from '@/lib/utils';

export default function TenantHeader({ tenant, profile, roleSlug, onToggleSidebar }: {
  tenant: any; profile: any; roleSlug: string; onToggleSidebar?: () => void;
}) {
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unread, setUnread]       = useState(0);
  const [query, setQuery]         = useState('');
  const [results, setResults]     = useState<any>(null);
  const [searching, setSearching] = useState(false);
  const [showDrop, setShowDrop]   = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const { theme, setTheme }       = useTheme();
  const router                    = useRouter();
  const inputRef                  = useRef<HTMLInputElement>(null);
  const timerRef                  = useRef<NodeJS.Timeout>(undefined);
  const searchRef                 = useRef<HTMLDivElement>(null);
  const profileRef                = useRef<HTMLDivElement>(null);
  const notifRef                  = useRef<HTMLDivElement>(null);

  const color = tenant?.primary_color || '#7c3aed';

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (!searchRef.current?.contains(e.target as Node))  setShowDrop(false);
      if (!profileRef.current?.contains(e.target as Node)) setShowProfile(false);
      if (!notifRef.current?.contains(e.target as Node))   setShowNotifPanel(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const loadNotifications = useCallback(async () => {
    try {
      const [unreadRes, notifRes] = await Promise.all([
        fetch('/api/tenant/notifications/unread'),
        fetch('/api/tenant/notifications'),
      ]);
      const [unreadData, notifData] = await Promise.all([
        unreadRes.json(),
        notifRes.json(),
      ]);
      setUnread(unreadData.count ?? 0);
      setNotifications((notifData.data ?? []).slice(0, 8));
    } catch (error) {
      console.error('[header] Failed to load notifications:', error);
    }
  }, []);

  useEffect(() => {
    loadNotifications();
    const iv = setInterval(loadNotifications, 60_000);
    return () => clearInterval(iv);
  }, [loadNotifications]);

  useEffect(() => {
    try {
      const bc = new BroadcastChannel('nucrm_auth');
      bc.addEventListener('message', e => { if (e.data==='logout') { router.push('/auth/login'); router.refresh(); } });
      return () => bc.close();
    } catch (error) {
      console.error('[header] BroadcastChannel error:', error);
    }
  }, [router]);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setResults(null); setSearching(false); return; }
    setSearching(true);
    const res = await fetch(`/api/tenant/search?q=${encodeURIComponent(q)}&limit=5`);
    const data = await res.json();
    setResults(data); setSearching(false); setShowDrop(true);
  }, []);

  const markNotifRead = async (id: string) => {
    await fetch('/api/tenant/notifications', {
      method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ id }),
    });
    setNotifications(prev => prev.map(n => n.id===id ? {...n, is_read:true} : n));
    setUnread(prev => Math.max(0, prev - 1));
  };

  const handleChange = (val: string) => {
    setQuery(val);
    clearTimeout(timerRef.current);
    if (!val.trim()) { setResults(null); setShowDrop(false); return; }
    timerRef.current = setTimeout(() => doSearch(val), 250);
  };

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    try { new BroadcastChannel('nucrm_auth').postMessage('logout'); } catch {}
    router.push('/auth/login');
    router.refresh();
  };

  const total = results ? (results.contacts?.length??0)+(results.deals?.length??0)+(results.companies?.length??0) : 0;
  const initials = getInitials(profile?.full_name || profile?.email || 'U');

  return (
    <header className="h-14 border-b border-border bg-card flex items-center gap-3 px-4 shrink-0">
      {/* Hamburger to toggle sidebar */}
      <button onClick={onToggleSidebar}
        className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-accent text-muted-foreground transition-colors shrink-0">
        <Menu className="w-4 h-4" />
      </button>

      {/* Search bar */}
      <div className="relative flex-1 max-w-md" ref={searchRef}>
        <div className="relative">
          {searching
            ? <div className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin"/>
            : <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground"/>}
          <input
            ref={inputRef}
            value={query}
            onChange={e => handleChange(e.target.value)}
            onFocus={() => { if (results) setShowDrop(true); }}
            onKeyDown={e => {
              if (e.key==='Enter' && query.trim()) { router.push(`/tenant/search?q=${encodeURIComponent(query)}`); setShowDrop(false); }
              if (e.key==='Escape') { setShowDrop(false); setQuery(''); setResults(null); }
            }}
            placeholder="Search contacts, deals, companies..."
            data-testid="search-input"
            className="w-full pl-8 pr-8 py-1.5 text-sm bg-muted/40 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 focus:bg-background transition-colors"
          />
          {query && <button onClick={()=>{setQuery('');setResults(null);setShowDrop(false);}} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5"/></button>}
        </div>

        {/* Search dropdown */}
        {showDrop && query && (
          <div className="absolute top-full mt-1.5 left-0 right-0 bg-card border border-border rounded-xl shadow-xl z-50 overflow-hidden max-h-96 overflow-y-auto">
            {total === 0 && !searching ? (
              <div className="px-4 py-5 text-center text-sm text-muted-foreground">No results for "{query}"</div>
            ) : (
              <>
                {results?.contacts?.length>0 && <>
                  <div className="px-4 py-1.5 bg-muted/30 border-b border-border text-[10px] font-bold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5"><Users className="w-3 h-3"/>Contacts</div>
                  {results.contacts.map((c:any)=>(
                    <Link key={c.id} href={`/tenant/contacts/${c.id}`} onClick={()=>{setShowDrop(false);setQuery('');setResults(null);}}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent transition-colors">
                      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center text-white text-xs font-bold shrink-0">{c.first_name?.charAt(0)?.toUpperCase()}</div>
                      <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{c.first_name} {c.last_name}</p>{c.email&&<p className="text-xs text-muted-foreground truncate">{c.email}</p>}</div>
                    </Link>
                  ))}
                </>}
                {results?.deals?.length>0 && <>
                  <div className="px-4 py-1.5 bg-muted/30 border-b border-border text-[10px] font-bold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5"><TrendingUp className="w-3 h-3"/>Deals</div>
                  {results.deals.map((d:any)=>(
                    <Link key={d.id} href="/tenant/deals" onClick={()=>{setShowDrop(false);setQuery('');setResults(null);}}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent transition-colors">
                      <TrendingUp className="w-4 h-4 text-amber-500 shrink-0"/>
                      <p className="text-sm flex-1 truncate">{d.title}</p>
                      <span className="text-sm font-bold text-violet-600 shrink-0">{formatCurrency(Number(d.value))}</span>
                    </Link>
                  ))}
                </>}
                {results?.companies?.length>0 && <>
                  <div className="px-4 py-1.5 bg-muted/30 border-b border-border text-[10px] font-bold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5"><Building2 className="w-3 h-3"/>Companies</div>
                  {results.companies.map((c:any)=>(
                    <Link key={c.id} href={`/tenant/companies/${c.id}`} onClick={()=>{setShowDrop(false);setQuery('');setResults(null);}}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent transition-colors">
                      <Building2 className="w-4 h-4 text-blue-500 shrink-0"/>
                      <p className="text-sm flex-1 truncate">{c.name}</p>
                    </Link>
                  ))}
                </>}
                {total>0 && <button onClick={()=>{router.push(`/tenant/search?q=${encodeURIComponent(query)}`);setShowDrop(false);}} className="w-full px-4 py-2.5 text-xs text-violet-600 hover:bg-accent border-t border-border text-left font-medium">See all {total} results →</button>}
              </>
            )}
          </div>
        )}
      </div>

      {/* Right side */}
      <div className="flex items-center gap-1 ml-auto shrink-0">
        {/* Refresh button */}
        <button onClick={()=>router.refresh()} title="Refresh page"
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-accent transition-colors text-muted-foreground">
          <RefreshCw className="w-4 h-4"/>
        </button>

        {/* Dark mode toggle */}
        <button onClick={()=>setTheme(theme==='dark'?'light':'dark')}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-accent transition-colors text-muted-foreground">
          {theme==='dark'?<Sun className="w-4 h-4"/>:<Moon className="w-4 h-4"/>}
        </button>

        {/* Notifications bell */}
        <Link href="/tenant/notifications" className="relative w-8 h-8 flex items-center justify-center rounded-lg hover:bg-accent transition-colors text-muted-foreground">
          <Bell className="w-4 h-4"/>
          {unread>0 && <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 bg-violet-600 text-white text-[9px] font-bold rounded-full flex items-center justify-center">{unread>99?'99+':unread}</span>}
        </Link>

        {/* Profile dropdown */}
        <div className="relative" ref={profileRef}>
          <button onClick={()=>setShowProfile(s=>!s)}
            className="flex items-center gap-2 pl-1.5 pr-2 py-1 rounded-xl hover:bg-accent transition-colors">
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-sm shrink-0" style={{ background: color }}>
              {initials}
            </div>
            <div className="hidden sm:block text-left">
              <p className="text-xs font-semibold leading-tight max-w-[100px] truncate">{profile?.full_name?.split(' ')[0] || 'User'}</p>
              <p className="text-[10px] text-muted-foreground leading-tight capitalize">{roleSlug?.replace(/_/g,' ')}</p>
            </div>
            <ChevronDown className={cn('w-3 h-3 text-muted-foreground transition-transform', showProfile && 'rotate-180')}/>
          </button>

          {showProfile && (
            <div className="absolute right-0 top-full mt-1.5 w-52 bg-card border border-border rounded-xl shadow-xl z-50 overflow-hidden">
              {/* User info */}
              <div className="px-4 py-3 border-b border-border bg-muted/20">
                <p className="text-sm font-semibold truncate">{profile?.full_name || 'User'}</p>
                <p className="text-xs text-muted-foreground truncate">{profile?.email}</p>
              </div>
              <div className="py-1">
                <Link href="/tenant/settings/profile" onClick={()=>setShowProfile(false)}
                  className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-accent transition-colors">
                  <User className="w-3.5 h-3.5 text-muted-foreground"/>My Profile
                </Link>
                <Link href="/tenant/settings/sessions" onClick={()=>setShowProfile(false)}
                  className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-accent transition-colors">
                  <KeyRound className="w-3.5 h-3.5 text-muted-foreground"/>Active Sessions
                </Link>
                <Link href="/tenant/settings/general" onClick={()=>setShowProfile(false)}
                  className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-accent transition-colors">
                  <Settings className="w-3.5 h-3.5 text-muted-foreground"/>Settings
                </Link>
                {profile?.is_super_admin && (
                  <Link href="/superadmin/dashboard" onClick={()=>setShowProfile(false)}
                    className="flex items-center gap-3 px-4 py-2 text-sm text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/20 transition-colors">
                    <Crown className="w-3.5 h-3.5"/>Super Admin
                  </Link>
                )}
              </div>
              <div className="border-t border-border py-1">
                <button onClick={logout}
                  className="w-full flex items-center gap-3 px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors">
                  <LogOut className="w-3.5 h-3.5"/>Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
