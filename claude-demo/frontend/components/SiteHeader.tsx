import Image from "next/image";
import Link from "next/link";

// Top navigation bar used on the Stellar View page.
export default function SiteHeader() {
  return (
    <header className="flex items-center justify-between border-b border-white/10 px-4 py-3 sm:px-8">
      <Link href="/" className="flex items-center gap-3">
        {/* alt="" because the text next to it already names the site */}
        <Image
          src="/brand/logo-compact.png"
          alt=""
          width={1254}
          height={1254}
          className="h-10 w-10"
        />
        <span className="text-sm font-semibold uppercase tracking-[0.2em]">
          SPHEREx Xplorer
        </span>
      </Link>

      <nav>
        <Link
          href="/"
          className="rounded-md px-3 py-1.5 text-sm text-white/70 transition hover:bg-white/10 hover:text-white"
        >
          New search
        </Link>
      </nav>
    </header>
  );
}
