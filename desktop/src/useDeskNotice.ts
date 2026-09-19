import { useCallback, useState } from "react";
import { errorMessage } from "../../src/core/errors";
import type { NoticeKind } from "./FloatNotice";

export function useDeskNotice() {
	const [notice, setNotice] = useState<{ text: string; kind: NoticeKind; id: number } | null>(null);
	const dismissNotice = useCallback(() => setNotice(null), []);
	const showNotice = useCallback((text: string, kind: NoticeKind = "ok") => {
		const line = text.trim();
		if (!line) return;
		setNotice({ text: line, kind, id: Date.now() });
	}, []);
	const noticeError = useCallback(
		(err: unknown) => {
			showNotice(errorMessage(err), "error");
		},
		[showNotice],
	);
	return { notice, dismissNotice, showNotice, noticeError };
}
