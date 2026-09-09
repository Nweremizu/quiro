import { cn } from "@quiro/ui";
import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import IconLucideBell from "~icons/lucide/bell";
import IconLucideImage from "~icons/lucide/image";
import IconLucideKeyboard from "~icons/lucide/keyboard";
import IconLucideMessageSquarePlus from "~icons/lucide/message-square-plus";
import IconLucideSettings from "~icons/lucide/settings";
import IconLucideSquarePlay from "~icons/lucide/square-play";
import IconQuiroLogo from "~icons/quiro/logo";

// React port of Cap's (window-chrome)/settings.tsx sidebar shell, trimmed to
// what Quiro actually has: no cloud account/sign-in (no cloud backend). The
// update-check button lives in the General tab, not this shell. WindowLayout
// already supplies the titlebar/drag-region
// for this route (see its isSettings branch), so this only needs its own
// drag-region spacer for macOS, where WindowLayout's header renders nothing
// for /settings.
//
// Automations is deliberately absent: it needs a rule engine (triggers,
// conditions, action dispatch) rather than a page, and a builder that saves
// rules nothing executes would be worse than no page at all.
const NAV_GROUPS = [
	{
		label: "Preferences",
		items: [
			{ href: "general", name: "General", icon: IconLucideSettings },
			{ href: "shortcuts", name: "Shortcuts", icon: IconLucideKeyboard },
		],
	},
	{
		label: "Library",
		items: [
			{ href: "recordings", name: "Recordings", icon: IconLucideSquarePlay },
			{ href: "screenshots", name: "Screenshots", icon: IconLucideImage },
		],
	},
	{
		label: "Support",
		items: [
			{
				href: "feedback",
				name: "Feedback",
				icon: IconLucideMessageSquarePlus,
			},
			{ href: "changelog", name: "Changelog", icon: IconLucideBell },
		],
	},
];

export default function Settings() {
	const [version, setVersion] = useState<string | null>(null);
	const location = useLocation();

	useEffect(() => {
		getVersion()
			.then(setVersion)
			.catch((error) => console.error("Failed to load app version:", error));
	}, []);

	return (
		<div className="flex flex-1 flex-row overflow-y-hidden text-[0.875rem] leading-5">
			<div
				className="flex h-full min-w-52 flex-col border-r border-gray-3 bg-gray-2"
				data-tauri-drag-region
			>
				<div
					className="flex h-13 items-center gap-2 px-3"
					data-tauri-drag-region
				>
					<div className="grid size-7 place-items-center rounded-lg bg-accent-solid text-accent-on-solid shadow-xs">
						<IconQuiroLogo className="size-4" />
					</div>
					<div>
						<p className="text-[13px] font-semibold tracking-tight text-gray-12">
							Settings
						</p>
						<p className="text-[10px] leading-none text-gray-9">Quiro</p>
					</div>
				</div>
				<nav className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3">
					{NAV_GROUPS.map((group, groupIndex) => (
						<div key={group.label} className={cn(groupIndex > 0 && "mt-5")}>
							<p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-8">
								{group.label}
							</p>
							<ul className="space-y-1 text-gray-12">
								{group.items.map((item) => {
									const defaultGeneral =
										item.href === "general" &&
										location.pathname.endsWith("/settings");
									return (
										<li key={item.href}>
											<NavLink
												to={item.href}
												className={({ isActive }) =>
													cn(
														"relative flex min-h-9 flex-row items-center gap-2 rounded-lg px-2.5 text-[13px] transition-[background-color,color] duration-150 hover:bg-gray-3",
														(isActive || defaultGeneral) &&
															"pointer-events-none bg-gray-5 font-medium text-gray-12 before:absolute before:left-0 before:h-4 before:w-0.5 before:rounded-full before:bg-accent-solid",
													)
												}
											>
												<item.icon
													className="size-4 text-gray-10"
													aria-hidden="true"
												/>
												<span>{item.name}</span>
											</NavLink>
										</li>
									);
								})}
							</ul>
						</div>
					))}
				</nav>
				{version ? (
					<p className="border-t border-gray-3 px-4 py-3 text-[10px] text-gray-9">
						Version {version}
					</p>
				) : null}
			</div>
			<div className="min-w-0 flex-1 overflow-y-hidden">
				<Outlet />
			</div>
		</div>
	);
}
