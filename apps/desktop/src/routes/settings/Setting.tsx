import { cn, Switch } from "@quiro/ui";
import type { ReactNode } from "react";

// React port of Cap's settings/Setting.tsx — the shared building blocks
// every settings tab composes from. No `pro` badge here: Quiro has no
// paid tier, so that prop from Cap's version is dropped entirely.

export function SettingsPageContent({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div className={cn("space-y-7 px-6 py-6 max-w-[42rem]", className)}>
			{children}
		</div>
	);
}

export function Section({
	title,
	description,
	right,
	children,
}: {
	title: string;
	description?: ReactNode;
	right?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section className="space-y-2.5">
			<header className="flex items-end justify-between gap-3 px-1">
				<div className="flex min-w-0 flex-col gap-0.5">
					<h3 className="text-sm font-semibold tracking-tight text-gray-12">
						{title}
					</h3>
					{description && (
						<div className="text-xs leading-relaxed text-gray-10">
							{description}
						</div>
					)}
				</div>
				{right && (
					<div className="flex shrink-0 items-center gap-2">{right}</div>
				)}
			</header>
			{children}
		</section>
	);
}

export function SectionCard({
	children,
	padded,
	className,
}: {
	children: ReactNode;
	padded?: boolean;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"overflow-hidden rounded-xl border border-gray-3 bg-gray-2",
				padded && "px-4 py-4",
				className,
			)}
		>
			{children}
		</div>
	);
}

export function SectionRows({ children }: { children: ReactNode }) {
	return (
		<SectionCard className="divide-y divide-gray-3">{children}</SectionCard>
	);
}

export function SettingItem({
	id,
	label,
	description,
	children,
}: {
	id?: string;
	label: string;
	description?: string;
	children: ReactNode;
}) {
	return (
		<div
			id={id}
			className="flex flex-row items-center justify-between gap-4 px-4 py-3.5"
		>
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<p className="text-[13px] text-gray-12">{label}</p>
				{description && (
					<p className="text-xs leading-snug text-gray-10">{description}</p>
				)}
			</div>
			<div className="flex shrink-0 items-center">{children}</div>
		</div>
	);
}

export function ToggleSettingItem({
	label,
	description,
	value,
	onChange,
	disabled,
}: {
	label: string;
	description?: string;
	value: boolean;
	onChange: (v: boolean) => void;
	disabled?: boolean;
}) {
	return (
		<SettingItem label={label} description={description}>
			<Switch
				checked={value}
				disabled={disabled}
				onCheckedChange={(checked) => onChange(!!checked)}
			/>
		</SettingItem>
	);
}
