import Finder from "@/components/Finder";

export const dynamic = "force-static";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-[520px] px-4 pb-16 pt-7">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-[.14em] text-muted">Free parking · Zurich &amp; Geneva</p>
      <h1 className="mb-4 text-[28px] font-bold leading-[1.1] tracking-[-.01em]">Where can I park for free?</h1>
      <Finder />
      <footer className="mt-10 text-[12px] text-muted">
        <a href="https://onedaybuilt.com" className="font-semibold text-blue hover:underline">onedaybuilt.com</a> — one website a day, all September.
      </footer>
    </main>
  );
}
