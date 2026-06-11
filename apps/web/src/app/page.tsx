import { getLatestRelease } from "@/lib/releases";
import { DownloadButton } from "@/components/DownloadButton";

export default async function HomePage() {
  const release = await getLatestRelease();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <div className="max-w-3xl space-y-8">
        <div className="space-y-4">
          <h1 className="text-5xl font-bold tracking-tight text-white sm:text-7xl">
            Quiro
          </h1>
          <p className="text-xl text-gray-400 sm:text-2xl">
            AI-powered screen recording.
            <br />
            Record, transcribe, and share — instantly.
          </p>
        </div>

        <DownloadButton release={release} />

        <p className="text-sm text-gray-600">
          Available for Windows and macOS.
          {release && (
            <>
              {" "}
              Latest:{" "}
              <a
                href={release.releasesPageUrl}
                className="text-gray-400 hover:text-white transition underline underline-offset-2"
              >
                v{release.version}
              </a>
            </>
          )}
        </p>
      </div>
    </main>
  );
}
