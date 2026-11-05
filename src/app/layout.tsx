import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppProvider } from "@/components/AppProvider";
import { ChatAssistant } from "@/components/ChatAssistant";
import { Footer } from "@/components/Footer";
import { ThemeToggle } from "@/components/ThemeToggle";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";
import { WorkspaceProvider } from "@/context/WorkspaceContext";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "LedgerPulse — Cash Flow Audit & Forecast",
  description: "AI-driven cash flow audits and 12-month forecasts for small businesses, landlords and households.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: the boot script may set data-theme on <html> before React hydrates.
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col bg-slate-950 text-slate-100">
        <AppProvider>
          <WorkspaceProvider>
            <div className="flex-1">{children}</div>
            <Footer />
            <ChatAssistant />
            <ThemeToggle />
          </WorkspaceProvider>
        </AppProvider>
      </body>
    </html>
  );
}
