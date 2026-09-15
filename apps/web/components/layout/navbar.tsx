"use client";

import { EmbossButton } from "@quiro/ui/EmbossButton";
import { cn } from "cn";
import { Menu, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import MicrosoftIcon from "@/components/icons/microsoft";
import QuiroLogo from "@/components/icons/quiro";
import { useScrolled } from "@/hooks/use-scrolled";
import { site } from "@/lib/site";
import NavbarFrame from "./navbar-frame";

const navItems = [
	{ label: "Features", href: "/#features" },
	{ label: "Downloads", href: "/download" },
	{ label: "Changelog", href: "/releases" },
	{ label: "FAQ", href: "/#faq" },
];

export default function Navbar() {
	const scrolled = useScrolled(500);
	const [open, setOpen] = useState(false);
	return (
		<NavbarFrame scrolled={scrolled}>
			<a
				href="#main-content"
				className="sr-only focus:not-sr-only focus:absolute focus:top-20 focus:rounded-lg focus:bg-gray-1 focus:p-3"
			>
				Skip to content
			</a>
			<div className="relative flex items-center justify-between gap-4 px-3 py-3">
				<Link
					href="/"
					className="flex shrink-0 items-center gap-2"
					onClick={() => setOpen(false)}
				>
					<QuiroLogo className="size-9" />
					{/* <span className="text-xl font-semibold tracking-tight">Quiro</span> */}
					<span
						className={cn(
							"grid transition-[grid-template-columns] duration-300 ease-(--ease-snappy)",
							scrolled ? "grid-cols-[0fr]" : "grid-cols-[1fr]",
						)}
					>
						<span className="overflow-hidden whitespace-nowrap">
							<span
								className={cn(
									"inline-block pl-2 font-semibold text-2xl text-gray-12 transition-opacity duration-200",
									scrolled ? "opacity-0" : "opacity-100 delay-100",
								)}
							>
								{site.name}
							</span>
						</span>
					</span>
				</Link>
				<nav
					aria-label="Main navigation"
					className="hidden items-center gap-6 md:flex"
				>
					{navItems.map((item) => (
						<Link
							key={item.href}
							href={item.href}
							className="text-sm font-medium text-gray-11 hover:text-gray-12"
						>
							{item.label}
						</Link>
					))}
				</nav>
				<div className="hidden md:block">
					<EmbossButton href="/download" variant="accent">
						<MicrosoftIcon className="size-4" />
						Download
					</EmbossButton>
				</div>
				<button
					type="button"
					aria-label={open ? "Close menu" : "Open menu"}
					aria-expanded={open}
					aria-controls="mobile-navigation"
					onClick={() => setOpen(!open)}
					className="grid size-10 cursor-pointer place-items-center rounded-lg hover:bg-gray-4 md:hidden"
				>
					{open ? <X size={21} /> : <Menu size={21} />}
				</button>
				{open && (
					<nav
						id="mobile-navigation"
						aria-label="Mobile navigation"
						className="mobile-menu md:hidden"
						onKeyDown={(event) => {
							if (event.key === "Escape") {
								setOpen(false);
								event.currentTarget.parentElement
									?.querySelector<HTMLButtonElement>("button[aria-controls]")
									?.focus();
							}
						}}
					>
						{navItems.map((item) => (
							<Link
								href={item.href}
								key={item.href}
								onClick={() => setOpen(false)}
							>
								{item.label}
							</Link>
						))}
					</nav>
				)}
			</div>
		</NavbarFrame>
	);
}
