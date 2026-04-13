import type { Metadata, Viewport } from 'next';
import { ThemeProvider } from '@/components/shared/theme-provider';
import { Toaster } from 'react-hot-toast';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'NuCRM', template: '%s | NuCRM' },
  description: 'The modern CRM platform for growing teams',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <ThemeProvider>
          {children}
          <Toaster position="bottom-right" toastOptions={{
            style: { background: 'hsl(var(--card))', color: 'hsl(var(--foreground))', border: '1px solid hsl(var(--border))', borderRadius: '10px', fontSize: '13px' },
          }} />
        </ThemeProvider>
      </body>
    </html>
  );
}
