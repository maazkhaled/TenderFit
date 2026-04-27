import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Project Beta",
  description: "Tender / RFP matching for IT companies.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-ink antialiased">{children}</body>
    </html>
  );
}
