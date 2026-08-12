import { ConnectivityStatus } from '@/components/pwa/connectivity-status';
import { ServiceWorkerRegister } from '@/components/pwa/sw-register';
import { ThemeProvider } from '@/components/theme-provider'; // Updated to use local wrapper
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Suspense } from 'react';
import './globals.css';

const defaultUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(defaultUrl),
  title: 'Project HERMES',
  description: 'DRRM communication control center',
};

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <TooltipProvider>
            {/* Suspense is moved inside the providers to avoid hydration script conflicts */}
            <Suspense fallback={null}>{children}</Suspense>
            <ServiceWorkerRegister />
            <ConnectivityStatus />
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
