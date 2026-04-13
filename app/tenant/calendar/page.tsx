'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ChevronLeft, ChevronRight, Plus, Calendar, Clock, MapPin, CheckSquare,
  Users, TrendingUp, FileText, MoreHorizontal, Edit, Trash2, ExternalLink
} from 'lucide-react';
import { cn, formatDate, formatCurrency } from '@/lib/utils';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isToday, addMonths, subMonths, getDay } from 'date-fns';
import toast from 'react-hot-toast';

interface CalEvent {
  id: string;
  type: 'meeting' | 'task';
  title: string;
  time?: string;
  date: string;
  color: string;
  icon: any;
  href?: string;
  contact?: string;
  entity?: any;
}

export default function CalendarPage() {
  const router = useRouter();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [selectedDay, setSelectedDay] = useState(new Date());
  const [showMeetingForm, setShowMeetingForm] = useState(false);
  const [contacts, setContacts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadEvents = (month: Date) => {
    setLoading(true);
    const start = startOfMonth(month).toISOString().split('T')[0];
    const end = endOfMonth(month).toISOString().split('T')[0];
    Promise.all([
      fetch(`/api/tenant/meetings?start=${start}&end=${end}`).then(r => r.json()).catch(() => ({ data: [] })),
      fetch(`/api/tenant/tasks?limit=200`).then(r => r.json()).catch(() => ({ data: [] })),
      fetch('/api/tenant/contacts?limit=200').then(r => r.json()).catch(() => ({ data: [] })),
    ]).then(([meetings, tasks, cs]) => {
      const evs: CalEvent[] = [
        ...(meetings.data || []).map((m: any) => ({
          id: m.id, type: 'meeting' as const, title: m.title,
          time: m.start_time?.split('T')[1]?.slice(0, 5),
          date: m.start_time?.split('T')[0],
          color: 'bg-violet-500', icon: Calendar,
          contact: m.contact_name, entity: m,
        })),
        ...(tasks.data || []).filter((t: any) => t.due_date && !t.completed).map((t: any) => ({
          id: t.id, type: 'task' as const, title: t.title,
          date: t.due_date,
          color: t.priority === 'high' ? 'bg-red-500' : t.priority === 'medium' ? 'bg-amber-500' : 'bg-slate-400',
          icon: CheckSquare, href: `/tenant/tasks/${t.id}`, entity: t,
          contact: t.contact_name,
        })),
      ];
      setEvents(evs);
      setContacts(cs.data || []);
      setLoading(false);
    });
  };

  useEffect(() => { loadEvents(currentMonth); }, [currentMonth]);

  const days = eachDayOfInterval({ start: startOfMonth(currentMonth), end: endOfMonth(currentMonth) });
  const startPad = getDay(startOfMonth(currentMonth));
  const selectedEvents = events.filter(e => isSameDay(new Date(e.date), selectedDay));

  // Upcoming events (next 7 days)
  const today = new Date().toISOString().split('T')[0] || '';
  const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0] || '';
  const upcoming = events.filter(e => e.date && e.date >= today && e.date <= nextWeek).slice(0, 10);

  // Stats
  const totalTasks = events.filter(e => e.type === 'task').length;
  const totalMeetings = events.filter(e => e.type === 'meeting').length;
  const overdue = events.filter(e => e.type === 'task' && e.date < today).length;

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2"><Calendar className="w-5 h-5" />Calendar</h1>
          <p className="text-sm text-muted-foreground">Meetings, tasks, and deadlines</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setShowMeetingForm(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium transition-colors shrink-0">
            <Plus className="w-3.5 h-3.5" />Meeting
          </button>
          <Link href="/tenant/tasks"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border hover:bg-accent text-xs font-medium transition-colors shrink-0">
            <CheckSquare className="w-3.5 h-3.5" />Tasks
          </Link>
        </div>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Tasks Due', value: totalTasks, icon: CheckSquare, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-950/20' },
          { label: 'Meetings', value: totalMeetings, icon: Calendar, color: 'text-violet-600', bg: 'bg-violet-50 dark:bg-violet-950/20' },
          { label: 'Overdue', value: overdue, icon: TrendingUp, color: overdue > 0 ? 'text-red-600' : 'text-emerald-600', bg: overdue > 0 ? 'bg-red-50 dark:bg-red-950/20' : 'bg-emerald-50 dark:bg-emerald-950/20' },
          { label: 'Upcoming', value: upcoming.length, icon: Users, color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-950/20' },
        ].map(s => (
          <div key={s.label} className="admin-card p-3">
            <div className="flex items-center gap-2">
              <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center', s.bg)}>
                <s.icon className={cn('w-4 h-4', s.color)} />
              </div>
              <div>
                <p className="text-lg font-bold">{s.value}</p>
                <p className="text-[10px] text-muted-foreground">{s.label}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Main layout: Calendar + Sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Calendar */}
        <div className="lg:col-span-3">
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h2 className="font-semibold">{format(currentMonth, 'MMMM yyyy')}</h2>
              <div className="flex gap-1">
                <button onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-accent transition-colors"><ChevronLeft className="w-4 h-4" /></button>
                <button onClick={() => setCurrentMonth(new Date())} className="px-3 h-8 text-xs font-medium rounded-lg hover:bg-accent transition-colors">Today</button>
                <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-accent transition-colors"><ChevronRight className="w-4 h-4" /></button>
              </div>
            </div>
            <div className="grid grid-cols-7 border-b border-border">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => <div key={d} className="p-2 text-center text-xs font-semibold text-muted-foreground">{d}</div>)}</div>
            {loading ? (
              <div className="p-8 text-center text-muted-foreground">Loading...</div>
            ) : (
              <div className="grid grid-cols-7">
                {Array.from({ length: startPad }).map((_, i) => <div key={`p${i}`} className="min-h-[80px] border-b border-r border-border bg-muted/10" />)}
                {days.map(day => {
                  const de = events.filter(e => isSameDay(new Date(e.date), day));
                  const sel = isSameDay(day, selectedDay);
                  return (
                    <div key={day.toISOString()} onClick={() => setSelectedDay(day)}
                      className={cn('min-h-[80px] border-b border-r border-border p-1.5 cursor-pointer transition-colors hover:bg-accent/50', sel && 'bg-violet-50 dark:bg-violet-950/20')}>
                      <div className={cn('w-7 h-7 flex items-center justify-center rounded-full text-sm font-medium mb-1', isToday(day) ? 'bg-violet-600 text-white' : sel ? 'text-violet-600 font-bold' : '')}>{format(day, 'd')}</div>
                      <div className="space-y-0.5">{de.slice(0, 3).map(e => (
                        <div key={e.id} className={cn('text-[9px] font-medium px-1 py-0.5 rounded text-white truncate flex items-center gap-0.5', e.color)}>
                          <e.icon className="w-2 h-2 shrink-0" />
                          {e.time && <span className="opacity-75">{e.time} </span>}{e.title}
                        </div>
                      ))}{de.length > 3 && <div className="text-[9px] text-muted-foreground">+{de.length - 3}</div>}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right sidebar */}
        <div className="space-y-4">
          {/* Selected day events */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="p-3 border-b border-border">
              <h3 className="font-semibold text-sm">{format(selectedDay, 'EEEE, MMM d')}</h3>
              <p className="text-xs text-muted-foreground">{selectedEvents.length} event{selectedEvents.length !== 1 ? 's' : ''}</p>
            </div>
            <div className="p-2 space-y-1.5 max-h-[300px] overflow-y-auto">
              {!selectedEvents.length ? (
                <div className="text-center py-6">
                  <Calendar className="w-6 h-6 text-muted-foreground/30 mx-auto mb-1.5" />
                  <p className="text-xs text-muted-foreground">No events</p>
                </div>
              ) : selectedEvents.map(e => (
                <div key={e.id} className="group">
                  {e.href ? (
                    <Link href={e.href}
                      className="flex items-start gap-2 p-2.5 rounded-lg border border-border hover:bg-accent/50 transition-colors cursor-pointer">
                      <div className={cn('w-2 h-2 rounded-full mt-1.5 shrink-0', e.color)} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <e.icon className="w-3 h-3 text-muted-foreground shrink-0" />
                          <p className="text-xs font-medium truncate">{e.title}</p>
                        </div>
                        {e.time && <p className="text-[10px] text-muted-foreground mt-0.5"><Clock className="w-2.5 h-2.5 inline mr-0.5" />{e.time}</p>}
                        {e.contact && <p className="text-[10px] text-muted-foreground">{e.contact}</p>}
                        <div className="hidden group-hover:flex items-center gap-1 mt-1 text-[10px] text-violet-600 font-medium">
                          <ExternalLink className="w-2.5 h-2.5" />Open {e.type}
                        </div>
                      </div>
                    </Link>
                  ) : (
                    <div className="flex items-start gap-2 p-2.5 rounded-lg border border-border hover:bg-accent/50 transition-colors">
                      <div className={cn('w-2 h-2 rounded-full mt-1.5 shrink-0', e.color)} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <e.icon className="w-3 h-3 text-muted-foreground shrink-0" />
                          <p className="text-xs font-medium truncate">{e.title}</p>
                        </div>
                        {e.time && <p className="text-[10px] text-muted-foreground mt-0.5"><Clock className="w-2.5 h-2.5 inline mr-0.5" />{e.time}</p>}
                        {e.contact && <p className="text-[10px] text-muted-foreground">{e.contact}</p>}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Upcoming events */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="p-3 border-b border-border">
              <h3 className="font-semibold text-sm">Next 7 Days</h3>
            </div>
            <div className="p-2 space-y-1.5 max-h-[250px] overflow-y-auto">
              {!upcoming.length ? (
                <div className="text-center py-6 text-xs text-muted-foreground">Nothing upcoming</div>
              ) : upcoming.map(e => (
                <div key={e.id}>
                  {e.href ? (
                    <Link href={e.href}
                      className="flex items-start gap-2 p-2 rounded-lg hover:bg-accent/50 transition-colors cursor-pointer">
                      <div className={cn('w-1.5 h-1.5 rounded-full mt-1 shrink-0', e.color)} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{e.title}</p>
                        <p className="text-[10px] text-muted-foreground">{format(new Date(e.date), 'MMM d')}{e.time ? ` at ${e.time}` : ''}</p>
                      </div>
                    </Link>
                  ) : (
                    <div className="flex items-start gap-2 p-2 rounded-lg hover:bg-accent/50 transition-colors">
                      <div className={cn('w-1.5 h-1.5 rounded-full mt-1 shrink-0', e.color)} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{e.title}</p>
                        <p className="text-[10px] text-muted-foreground">{format(new Date(e.date), 'MMM d')}{e.time ? ` at ${e.time}` : ''}</p>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Meeting form modal */}
      {showMeetingForm && <MeetingForm contacts={contacts} onSaved={() => { setShowMeetingForm(false); loadEvents(currentMonth); }} onClose={() => setShowMeetingForm(false)} />}
    </div>
  );
}

function MeetingForm({ contacts, onSaved, onClose }: any) {
  const [form, setForm] = useState({ title: '', start_time: '', end_time: '', location: '', meeting_url: '', contact_id: '', description: '' });
  const [saving, setSaving] = useState(false);
  const inp = "w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500";

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      const res = await fetch('/api/tenant/meetings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, contact_id: form.contact_id || null, end_time: form.end_time || new Date(new Date(form.start_time).getTime() + 3600000).toISOString() }),
      });
      if (res.ok) { toast.success('Meeting scheduled'); onSaved(); }
      else toast.error('Failed to create meeting');
    } catch { toast.error('Failed'); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md animate-scale-in">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="font-semibold">Schedule Meeting</h2>
          <button onClick={onClose} className="w-7 h-7 rounded-lg hover:bg-accent flex items-center justify-center text-muted-foreground">✕</button>
        </div>
        <form onSubmit={save} className="p-5 space-y-4">
          <div><label className="block text-xs font-medium text-muted-foreground mb-1">Title *</label><input required value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} className={inp} placeholder="Discovery call, Demo..." /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs font-medium text-muted-foreground mb-1">Start *</label><input required type="datetime-local" value={form.start_time} onChange={e => setForm(p => ({ ...p, start_time: e.target.value }))} className={inp} /></div>
            <div><label className="block text-xs font-medium text-muted-foreground mb-1">End</label><input type="datetime-local" value={form.end_time} onChange={e => setForm(p => ({ ...p, end_time: e.target.value }))} className={inp} /></div>
          </div>
          <div><label className="block text-xs font-medium text-muted-foreground mb-1">Contact</label>
            <select value={form.contact_id} onChange={e => setForm(p => ({ ...p, contact_id: e.target.value }))} className={inp}><option value="">No contact</option>{contacts.map((c: any) => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}</select>
          </div>
          <div className="flex gap-3"><button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-border text-sm font-medium hover:bg-accent">Cancel</button><button type="submit" disabled={saving} className="flex-1 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-50">{saving ? 'Saving...' : 'Schedule'}</button></div>
        </form>
      </div>
    </div>
  );
}
