import { ArrowUDownLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowUDownLeft";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { CircleIcon } from "@phosphor-icons/react/dist/csr/Circle";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { useEffect, useRef } from "react";
import { AttachmentThumbs } from "./ComposerAttach";
import type { QueuedMessage } from "./queue";

export function QueuePanel(
	props: Readonly<{
		queue: QueuedMessage[];
		open: boolean;
		editingId: string | null;
		onToggle: () => void;
		onEdit: (id: string | null) => void;
		onChangeText: (id: string, text: string) => void;
		onCommitText: (id: string, text: string) => void;
		onSendNow: (id: string) => void;
		onRemove: (id: string) => void;
	}>,
): React.ReactElement {
	const editRef = useRef<HTMLTextAreaElement>(null);
	const count = props.queue.length;
	const title = count === 1 ? "1 queued message" : `${count} queued messages`;
	useEffect(() => {
		if (props.editingId) editRef.current?.focus();
	}, [props.editingId]);
	return (
		<section className="desk-queue">
			<button
				type="button"
				className="desk-queue__head"
				aria-expanded={props.open}
				onClick={props.onToggle}
			>
				<CaretDownIcon className="desk-queue__caret" size={12} weight="bold" aria-hidden="true" />
				{title}
			</button>
			{props.open ? (
				<ul className="desk-queue__list">
					{props.queue.map((item) => {
						const editing = props.editingId === item.id;
						return (
							<li key={item.id} className={`desk-queue-item${editing ? " is-editing" : ""}`}>
								<button
									type="button"
									className="desk-queue__pick"
									aria-label="Send now"
									onClick={() => props.onSendNow(item.id)}
								>
									<CircleIcon size={16} weight="regular" aria-hidden="true" />
								</button>
								{editing ? (
									<textarea
										ref={editRef}
										className="cel-input desk-compose-input desk-queue__input"
										rows={2}
										value={item.text}
										aria-label="Edit queued message"
										onChange={(event) => props.onChangeText(item.id, event.target.value)}
										onKeyDown={(event) => {
											if (event.key === "Enter" && !event.shiftKey) {
												event.preventDefault();
												props.onCommitText(item.id, item.text);
											}
											if (event.key === "Escape") {
												event.preventDefault();
												props.onEdit(null);
											}
										}}
										onBlur={() => props.onCommitText(item.id, item.text)}
									/>
								) : (
									<div className="desk-queue-copy">
										<AttachmentThumbs items={item.attachments ?? []} />
										{item.text ? (
											<button
												type="button"
												className="desk-queue-text"
												onClick={() => props.onEdit(item.id)}
											>
												{item.text}
											</button>
										) : null}
									</div>
								)}
								{editing ? null : (
									<div className="desk-queue__actions">
										<button
											type="button"
											className="desk-queue__act"
											onClick={() => props.onSendNow(item.id)}
										>
											Send now
											<ArrowUDownLeftIcon size={12} weight="bold" aria-hidden="true" />
										</button>
										<button
											type="button"
											className="desk-queue__icon"
											aria-label="Edit queued message"
											onClick={() => props.onEdit(item.id)}
										>
											<PencilSimpleIcon size={14} weight="regular" />
										</button>
										<button
											type="button"
											className="desk-queue__icon"
											aria-label="Remove from queue"
											onClick={() => props.onRemove(item.id)}
										>
											<TrashIcon size={14} weight="regular" />
										</button>
									</div>
								)}
							</li>
						);
					})}
				</ul>
			) : null}
		</section>
	);
}
