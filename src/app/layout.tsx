import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "UGC Snap — Sold-out UGC Limited deal radar",
  description:
    "Scans Roblox for sold-out UGC Limiteds whose lowest listing is 70%+ below the 2nd/3rd lowest prices (real market value). $0, free forever.",
  applicationName: "UGC Snap",
  openGraph: {
    title: "UGC Snap — UGC Limited deep-discount radar",
    description:
      "Sold-out UGC Limiteds 70%+ below the live 2nd/3rd resale market. RAP never gates a deal.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#070a10",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-ink-950 text-slate-200 antialiased">
        {children}
      </body>
    </html>
  );
}
