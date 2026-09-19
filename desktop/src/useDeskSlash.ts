import { useEffect, useState } from "react";
import { type BridgeClient, getSlash, type SlashCommand } from "./api";

export function useDeskSlash(input: {
	bridge: BridgeClient | null;
	draft: string;
	slashOpen: boolean;
}) {
	const [slashItems, setSlashItems] = useState<SlashCommand[]>([]);
	const [slashIndex, setSlashIndex] = useState(0);

	useEffect(() => {
		if (!input.bridge || !input.slashOpen) {
			setSlashItems([]);
			return;
		}
		let cancelled = false;
		void getSlash(input.bridge, input.draft).then((result) => {
			if (!cancelled) setSlashItems(result.items);
		});
		return () => {
			cancelled = true;
		};
	}, [input.bridge, input.draft, input.slashOpen]);

	useEffect(() => {
		setSlashIndex(0);
	}, [input.draft]);

	return { slashItems, slashIndex, setSlashIndex };
}
