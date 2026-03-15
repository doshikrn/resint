import { AppShell } from "@/components/layout/app-shell";
import { SwRegistrar } from "@/components/pwa/sw-registrar";
import { LanguageProvider } from "@/lib/i18n/language-provider";
import { QueryProvider } from "@/components/providers/query-provider";
import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: {
    default: "RESINT — Ревизия",
    template: "RESINT — %s",
  },
  description: "RESINT — restaurant system",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "RESINT",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0d9488",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <head>
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {/* Inline chunk-error recovery: runs before any JS bundle, auto-reloads once on ChunkLoadError */}
        <script
          dangerouslySetInnerHTML={{
            __html: [
              '(function(){',
              'var K="__RESINT_CLE";',
              'try{sessionStorage.removeItem(K)}catch(e){}',
              'function h(m){',
              'if(m&&(m.indexOf("ChunkLoadError")!==-1||m.indexOf("Loading chunk")!==-1)){',
              'try{var v=sessionStorage.getItem(K);',
              'if(!v||Date.now()-Number(v)>10000){',
              'sessionStorage.setItem(K,String(Date.now()));',
              'window.location.reload()}}catch(e){}}}',
              'window.addEventListener("error",function(e){',
              'h(e.error?(e.error.name||"")+" "+(e.error.message||"")',
              ':e.message||"")});',
              'window.addEventListener("unhandledrejection",function(e){',
              'if(e.reason)h((e.reason.name||"")+" "+(e.reason.message||""))});',
              '})();',
            ].join(''),
          }}
        />
        <SwRegistrar />
        <LanguageProvider>
          <QueryProvider>
            <AppShell>{children}</AppShell>
          </QueryProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
