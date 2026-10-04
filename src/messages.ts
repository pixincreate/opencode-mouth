import type { ModelRef, SessionMessageInfo } from "@opencode/client";

/** One transcript message as the scanner consumes it. */
export interface MessageSample {
  /** Stable message id; unique within its session. */
  messageId: string;
  role: "user" | "assistant";
  providerID: string;
  modelID: string;
  created: number;
  text: string;
}

/** Read transcript order, not timestamps. Control messages never contribute text. */
export function v2Samples(messages: readonly SessionMessageInfo[], fallback?: ModelRef): MessageSample[] {
  const firstSwitch = messages.find((message) => message.type === "model-switched");
  let selected = firstSwitch?.type === "model-switched" ? firstSwitch.previous ?? fallback : fallback;
  const samples: MessageSample[] = [];
  for (const message of messages) {
    if (message.type === "model-switched") {
      selected = message.model;
      continue;
    }
    if (message.type !== "user" && message.type !== "assistant") continue;
    const text = message.type === "user" ? message.text : message.content
      .filter((part) => part.type === "text")
      .map((part) => part.type === "text" ? part.text : "").join("\n");
    if (!text.trim()) continue;
    const model = message.type === "assistant" ? message.model : selected;
    samples.push({ messageId: message.id, role: message.type, providerID: model?.providerID ?? "unknown", modelID: model?.id ?? "unknown", created: message.time.created, text });
  }
  return samples;
}
