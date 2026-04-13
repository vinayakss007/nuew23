'use client';
import { RefreshCw } from 'lucide-react';
export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <html><body>
      <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'sans-serif', padding:'1rem' }}>
        <div style={{ textAlign:'center', maxWidth:'400px' }}>
          <p style={{ fontSize:'3rem', fontWeight:'bold', color:'#e11d48', margin:'0 0 0.5rem' }}>!</p>
          <h1 style={{ fontSize:'1.25rem', fontWeight:'bold', margin:'0 0 0.5rem' }}>Critical Error</h1>
          <p style={{ color:'#6b7280', fontSize:'0.875rem', margin:'0 0 1.5rem' }}>{error.message}</p>
          <button onClick={reset} style={{ display:'inline-flex', alignItems:'center', gap:'0.5rem', padding:'0.625rem 1.25rem', background:'#7c3aed', color:'white', border:'none', borderRadius:'0.75rem', cursor:'pointer', fontSize:'0.875rem', fontWeight:'600' }}>
            Reload Application
          </button>
        </div>
      </div>
    </body></html>
  );
}
