/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_HARNESS_BRIDGE?: string;
	readonly VITE_HARNESS_TOKEN?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}

interface Window {
	__HARNESS_BRIDGE?: string;
	__HARNESS_TOKEN?: string;
}
