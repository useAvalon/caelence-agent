export interface ModelOption {
	id: string;
	label: string;
}

/** Default OpenRouter slugs offered in the composer. */
export const HARNESS_MODELS: readonly ModelOption[] = [
	{ id: "openrouter/auto", label: "Auto" },
	{ id: "openrouter/auto-beta", label: "Auto beta" },
	{ id: "~x-ai/grok-latest", label: "Grok latest" },
	{ id: "~anthropic/claude-fable-latest", label: "Claude Fable latest" },
	{ id: "~anthropic/claude-opus-latest", label: "Claude Opus latest" },
	{ id: "~anthropic/claude-sonnet-latest", label: "Claude Sonnet latest" },
	{ id: "openai/gpt-5.6-sol", label: "GPT-5.6 Sol" },
	{ id: "openai/gpt-5.6-terra", label: "GPT-5.6 Terra" },
	{ id: "google/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro" },
	{ id: "~z-ai/glm-latest", label: "GLM latest" },
	{ id: "deepseek/deepseek-v4-pro-0813", label: "DeepSeek V4 Pro" },
	{ id: "~deepseek/deepseek-v4-flash-latest", label: "DeepSeek V4 Flash latest" },
	{ id: "openai/gpt-5.6-luna", label: "GPT-5.6 Luna" },
	{ id: "~google/gemini-flash-latest", label: "Gemini Flash latest" },
	{ id: "anthropic/claude-haiku-4.5", label: "Claude Haiku 4.5" },
	{ id: "~moonshotai/kimi-latest", label: "Kimi latest" },
	{ id: "moonshotai/kimi-k2.7-code", label: "Kimi K2.7 Code" },
	{ id: "qwen/qwen3-coder-next", label: "Qwen3 Coder" },
	{ id: "z-ai/glm-5.2", label: "GLM 5.2" },
];

export function modelPickerItems(
	current?: string,
	live?: ReadonlyMap<string, string>,
): Array<{ id: string; label: string; hint?: string }> {
	const items = HARNESS_MODELS.map((model) => {
		const target = live?.get(model.id)?.trim();
		const hint = target && target.toLowerCase() !== model.label.toLowerCase() ? target : undefined;
		return { id: model.id, label: model.label, ...(hint ? { hint } : {}) };
	});
	const id = current?.trim();
	if (id && !items.some((item) => item.id === id)) {
		items.unshift({ id, label: live?.get(id) ?? id, hint: "current" });
	}
	return items;
}
