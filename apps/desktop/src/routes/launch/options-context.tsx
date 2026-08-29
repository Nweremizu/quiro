import { createOptionsQuery } from "@/utils/queries";
import {
	createContext,
	useContext,
	type ReactNode,
} from "react";

type RecordingOptionsContextValue = ReturnType<typeof createOptionsQuery>;

const RecordingOptionsContext =
	createContext<RecordingOptionsContextValue | null>(null);

export function RecordingOptionsProvider({
	children,
}: {
	children: ReactNode;
}) {
	const options = createOptionsQuery();

	return (
		<RecordingOptionsContext.Provider value={options}>
			{children}
		</RecordingOptionsContext.Provider>
	);
}

export function useRecordingOptions() {
	const context = useContext(RecordingOptionsContext);

	if (!context) {
		throw new Error(
			"useRecordingOptions must be used within a RecordingOptionsProvider",
		);
	}

	return context;
}