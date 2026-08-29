import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useState,
} from "react";

export interface WindowState {
	hideMaximize?: boolean;
	maximized?: boolean;
	onMaximize?: () => void;
	items?: ReactNode;
}

interface WindowContextValue {
	state: WindowState | null;
	setState: (state: WindowState | null) => void;
}

const WindowContext = createContext<WindowContextValue | null>(null);

export function WindowProvider({ children }: { children: ReactNode }) {
	const [state, setState] = useState<WindowState | null>(null);

	return (
		<WindowContext.Provider value={{ state, setState }}>
			{children}
		</WindowContext.Provider>
	);
}

export function useWindowContext() {
	const context = useContext(WindowContext);
	if (!context) {
		throw new Error("useWindowContext must be used within a WindowProvider");
	}
	return context;
}

export function useWindowChrome({
	hideMaximize,
	maximized,
	onMaximize,
	items,
}: WindowState) {
	const { setState } = useWindowContext();

	// Depend on the individual fields, not a `state` object built fresh by the
	// caller every render: this effect's own setState triggers a context
	// update, which re-renders this hook's caller as a context consumer even
	// when its actual props haven't changed — a new wrapper object on that
	// render alone would look like a dependency change and re-fire the effect
	// forever. The fields themselves only change when the caller's real props
	// change, which is what should re-run this.
	useEffect(() => {
		setState({ hideMaximize, maximized, onMaximize, items });

		return () => {
			setState(null);
		};
	}, [setState, hideMaximize, maximized, onMaximize, items]);
}

export function WindowChromeHeader({
	hideMaximize,
	maximized,
	onMaximize,
	children,
}: {
	hideMaximize?: boolean;
	maximized?: boolean;
	onMaximize?: () => void;
	children?: ReactNode;
}) {
	useWindowChrome({
		hideMaximize,
		maximized,
		onMaximize,
		items: children,
	});

	return null;
}
