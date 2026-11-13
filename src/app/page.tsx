
import Link from "next/link";

export default function HomePage() {
  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-[#08090b] text-[#f4f2ed]">
      {/* Background atmosphere */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-[-420px] h-[800px] w-[800px] -translate-x-1/2 rounded-full bg-[#aaa9a1]/[0.07] blur-[120px]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,#08090b_75%)]" />
      </div>

      {/* Header */}
      <header className="relative z-10 flex h-20 items-center justify-between border-b border-white/[0.08] px-6 sm:px-12 lg:px-20">
        <Link href="/" className="flex items-center gap-3">
          <div className="h-7 w-7 rounded-full border border-[#c8c5ba]/60 bg-gradient-to-br from-[#d8d6cd] to-[#454641] shadow-[0_0_24px_rgba(210,208,195,0.15)]" />
          <span className="text-sm font-semibold tracking-[0.2em]">
            LUNAR <span className="font-light text-white/50">NAVIGATOR</span>
          </span>
        </Link>

        <span className="hidden text-[10px] tracking-[0.24em] text-white/35 sm:block">
          NASA SPACE APPS CHALLENGE
        </span>
      </header>

      {/* Hero */}
      <section className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
        <div className="mb-8 flex items-center gap-3">
          <span className="h-px w-8 bg-[#aaa99f]/50" />
          <p className="text-[10px] font-medium tracking-[0.32em] text-[#b8b6ac]/70">
            LUNAR LANDING INTELLIGENCE
          </p>
          <span className="h-px w-8 bg-[#aaa99f]/50" />
        </div>

        <h1 className="max-w-4xl text-5xl font-light leading-[1.08] tracking-[-0.055em] sm:text-7xl lg:text-[88px]">
          Find your location
          <br />
          on the <span className="text-[#aaa99f]">Moon.</span>
        </h1>

        <p className="mt-8 max-w-lg text-sm leading-7 text-white/45 sm:text-base">
          Explore the lunar South Pole and discover potential landing
          locations through an interactive lunar map.
        </p>

        <Link
          href="/map"
          className="group mt-12 inline-flex h-14 items-center gap-5 border border-[#d0cec4]/30 bg-[#d0cec4] px-7 text-xs font-semibold tracking-[0.16em] text-[#101113] transition-all duration-300 hover:border-[#f0eee5] hover:bg-[#f0eee5]"
        >
          EXPLORE THE MOON
          <span className="text-lg transition-transform duration-300 group-hover:translate-x-1">
            →
          </span>
        </Link>

        <div className="mt-20 flex items-center gap-3 text-[10px] tracking-[0.2em] text-white/25">
          <span className="h-1 w-1 rounded-full bg-[#aaa99f]" />
          FOCUSED ON THE LUNAR SOUTH POLE
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 flex flex-col items-center justify-between gap-3 border-t border-white/[0.08] px-6 py-6 text-[9px] tracking-[0.18em] text-white/25 sm:flex-row sm:px-12 lg:px-20">
        <span>LUNAR NAVIGATOR</span>
        <span>EXPLORING THE NEXT FRONTIER</span>
      </footer>
    </main>
  );
}
