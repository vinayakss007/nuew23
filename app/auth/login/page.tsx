'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Zap, Eye, EyeOff, Loader2, Mail, Shield } from 'lucide-react';
import toast from 'react-hot-toast';

export default function LoginPage() {
  const [email, setEmail]           = useState('');
  const [password, setPassword]     = useState('');
  const [totpToken, setTotpToken]   = useState('');
  const [showPass, setShowPass]     = useState(false);
  const [loading, setLoading]       = useState(false);
  const [step, setStep]             = useState<'creds'|'2fa'|'verify_email'>('creds');
  const [resending, setResending]   = useState(false);
  const router = useRouter();

  const inp = "w-full px-3.5 py-2.5 rounded-xl border border-border bg-background text-sm font-medium focus:outline-none focus:ring-2 focus:ring-violet-500 placeholder:text-muted-foreground";

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true);
    const body: any = { email, password };
    if (step === '2fa') body.totp_token = totpToken;

    const res = await fetch('/api/auth/login', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(body),
    });
    const data = await res.json();

    if (!res.ok) {
      if (data.needs_verification) { setStep('verify_email'); setLoading(false); return; }
      if (data.requires_2fa)       { setStep('2fa');          setLoading(false); return; }
      toast.error(data.error || 'Login failed');
      setLoading(false); return;
    }
    if (data.requires_2fa) { setStep('2fa'); setLoading(false); return; }
    router.push(data.user?.is_super_admin ? '/superadmin/dashboard' : '/tenant/dashboard');
    router.refresh();
  };

  const resendVerification = async () => {
    setResending(true);
    await fetch('/api/auth/resend-verification', { method:'POST' });
    toast.success('Verification email sent');
    setResending(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-50 via-white to-indigo-50 dark:from-slate-950 dark:via-slate-900 dark:to-violet-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2.5 mb-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/25">
              <Zap className="w-5 h-5 text-white" strokeWidth={2.5} />
            </div>
            <span className="text-2xl font-bold bg-gradient-to-r from-violet-700 to-indigo-600 bg-clip-text text-transparent">NuCRM</span>
          </div>
          <p className="text-sm text-muted-foreground">Sign in to your workspace</p>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-100 dark:border-slate-800 p-8">
          {step === 'verify_email' && (
            <div className="text-center space-y-4">
              <div className="w-14 h-14 bg-amber-100 dark:bg-amber-950/30 rounded-full flex items-center justify-center mx-auto">
                <Mail className="w-7 h-7 text-amber-600" />
              </div>
              <h2 className="text-lg font-bold">Verify your email</h2>
              <p className="text-sm text-muted-foreground">We sent a link to <strong>{email}</strong>. Click it to continue.</p>
              <button onClick={resendVerification} disabled={resending}
                className="w-full py-2.5 rounded-xl border border-border hover:bg-accent text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50">
                {resending && <Loader2 className="w-4 h-4 animate-spin"/>}Resend email
              </button>
              <button onClick={()=>setStep('creds')} className="text-sm text-muted-foreground hover:text-foreground">← Back</button>
            </div>
          )}

          {step === '2fa' && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="text-center mb-4">
                <div className="w-12 h-12 bg-violet-100 dark:bg-violet-950/30 rounded-full flex items-center justify-center mx-auto mb-3">
                  <Shield className="w-6 h-6 text-violet-600"/>
                </div>
                <h2 className="font-bold">Two-factor authentication</h2>
                <p className="text-xs text-muted-foreground mt-1">Enter the 6-digit code from your authenticator app</p>
              </div>
              <input
                value={totpToken} onChange={e=>setTotpToken(e.target.value.replace(/\D/g,'').slice(0,6))}
                placeholder="000000" maxLength={6} autoFocus required
                className={inp + " text-center text-2xl font-mono tracking-[0.5em] letter-spacing-wide"}
              />
              <button type="submit" disabled={loading||totpToken.length<6}
                className="w-full py-2.5 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2">
                {loading && <Loader2 className="w-4 h-4 animate-spin"/>}Verify
              </button>
              <button type="button" onClick={()=>setStep('creds')} className="w-full text-sm text-muted-foreground hover:text-foreground">← Back</button>
            </form>
          )}

          {step === 'creds' && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1.5">Email</label>
                <input type="email" value={email} onChange={e=>setEmail(e.target.value)} required placeholder="you@example.com" className={inp} autoFocus />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm font-medium">Password</label>
                  <Link href="/auth/forgot-password" className="text-xs text-muted-foreground hover:text-violet-600 transition-colors">Forgot password?</Link>
                </div>
                <div className="relative">
                  <input type={showPass?'text':'password'} value={password} onChange={e=>setPassword(e.target.value)} required placeholder="••••••••" className={inp+' pr-10'} />
                  <button type="button" onClick={()=>setShowPass(s=>!s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    {showPass?<EyeOff className="w-4 h-4"/>:<Eye className="w-4 h-4"/>}
                  </button>
                </div>
              </div>
              <button type="submit" disabled={loading}
                className="w-full py-2.5 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-violet-500/25">
                {loading && <Loader2 className="w-4 h-4 animate-spin"/>}
                {loading ? 'Signing in...' : 'Sign in'}
              </button>
              <p className="text-center text-sm text-muted-foreground">
                No account? <Link href="/auth/signup" className="text-violet-600 font-medium hover:underline">Create workspace</Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
