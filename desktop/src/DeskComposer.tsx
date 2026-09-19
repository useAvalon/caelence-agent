import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { MicrophoneIcon } from "@phosphor-icons/react/dist/csr/Microphone";
import { PaperPlaneTiltIcon } from "@phosphor-icons/react/dist/csr/PaperPlaneTilt";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { SquareIcon } from "@phosphor-icons/react/dist/csr/Square";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { AttachmentThumbs } from "./ComposerAttach";
import { composePlaceholder, pickerSelectedId, titleCase, type UiStatus } from "./desk-types";
import { QueuePanel } from "./QueuePanel";
import { removeQueued, setQueuedText, updateQueued } from "./queue";
import type { DeskReady } from "./useDesktopApp";

export function ComposeMicControl(
	props: Readonly<{
		status: UiStatus;
		listening: boolean;
		onStop: () => void;
		onStopDictation: () => void;
		onStartDictation: () => void;
	}>,
): React.ReactElement {
	if (props.status === "running" || props.status === "approval") {
		return (
			<button type="button" className="desk-compose-icon" aria-label="Stop" onClick={props.onStop}>
				<SquareIcon size={16} weight="regular" />
			</button>
		);
	}
	if (props.listening) {
		return (
			<button
				type="button"
				className="desk-compose-icon is-on"
				aria-label="Stop dictation"
				aria-pressed
				onClick={props.onStopDictation}
			>
				<MicrophoneIcon size={16} weight="regular" />
			</button>
		);
	}
	return (
		<button
			type="button"
			className="desk-compose-icon"
			aria-label="Dictate"
			aria-pressed={false}
			disabled={props.status !== "idle"}
			onClick={props.onStartDictation}
		>
			<MicrophoneIcon size={16} weight="regular" />
		</button>
	);
}

export function pickerItemHint(applied: boolean, hint?: string): React.ReactNode {
	if (applied) return <em>on</em>;
	if (hint) return <em>{hint}</em>;
	return null;
}

export function DeskComposer(props: Readonly<{ desk: DeskReady }>): React.ReactElement {
	return (
		<footer className="desk-composer">
			{props.desk.fileDrag ? <p className="desk-composer__drop">Drop files to attach</p> : null}
			<DeskQueueSection desk={props.desk} />
			<DeskMediaMeta desk={props.desk} />
			<DeskComposerRow desk={props.desk} />
		</footer>
	);
}

export function DeskQueueSection(props: Readonly<{ desk: DeskReady }>): React.ReactElement | null {
	const { desk } = props;
	if (desk.queue.length === 0) return null;
	return (
		<QueuePanel
			queue={desk.queue}
			open={desk.queueOpen}
			editingId={desk.editingQueuedId}
			onToggle={() => desk.setQueueOpen((current) => !current)}
			onEdit={desk.setEditingQueuedId}
			onChangeText={(id, text) => desk.setQueueSync(setQueuedText(desk.queueRef.current, id, text))}
			onCommitText={(id, text) => {
				desk.setQueueSync(updateQueued(desk.queueRef.current, id, text));
				desk.setEditingQueuedId(null);
			}}
			onSendNow={(id) => void desk.sendQueuedNow(id)}
			onRemove={(id) => {
				if (desk.editingQueuedId === id) desk.setEditingQueuedId(null);
				desk.setQueueSync(removeQueued(desk.queueRef.current, id));
			}}
		/>
	);
}

export function DeskMediaMeta(props: Readonly<{ desk: DeskReady }>): React.ReactElement | null {
	const { desk } = props;
	if (desk.mediaModels.length === 0 || !desk.mediaOpen) return null;
	return (
		<section className="desk-composer__meta">
			<h2 className="visually-hidden">Active media models</h2>
			<p>
				{desk.mediaModels.map((item, index) => (
					<span key={item.kind} className="desk-composer__meta-item">
						{index > 0 ? (
							<span className="desk-composer__meta-sep" aria-hidden="true">
								·
							</span>
						) : null}
						<span className="desk-composer__meta-kind">{item.kind}</span>
						<span className="desk-composer__meta-name">{item.label}</span>
					</span>
				))}
			</p>
			<button
				type="button"
				className="desk-composer__meta-toggle"
				aria-expanded
				aria-label="Hide media models"
				onClick={() => desk.setMediaOpen(false)}
			>
				<XIcon size={14} weight="regular" />
			</button>
		</section>
	);
}

export function DeskComposerRow(props: Readonly<{ desk: DeskReady }>): React.ReactElement {
	const { desk } = props;
	return (
		<div className="desk-composer__row">
			<input
				ref={desk.fileInputRef}
				className="visually-hidden"
				type="file"
				multiple
				onChange={(event) => {
					desk.addFiles(Array.from(event.target.files ?? []));
					event.target.value = "";
				}}
			/>
			<DeskMediaPeek desk={desk} />
			<DeskComposeBox desk={desk} />
		</div>
	);
}

export function DeskMediaPeek(props: Readonly<{ desk: DeskReady }>): React.ReactElement | null {
	if (props.desk.mediaModels.length === 0 || props.desk.mediaOpen) return null;
	return (
		<button
			type="button"
			className="desk-composer__meta-toggle desk-composer__meta-toggle--peek"
			aria-expanded={false}
			aria-label="Show media models"
			onClick={() => props.desk.setMediaOpen(true)}
		>
			<CaretDownIcon size={14} weight="bold" />
		</button>
	);
}

export function DeskComposeBox(props: Readonly<{ desk: DeskReady }>): React.ReactElement {
	const { desk } = props;
	const filled = desk.attachments.length > 0;
	return (
		<fieldset
			className={`desk-field desk-compose-box${filled ? " has-files" : ""}`}
			onDragEnter={desk.onFileDragEnter}
			onDragOver={desk.onFileDragOver}
			onDragLeave={desk.onFileDragLeave}
			onDrop={desk.onFileDrop}
		>
			<legend className="visually-hidden">Message composer</legend>
			<DeskSlashMenu desk={desk} />
			<DeskPickerMenu desk={desk} />
			<AttachmentThumbs items={desk.attachments} onRemove={desk.removeAttachment} />
			<textarea
				ref={desk.inputRef}
				className="cel-input desk-compose-input"
				rows={1}
				aria-label="Message"
				value={desk.draft}
				placeholder={composePlaceholder(desk.listening, desk.status)}
				disabled={desk.listening}
				onChange={(event) => desk.setDraft(event.target.value)}
				onKeyDown={desk.onKeyDown}
			/>
			<DeskComposeBar desk={desk} />
		</fieldset>
	);
}

export function DeskSlashMenu(props: Readonly<{ desk: DeskReady }>): React.ReactElement | null {
	const { desk } = props;
	if (!desk.slashOpen || desk.slashItems.length === 0) return null;
	return (
		<div className="desk-slash cel-float">
			{desk.slashItems.map((item, index) => (
				<button
					key={item.name}
					type="button"
					className={index === desk.slashIndex ? "is-on" : undefined}
					onClick={() => desk.setDraft(item.arg ? `/${item.name} ` : `/${item.name}`)}
				>
					<span>
						/{item.name}
						{item.slot ? ` ${item.slot}` : ""}
					</span>
					<em>· {item.hint}</em>
				</button>
			))}
		</div>
	);
}

export function DeskPickerMenu(props: Readonly<{ desk: DeskReady }>): React.ReactElement | null {
	const { desk } = props;
	const picker = desk.picker;
	if (!picker) return null;
	return (
		<div className="desk-float cel-float" role="listbox" aria-label={picker.title}>
			<p>{picker.title}</p>
			<ul ref={desk.pickerListRef}>
				{picker.items.map((item, index) => (
					<li key={item.id}>
						<button
							type="button"
							role="option"
							aria-selected={index === picker.index}
							data-picker-index={index}
							className={index === picker.index ? "is-on" : undefined}
							onClick={() => void desk.choosePicker(item)}
						>
							<span>{item.label}</span>
							{pickerItemHint(
								Boolean(desk.state && item.id === pickerSelectedId(picker.kind, desk.state)),
								item.hint,
							)}
						</button>
					</li>
				))}
			</ul>
			<button
				type="button"
				className="cel-btn cel-btn--quiet cel-btn--compact"
				onClick={() => desk.cancelPicker()}
			>
				Cancel
			</button>
		</div>
	);
}

export function DeskComposeBar(props: Readonly<{ desk: DeskReady }>): React.ReactElement {
	const { desk } = props;
	const canPick = desk.status === "idle" || desk.status === "picker";
	const canSend = Boolean(desk.draft.trim() || desk.attachments.length > 0);
	const queueing = desk.status === "running" || desk.status === "approval";
	return (
		<div className="desk-compose-bar">
			<button
				type="button"
				className="desk-compose-icon"
				aria-label="Add files"
				onClick={() => desk.fileInputRef.current?.click()}
			>
				<PlusIcon size={16} weight="regular" />
			</button>
			<div className="desk-compose-bar__end">
				<button
					type="button"
					className="desk-compose-model"
					aria-label="Choose model"
					disabled={!canPick}
					onClick={() => void desk.openComposerPicker("model")}
				>
					<span>{desk.state.modelTarget ?? desk.state.modelLabel}</span>
					<CaretDownIcon size={12} weight="bold" />
				</button>
				<button
					type="button"
					className="desk-compose-mode"
					aria-label="Choose mode"
					disabled={!canPick}
					onClick={() => void desk.openComposerPicker("mode")}
				>
					<span className="desk-compose-mode__dot" aria-hidden="true" />
					{titleCase(desk.state.mode)}
				</button>
				<ComposeMicControl
					status={desk.status}
					listening={desk.listening}
					onStop={() => void desk.stop()}
					onStopDictation={() => desk.stopDictation()}
					onStartDictation={() => void desk.startDictation()}
				/>
				<button
					type="button"
					className={`desk-compose-send${canSend ? " is-on" : ""}`}
					disabled={desk.listening || !canSend}
					onClick={() => void desk.submit()}
					aria-label={queueing ? "Queue" : "Send"}
				>
					<PaperPlaneTiltIcon size={16} weight="regular" />
				</button>
			</div>
		</div>
	);
}
