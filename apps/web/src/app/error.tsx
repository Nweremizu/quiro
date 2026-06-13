"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center text-center px-6">
      <h1 className="text-5xl font-bold text-white mb-4">Something went wrong</h1>
      <button
        onClick={reset}
        className="mt-4 rounded-lg border border-white/20 px-6 py-2 text-white hover:bg-white/10 transition"
      >
        Try again
      </button>
    </main>
  );
}
