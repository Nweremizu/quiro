import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../../App.css";
import LaunchToolbarPreview from "./launch-toolbar-preview";

const root = document.getElementById("root");

if (!root) throw new Error("Launch toolbar preview root is missing");

createRoot(root).render(
	<StrictMode>
		<LaunchToolbarPreview />
	</StrictMode>,
);
