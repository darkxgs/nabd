import type { Metadata, Viewport } from "next";
// Self-hosted fonts (no build-time call to Google Fonts). IBM Plex comes from
// engineering: a Latin face, a condensed cut for readouts, and a matching Arabic.
import "@fontsource-variable/ibm-plex-sans/index.css";
import "@fontsource/ibm-plex-sans-condensed/600.css";
import "@fontsource/ibm-plex-sans-arabic/arabic-400.css";
import "@fontsource/ibm-plex-sans-arabic/arabic-500.css";
import "@fontsource/ibm-plex-sans-arabic/arabic-600.css";
import "./globals.css";
import { appUrl } from "@/lib/app-url";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl()),
  title: { default: "Nabd | Uptime monitoring and status pages", template: "%s | Nabd" },
  description:
    "Nabd checks your websites and APIs every few minutes, opens incidents when they fail, alerts your team, and keeps a public status page in English and Arabic.",
};

export const viewport: Viewport = {
  themeColor: "#14181e",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
