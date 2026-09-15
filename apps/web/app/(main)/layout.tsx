import Navbar from "@/components/layout/navbar";
import type { PropsWithChildren } from "react";


export default async function Layout(props: PropsWithChildren) {
    return (
        <>
            <Navbar />
            {props.children}
        </>
    );
}