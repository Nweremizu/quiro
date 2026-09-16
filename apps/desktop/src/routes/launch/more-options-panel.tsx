import IconLucideArrowLeft from "~icons/lucide/arrow-left";
import IconLucideCircleHelp from "~icons/lucide/circle-help";
import IconLucideClock from "~icons/lucide/clock";
import IconLucideHome from "~icons/lucide/home";
import IconLucideLogOut from "~icons/lucide/log-out";
import IconLucideRefreshCw from "~icons/lucide/refresh-cw";
import IconLucideSettings from "~icons/lucide/settings";

const menuItem =
	"flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-gray-12 hover:bg-gray-3 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-gray-1 [&_svg]:size-4 [&_svg]:text-gray-11";

export default function MoreOptionsPanel({
	recording,
	countdown,
	onBack,
	onHome,
	onCountdown,
	onSettings,
	onHelp,
	onCheckForUpdates,
	onQuit,
}: {
	recording: boolean;
	countdown: number;
	onBack: () => void;
	onHome: () => void;
	onCountdown: () => void;
	onSettings: () => void;
	onHelp: () => void;
	onCheckForUpdates: () => void;
	onQuit: () => void;
}) {
	return (
		<div className="flex flex-col w-full h-full min-h-0">
			<div className="flex gap-3 items-center mt-3 min-h-9">
				<button
					type="button"
					onClick={onBack}
					className="flex h-9 gap-1 items-center shrink-0 rounded-md px-2 text-xs text-gray-11 transition-colors hover:text-gray-12 hover:bg-gray-4 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-gray-1"
					aria-label="Back"
				>
					<IconLucideArrowLeft className="size-3 text-gray-11" />
					<span className="font-medium text-gray-12">Back</span>
				</button>
			</div>
			<div className="flex flex-col flex-1 min-h-0 gap-1 pt-4 px-2">
				<button type="button" className={menuItem} onClick={onHome}>
					<IconLucideHome />
					Home
				</button>
				<button type="button" className={menuItem} onClick={onSettings}>
					<IconLucideSettings />
					Settings
				</button>
				<button type="button" className={menuItem} onClick={onHelp}>
					<IconLucideCircleHelp />
					Help
				</button>
				<button type="button" className={menuItem} onClick={onCheckForUpdates}>
					<IconLucideRefreshCw />
					Check for updates
				</button>
				{recording && (
					<button type="button" className={menuItem} onClick={onCountdown}>
						<IconLucideClock />
						Recording delay: {countdown ? `${countdown}s` : "Off"}
					</button>
				)}
				<button
					type="button"
					className={`${menuItem} text-red-11 hover:text-red-11`}
					onClick={onQuit}
				>
					<IconLucideLogOut />
					Quit Quiro
				</button>
			</div>
		</div>
	);
}
