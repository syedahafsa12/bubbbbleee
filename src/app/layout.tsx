
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lunar Landing Site Navigator | NASA Space Apps",
  description:
    "Explore lunar landing locations using NASA terrain data and JPL astronomical observations.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="min-h-full bg-[#080a10] text-white"
      suppressHydrationWarning
    >
      <body className="m-0 min-h-screen overflow-x-hidden p-0 font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
