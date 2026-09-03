import { useQuery } from "@tanstack/react-query";
import TargetCard from "@/routes/launch/TargetCard";
import { listRecordingsQuery } from "@/utils/queries";
import { commands } from "@/utils/tauri";
import { MediaManager } from "./media-manager";

export default function RecordingsSettings() {
	const query = useQuery(listRecordingsQuery);

	return (
		<MediaManager
			title="Recordings"
			description="Everything Quiro has captured, plus anything you've imported. Imported videos open in the editor like a normal recording."
			items={query.data}
			isPending={query.isPending}
			queryKey={listRecordingsQuery.queryKey}
			importLabel="Import video"
			importCommand={async (source) => {
				const result = await commands.importVideo(source);
				if (result.status === "error") throw new Error(result.error);
			}}
			importFilter={{
				name: "Video",
				extensions: ["mp4", "mov", "mkv", "webm", "avi", "m4v"],
			}}
			renderCard={(item, highlightQuery, refetch) => (
				<TargetCard
					key={item.path}
					variant="recording"
					target={item}
					highlightQuery={highlightQuery}
					onRefetch={refetch}
				/>
			)}
		/>
	);
}
