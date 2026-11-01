import type { Message } from "@earendil-works/pi-ai";

function textOfUserMessage(message: Message): string {
	if (message.role !== "user") return "";
	if (typeof message.content === "string") return message.content;
	return message.content
		.map((block) => {
			if (block.type === "text") return block.text;
			if (block.type === "image") return "[image]";
			return "";
		})
		.filter((part) => part.length > 0)
		.join("\n");
}

export function extractAgyPrompt(messages: Message[], preamble: string | undefined): string {
	const lastUser = [...messages].reverse().find((message) => message.role === "user");
	const body = lastUser ? textOfUserMessage(lastUser).trim() : "";
	if (!body) throw new Error("agy provider: transcript has no user message to send");
	if (!preamble) return body;
	return `${preamble}\n\n${body}`;
}
