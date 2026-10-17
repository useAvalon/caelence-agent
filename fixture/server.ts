const CSP = [
	"default-src 'self'",
	"script-src 'self'",
	"style-src 'self'",
	"require-trusted-types-for 'script'",
].join("; ");

const port = Number(process.env.PORT ?? 4321);

Bun.serve({
	port,
	async fetch(req) {
		const path = new URL(req.url).pathname;
		const file = Bun.file(`${import.meta.dir}${path === "/" ? "/index.html" : path}`);
		if (!(await file.exists())) return new Response("not found", { status: 404 });
		return new Response(file, { headers: { "Content-Security-Policy": CSP } });
	},
});
