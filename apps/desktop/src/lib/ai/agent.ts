/**
 * src/lib/ai/agent.ts — agent runner loop (Sprint 1, S1-3).
 *
 * Runs one conversational turn: build the request, call ai:complete over IPC,
 * dispatch any tool_use blocks, feed tool_results back, repeat until the model
 * stops calling tools or MAX_TOOL_ITERATIONS is hit.
 *
 * Lives in the renderer so tool dispatches can touch React state directly.
 * The main process only owns the stateless model call (ai:complete).
 */
import { buildBrain, summarizeBrain } from "./brain";
import { buildAgentSystemPrompt } from "./systemPrompt";
import { dispatchToolCall } from "./tools";
import {
  AI_MODELS,
  AI_TOOLS,
  DEFAULT_MAX_TOKENS,
  MAX_TOOL_ITERATIONS,
  type AiContentBlock,
  type AiMessage,
  type AiToolResultBlock,
  type AiToolUseBlock,
  type EditorActions,
  type ToolResult,
} from "./contract";

/* ── Public API ──────────────────────────────────────────────────────────── */

export interface AgentRunOptions {
  /** The user's latest message text. */
  userMessage: string;
  /** Accumulated conversation history from previous turns. */
  previousMessages: AiMessage[];
  /** Stable EditorActions ref from window.tsx. */
  actions: EditorActions;
}

export interface AgentRunResult {
  /** Full updated conversation (hand back to AiChatPanel as next previousMessages). */
  messages: AiMessage[];
  /** Tool names executed in this turn, in call order. */
  toolsApplied: Array<{ name: string; result: ToolResult }>;
  /** Final assistant text (last text block in the conversation). */
  assistantText: string;
  /** Set if the run ended in an error. */
  error?: string;
}

/* ── Runner ──────────────────────────────────────────────────────────────── */

export async function runAgentTurn(
  opts: AgentRunOptions,
): Promise<AgentRunResult> {
  const { userMessage, previousMessages, actions } = opts;

  // Build brain once per run for consistent context.
  const inputs = actions.getBrainInputs();
  const brain = buildBrain(inputs);
  const summary = summarizeBrain(brain);
  const system = buildAgentSystemPrompt(summary);

  let messages: AiMessage[] = [
    ...previousMessages,
    { role: "user", content: userMessage },
  ];

  const toolsApplied: Array<{ name: string; result: ToolResult }> = [];
  let assistantText = "";
  const requestBase = `agent-${Date.now()}`;

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const result = await window.electronAPI.ai.complete({
      requestId: `${requestBase}-${i}`,
      model: AI_MODELS.planner,
      system,
      messages,
      tools: AI_TOOLS,
      maxTokens: DEFAULT_MAX_TOKENS,
    });

    if (result.stopReason === "error") {
      const errText =
        ((result.content[0] as unknown) as AiTextContent | undefined)?.text ?? "Unknown AI error.";
      return { messages, toolsApplied, assistantText, error: errText };
    }

    const assistantContent = (result.content as unknown) as AiContentBlock[];
    messages = [...messages, { role: "assistant", content: assistantContent }];

    // Collect the text blocks for narration
    for (const block of assistantContent) {
      if (block.type === "text") assistantText = block.text;
    }

    if (result.stopReason !== "tool_use") break;

    // Execute tool calls and gather tool_result blocks.
    const toolResultBlocks: AiToolResultBlock[] = [];
    for (const block of assistantContent) {
      if (block.type !== "tool_use") continue;
      const toolBlock = block as AiToolUseBlock;

      let toolResult: ToolResult;
      try {
        toolResult = dispatchToolCall(toolBlock, { brain, actions });
      } catch (err) {
        toolResult = { ok: false, summary: `Tool error: ${String(err)}`, reason: "dispatch-error" };
      }

      toolsApplied.push({ name: toolBlock.name, result: toolResult });
      toolResultBlocks.push({
        type: "tool_result",
        tool_use_id: toolBlock.id,
        content: JSON.stringify(toolResult),
        is_error: !toolResult.ok,
      });
    }

    // Feed results back as a user message before the next iteration.
    messages = [...messages, { role: "user", content: toolResultBlocks }];
  }

  return { messages, toolsApplied, assistantText };
}

// Narrow helper type used for the error block check above.
interface AiTextContent {
  type: "text";
  text: string;
}
