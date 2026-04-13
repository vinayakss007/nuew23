'use client';
import { useState, useEffect } from 'react';
import { Zap, Package, Users, ToggleLeft, ToggleRight } from 'lucide-react';
import { cn, formatCurrency } from '@/lib/utils';
import toast from 'react-hot-toast';

const CAT_COLORS: Record<string,string> = {
  utility:     'bg-slate-500/15 text-slate-400',
  automation:  'bg-violet-500/15 text-violet-400',
  messaging:   'bg-emerald-500/15 text-emerald-400',
  integration: 'bg-blue-500/15 text-blue-400',
  ai:          'bg-amber-500/15 text-amber-400',
  analytics:   'bg-orange-500/15 text-orange-400',
};

export default function SuperAdminModulesPage() {
  const [modules, setModules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/superadmin/modules').then(r=>r.json()).then(d=>{
      setModules(d.data ?? []); setLoading(false);
    });
  }, []);

  const toggleAvailability = async (id: string, current: boolean) => {
    // Optimistic
    setModules(prev => prev.map(m => m.id===id ? {...m, is_available:!current} : m));
    const res = await fetch('/api/superadmin/modules', {
      method:'PATCH', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ id, is_available: !current }),
    });
    if (!res.ok) {
      setModules(prev => prev.map(m => m.id===id ? {...m, is_available:current} : m));
      toast.error('Failed to update');
    } else toast.success(!current ? 'Module enabled' : 'Module disabled');
  };

  const totalInstalls = modules.reduce((s,m) => s + (m.total_installs||0), 0);
  const activeModules = modules.filter(m => m.is_available).length;

  return (
    <div className="space-y-5 max-w-6xl">
      <div>
        <h1 className="text-lg font-bold text-white flex items-center gap-2">
          <Package className="w-5 h-5 text-violet-400"/>Module Marketplace
        </h1>
        <p className="text-xs text-white/40 mt-0.5">
          {activeModules} active · {modules.length} total · {totalInstalls} tenant installs
        </p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label:'Total Modules',   value:modules.length,              color:'text-white' },
          { label:'Active Platform', value:activeModules,               color:'text-emerald-400' },
          { label:'Total Installs',  value:totalInstalls.toLocaleString(), color:'text-violet-400' },
        ].map(s=>(
          <div key={s.label} className="rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs text-white/40">{s.label}</p>
            <p className={cn('text-2xl font-bold mt-1',s.color)}>{s.value}</p>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(9)].map((_,i)=><div key={i} className="h-48 rounded-xl animate-pulse bg-white/5"/>)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {modules.map(m=>(
            <div key={m.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-5 flex flex-col gap-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="text-xl">{m.icon||'🔌'}</span>
                  <div>
                    <p className="text-sm font-semibold text-white">{m.name}</p>
                    <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-full capitalize', CAT_COLORS[m.category]||CAT_COLORS['utility'])}>
                      {m.category}
                    </span>
                  </div>
                </div>
                <button onClick={()=>toggleAvailability(m.id, m.is_available)}
                  className={cn('flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg border transition-colors',
                    m.is_available
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                      : 'border-white/10 bg-white/5 text-white/30 hover:text-white')}>
                  {m.is_available
                    ? <><ToggleRight className="w-3 h-3"/>ON</>
                    : <><ToggleLeft className="w-3 h-3"/>OFF</>}
                </button>
              </div>
              <p className="text-xs text-white/40 leading-relaxed flex-1">{m.description}</p>
              <div className="flex items-center justify-between pt-2 border-t border-white/5">
                <div className="flex items-center gap-1 text-xs text-white/40">
                  <Users className="w-3 h-3"/>
                  <span>{m.total_installs||0} installs</span>
                </div>
                <span className="text-xs font-semibold text-white/60">
                  {m.is_free || m.price_monthly===0 ? 'Free' : `$${m.price_monthly}/mo`}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
