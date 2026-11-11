
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lunar Landing Site Navigator | NASA Space Apps",
  description:
    "Scientific lunar landing site assessment using NASA data.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="min-h-full bg-black text-white"
      suppressHydrationWarning
    >
      <body className="antialiased m-0 min-h-screen overflow-x-hidden overflow-y-auto p-0 font-sans">
        {children}
      </body>
    </html>
  );
}
