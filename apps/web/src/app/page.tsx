import { getLatestRelease } from "@/lib/releases";
import { ShaderLanding } from "@/components/ShaderLanding";

export default async function HomePage() {
  const release = await getLatestRelease();
  return <ShaderLanding release={release} />;
}
