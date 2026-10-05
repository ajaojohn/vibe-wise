// Pi shim for the VibeWise Claude Code plugin. Upstream files stay untouched.
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// Skills shell out to "${CLAUDE_PLUGIN_ROOT}/..."; bash inherits this env.
process.env.CLAUDE_PLUGIN_ROOT = ROOT;

const TOOL_NOTE =
	`\n\nPi notes: CLAUDE_PLUGIN_ROOT is ${ROOT}. "Read" means the read tool, ` +
	`"Glob" means find/ls. "/vibe-wise:learn" is /skill:learn and "/vibe-wise:reset" is /skill:reset.`;

// Reuse the upstream hook so restore logic stays identical.
function restoreContext(cwd: string): string | undefined {
	try {
		const out = execFileSync("python3", [join(ROOT, "hooks/session_start.py")], {
			input: JSON.stringify({ hook_event_name: "SessionStart", cwd }),
			timeout: 5000,
			encoding: "utf8",
		});
		return out.trim() ? JSON.parse(out).hookSpecificOutput?.additionalContext : undefined;
	} catch {
		return undefined; // learning must never block a session
	}
}

export default function vibeWise(pi: ExtensionAPI) {
	let pending = false;
	pi.on("session_start", (e) => {
		if (e.reason !== "reload") pending = true;
	});
	pi.on("session_compact", () => {
		pending = true;
	});
	pi.on("before_agent_start", (_e, ctx) => {
		if (!pending) return;
		pending = false;
		const text = restoreContext(ctx.cwd);
		if (!text) return;
		return { message: { customType: "vibe-wise", content: text + TOOL_NOTE, display: false } };
	});

	// Claude Code's native picker, which the skills call by name.
	pi.registerTool({
		name: "AskUserQuestion",
		label: "Ask",
		description: "Ask the user multiple-choice questions with a keyboard picker.",
		parameters: Type.Object({
			questions: Type.Array(
				Type.Object({
					question: Type.String(),
					header: Type.Optional(Type.String()),
					options: Type.Array(Type.Object({ label: Type.String(), description: Type.Optional(Type.String()) })),
					// ponytail: single-select only; VibeWise always passes false.
					multiSelect: Type.Optional(Type.Boolean()),
				}),
			),
		}),
		executionMode: "sequential",
		async execute(_id, { questions }, _signal, _update, ctx) {
			if (!ctx.hasUI) return { content: [{ type: "text", text: "Picker unavailable; ask in plain text." }] };
			const answers: string[] = [];
			for (const q of questions) {
				const shown = q.options.map((o) => (o.description ? `${o.label} — ${o.description}` : o.label));
				const pick = await ctx.ui.select(q.header ? `${q.header}: ${q.question}` : q.question, shown);
				if (pick === undefined) return { content: [{ type: "text", text: "User dismissed the question." }] };
				answers.push(`"${q.question}" = "${q.options[shown.indexOf(pick)].label}"`);
			}
			return { content: [{ type: "text", text: `User answered: ${answers.join("; ")}` }] };
		},
	});

	// The upstream skills only reach for this on explicit invocation; add the Pi tool mapping there too.
	pi.on("input", (e) => {
		if (/^\/skill:(learn|reset)\b/.test(e.text)) return { action: "transform", text: e.text + TOOL_NOTE };
	});
}
