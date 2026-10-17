/** The agent does not drive a fake cursor. Actions go through AX / the page. */

export async function aimPause(_ms: number): Promise<void> {}

export async function moveBerryPointer(_x: number, _y: number, _label?: string): Promise<void> {}
