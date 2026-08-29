import { LogoSpinner } from "@quiro/ui";

export function FullPageLoader() {
  return (
    <div className="w-full h-full flex items-center justify-center">
      <div className="animate-spin">
        <LogoSpinner className="size-16" />
      </div>
    </div>
  );
}
