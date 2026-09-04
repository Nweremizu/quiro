import { useQuery } from "@tanstack/react-query";
import TargetCard from "@/routes/launch/TargetCard";
import { listScreenshotsQuery } from "@/utils/queries";
import { commands } from "@/utils/tauri";
import { MediaManager } from "./media-manager";

export default function ScreenshotsSettings() {
	const query = useQuery(listScreenshotsQuery);

	return (
		<MediaManager
			title="Screenshots"
			description="Every screenshot Quiro has taken. Importing copies the image into your library so it sits alongside the rest."
			items={query.data}
			isPending={query.isPending}
			queryKey={listScreenshotsQuery.queryKey}
			importLabel="Import image"
			importCommand={async (source) => {
				const result = await commands.importScreenshot(source);
				if (result.status === "error") throw new Error(result.error);
			}}
			importFilter={{
				name: "Image",
				extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"],
			}}
			renderCard={(item, highlightQuery, refetch) => (
				<TargetCard
					key={item.path}
					variant="screenshot"
					target={item}
					highlightQuery={highlightQuery}
					onRefetch={refetch}
				/>
			)}
		/>
	);
}
