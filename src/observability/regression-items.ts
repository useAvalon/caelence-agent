import type { ExperimentItem } from "./experiments.ts";

/**
 * Seed cases for `website-generation-regression`. Expected output is
 * characteristics only — no invented metrics or sample copy.
 */
export const WEBSITE_GENERATION_REGRESSION: ExperimentItem[] = [
	{
		id: "saas-landing",
		input: {
			brief:
				"SaaS landing page for a project-management tool used by small agencies. Spec, pricing, FAQ.",
		},
		metadata: { siteType: "saas" },
		expectedOutput: { characteristics: ["pricing", "faq", "responsive"] },
	},
	{
		id: "restaurant",
		input: {
			brief: "Restaurant website with menu, hours, reservation form, and a location block.",
		},
		metadata: { siteType: "restaurant" },
		expectedOutput: { characteristics: ["menu", "hours", "responsive"] },
	},
	{
		id: "portfolio",
		input: { brief: "Portfolio for a photographer. Work grid, about, contact. No testimonials." },
		metadata: { siteType: "portfolio" },
		expectedOutput: { characteristics: ["work", "contact"] },
	},
	{
		id: "agency",
		input: {
			brief: "Design agency site. Services, selected work, contact. Sentence-case headings.",
		},
		metadata: { siteType: "agency" },
		expectedOutput: { characteristics: ["services", "work", "contact"] },
	},
	{
		id: "ecommerce",
		input: {
			brief:
				"Small ecommerce store for ceramic tableware. Catalog, product page, cart, shipping FAQ.",
		},
		metadata: { siteType: "ecommerce" },
		expectedOutput: { characteristics: ["catalog", "product", "faq"] },
	},
	{
		id: "blog",
		input: { brief: "Independent magazine. Issue index, article layout, about the editors." },
		metadata: { siteType: "blog" },
		expectedOutput: { characteristics: ["index", "article"] },
	},
	{
		id: "dashboard-marketing",
		input: { brief: "Marketing site for a B2B analytics dashboard product. Not the app itself." },
		metadata: { siteType: "saas" },
		expectedOutput: { characteristics: ["landing", "pricing"] },
	},
	{
		id: "ai-startup",
		input: {
			brief:
				"Dark premium landing page for an AI infrastructure company with pricing, integrations, FAQ and responsive mobile design. Do not invent testimonials.",
		},
		metadata: { siteType: "saas", difficulty: "hard" },
		expectedOutput: { characteristics: ["dark", "pricing", "integrations", "faq", "responsive"] },
	},
	{
		id: "developer-tool",
		input: {
			brief: "Docs-first site for a CLI. Install, commands, changelog. Mono for commands only.",
		},
		metadata: { siteType: "docs" },
		expectedOutput: { characteristics: ["install", "commands"] },
	},
	{
		id: "personal",
		input: { brief: "Personal site for a journalist. Bio, selected articles, email." },
		metadata: { siteType: "personal" },
		expectedOutput: { characteristics: ["bio", "articles", "contact"] },
	},
	{
		id: "docs-product",
		input: {
			brief: "Product documentation home with getting started, API reference, and changelog.",
		},
		metadata: { siteType: "docs" },
		expectedOutput: { characteristics: ["getting-started", "api"] },
	},
	{
		id: "nonprofit",
		input: {
			brief: "Nonprofit campaign site. Mission, programs, donate. No invented impact numbers.",
		},
		metadata: { siteType: "nonprofit" },
		expectedOutput: { characteristics: ["mission", "donate"] },
	},
	{
		id: "law-firm",
		input: { brief: "Law firm site. Practice areas, people, contact. Conservative layout." },
		metadata: { siteType: "professional" },
		expectedOutput: { characteristics: ["practice-areas", "people", "contact"] },
	},
	{
		id: "clinic",
		input: {
			brief: "Dental clinic. Services, hours, new-patient form. Facts only from the brief.",
		},
		metadata: { siteType: "health" },
		expectedOutput: { characteristics: ["services", "hours", "form"] },
	},
	{
		id: "hotel",
		input: { brief: "Boutique hotel. Rooms, location, booking enquiry. No invented star ratings." },
		metadata: { siteType: "hospitality" },
		expectedOutput: { characteristics: ["rooms", "location"] },
	},
	{
		id: "education",
		input: { brief: "Independent school. Admissions, calendar, faculty. No invented test scores." },
		metadata: { siteType: "education" },
		expectedOutput: { characteristics: ["admissions", "calendar"] },
	},
	{
		id: "marketplace",
		input: { brief: "Two-sided marketplace landing: for buyers, for sellers, pricing, FAQ." },
		metadata: { siteType: "marketplace" },
		expectedOutput: { characteristics: ["buyers", "sellers", "pricing", "faq"] },
	},
	{
		id: "mobile-first",
		input: {
			brief:
				"Mobile-first landing for a local courier. Quote form above the fold on a 390px viewport.",
		},
		metadata: { siteType: "services", difficulty: "hard" },
		expectedOutput: { characteristics: ["form", "responsive"] },
	},
	{
		id: "multilingual-ready",
		input: {
			brief:
				"Studio site with a language switcher for English and Danish. Same structure both languages.",
		},
		metadata: { siteType: "studio" },
		expectedOutput: { characteristics: ["language-switcher"] },
	},
	{
		id: "empty-proof",
		input: {
			brief:
				"New bakery with no reviews yet. Menu, hours, address. Do not invent testimonials or ratings.",
		},
		metadata: { siteType: "restaurant", difficulty: "hard" },
		expectedOutput: { characteristics: ["menu", "hours", "no-testimonials"] },
	},
];
