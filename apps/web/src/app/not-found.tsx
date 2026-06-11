import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center text-center px-6">
      <h1 className="text-5xl font-bold text-white mb-4">404</h1>
      <p className="text-gray-400 mb-8">Page not found.</p>
      <Link href="/" className="text-white underline underline-offset-4 hover:text-gray-300 transition">
        Go home
      </Link>
    </main>
  );
}
