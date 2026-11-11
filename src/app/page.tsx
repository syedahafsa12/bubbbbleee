
export default function Home() {
  return (
    <main className="min-h-screen bg-black text-white flex items-center justify-center p-8">
      <div className="max-w-xl text-center">
        <p className="text-sm uppercase tracking-[0.3em] text-gray-500 mb-4">
          NASA Space Apps Challenge
        </p>

        <h1 className="text-3xl font-semibold mb-4">
          Lunar Landing Site Navigator
        </h1>

        <p className="text-gray-400 mb-8">
          Scientific lunar observation data powered by NASA/JPL Horizons.
        </p>

        <a
          href="/api/horizons"
          target="_blank"
          rel="noreferrer"
          className="inline-block rounded-lg border border-gray-700 px-6 py-3 hover:bg-white hover:text-black transition"
        >
          Retrieve JPL Data
        </a>
      </div>
    </main>
  );
}
