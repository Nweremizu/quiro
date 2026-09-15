import { ArrowLeft, Search } from "lucide-react";
import Link from "next/link";
import QuiroLogo from "@/components/icons/quiro";

export default function NotFound() {
	return (
		<main className="not-found-page page-container">
			<div className="not-found-mark">
				<QuiroLogo className="size-16" />
				<Search className="not-found-search" size={24} />
			</div>
			<span className="eyebrow">404 · Nothing here yet</span>
			<h1>
				That capture
				<br />
				got away.
			</h1>
			<p>
				The page you’re looking for doesn’t exist or may have moved. Let’s get
				you back to the good stuff.
			</p>
			<Link href="/" className="text-link">
				<ArrowLeft size={16} /> Back to Quiro
			</Link>
		</main>
	);
}
