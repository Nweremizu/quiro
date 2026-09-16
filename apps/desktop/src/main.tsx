if (
	import.meta.env.DEV &&
	window.location.pathname.replace(/\/$/, "") === "/debug/launch-toolbar"
) {
	void import("./routes/dev/launch-toolbar-entry");
} else {
	void import("./desktop-app");
}
