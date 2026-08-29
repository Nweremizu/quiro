import { cn } from "@quiro/ui";
import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import IconLucideSettings from "~icons/lucide/settings";

// React port of Cap's (window-chrome)/settings.tsx sidebar shell, trimmed to
// what Quiro actually has: no cloud account/sign-in (no cloud backend), no
// update-check button (no updatesCheck command wired up), just the nav +
// content outlet. WindowLayout already supplies the titlebar/drag-region
// for this route (see its isSettings branch), so this only needs its own
// drag-region spacer for macOS, where WindowLayout's header renders nothing
// for /settings.
const NAV_ITEMS = [
	{ href: "general", name: "General", icon: IconLucideSettings },
];

export default function Settings() {
	const [version, setVersion] = useState<string | null>(null);

	useEffect(() => {
		getVersion()
			.then(setVersion)
			.catch((error) => console.error("Failed to load app version:", error));
	}, []);

	return (
		<div className="flex flex-1 flex-row divide-x divide-gray-3 overflow-y-hidden text-[0.875rem] leading-5">
			<div className="flex h-full flex-col bg-gray-2" data-tauri-drag-region>
				<div className="h-2" data-tauri-drag-region />
				<ul className="h-full min-w-48 space-y-1 p-2.5 text-gray-12">
					{NAV_ITEMS.map((item) => (
						<li key={item.href}>
							<NavLink
								to={item.href}
								className={({ isActive }) =>
									cn(
										"flex h-8 flex-row items-center gap-1.5 rounded-lg px-2 text-[13px] transition-colors hover:bg-gray-3",
										isActive && "bg-gray-5 pointer-events-none",
									)
								}
							>
								<item.icon className="size-4 opacity-60" aria-hidden="true" />
								<span>{item.name}</span>
							</NavLink>
						</li>
					))}
				</ul>
				{version && <p className="p-2.5 text-xs text-gray-10">v{version}</p>}
			</div>
			<div className="min-w-0 flex-1 overflow-y-hidden">
				<Outlet />
			</div>
		</div>
	);
}
