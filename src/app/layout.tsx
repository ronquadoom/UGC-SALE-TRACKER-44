import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "UGC Snap — Sold-out UGC Limited deals",
  description:
    "Find sold-out Roblox UGC Limiteds listed 70%+ below real market value. Verified by live 2nd & 3rd lowest listings — not RAP. Auto-updating.",
  applicationName: "UGC Snap",
  openGraph: {
    title: "UGC Snap — Real UGC Limited deals",
    description:
      "Sold-out UGC Limiteds 70%+ below the live market. Verified by 2nd & 3rd listings. Auto-refreshing.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#f8fafc",
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
      <body className="min-h-screen bg-[#f8fafc] text-slate-900 antialiased">
        {children}
      </body>
    </html>
  );
}
