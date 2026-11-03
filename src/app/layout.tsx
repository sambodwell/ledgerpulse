import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppProvider } from "@/components/AppProvider";
import { ChatAssistant } from "@/components/ChatAssistant";
import { Footer } from "@/components/Footer";
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
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-slate-950 text-slate-100">
        <AppProvider>
          <div className="flex-1">{children}</div>
          <Footer />
          <ChatAssistant />
        </AppProvider>
      </body>
    </html>
  );
}
