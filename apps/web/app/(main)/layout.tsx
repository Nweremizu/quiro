import type { PropsWithChildren } from "react";
import Navbar from "@/components/layout/navbar";

export default async function Layout(props: PropsWithChildren) {
	return (
		<>
			<Navbar />
			{props.children}
		</>
	);
}
