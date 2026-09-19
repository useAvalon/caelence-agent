import { DeskBoot } from "./DeskBoot";
import { DesktopChrome } from "./DeskChrome";
import { useDesktopApp } from "./useDesktopApp";

export function App(): React.ReactElement {
	return <DesktopApp />;
}

function DesktopApp(): React.ReactElement {
	const desk = useDesktopApp();
	if (desk.bootError) return <DeskBoot error={desk.bootError} />;
	if (!desk.state) return <DeskBoot />;
	return <DesktopChrome desk={{ ...desk, state: desk.state }} />;
}
