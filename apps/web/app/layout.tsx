import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "TenderFit",
  description: "Tender / RFP matching for IT companies.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-white text-ink antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
