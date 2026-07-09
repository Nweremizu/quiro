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
  type AiToolDefinition,
  type AiToolName,
  type AiToolResultBlock,
  type AiToolUseBlock,
  type EditorActions,
  type ToolResult,
} from "./contract";

/**
 * Tools whose failure reasons are independent of their (small) input surface —
 * e.g. `generate_captions` only takes a `language`, which cannot fix "no audio
 * track" / "missing model" / "no source video". Retrying these with the model
 * looping on its own can never succeed, so once one fails it is removed from
 * the tool list for the rest of THIS turn — the model literally cannot call it
 * again (rather than merely being asked not to), which is what stops it from
 * narrating repeated "retrying…" text into the chat. A fresh user message (or
 * the dedicated "Retry" button on the Director's greeting bubble) starts a new
 * attempt once the user has actually fixed the underlying cause.
 */
const NON_RETRYABLE_ON_FAILURE: ReadonlySet<AiToolName> = new Set([
  "generate_captions",
]);

/* ── Public API ──────────────────────────────────────────────────────────── */

/**
 * Part-level stream events, emitted in the order they happen so the UI can
 * build AI SDK-style `UIMessage` parts live (streaming text, then each tool
 * call appearing as it's dispatched). This is what drives the AI Elements
 * Conversation/Message/Tool/ChainOfThought rendering.
 */
export type AgentStreamEvent =
  | { type: "text-delta"; text: string }
  | {
      type: "tool-input";
      toolCallId: string;
      toolName: AiToolName;
      input: unknown;
    }
  | {
      type: "tool-output";
      toolCallId: string;
      toolName: AiToolName;
      output: ToolResult;
    };

export interface AgentRunOptions {
  /** The user's latest message text. */
  userMessage: string;
  /** Accumulated conversation history from previous turns. */
  previousMessages: AiMessage[];
  /** Stable EditorActions ref from window.tsx. */
  actions: EditorActions;
  /** Optional callback for streaming assistant text (legacy/plain-text path). */
  onAssistantDelta?: (text: string) => void;
  /** Optional part-level event stream (preferred — drives UIMessage parts). */
  onEvent?: (event: AgentStreamEvent) => void;
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

  let messages: AiMessage[] = [
    ...previousMessages,
    { role: "user", content: userMessage },
  ];

  const toolsApplied: Array<{ name: string; result: ToolResult }> = [];
  let assistantText = "";
  const requestBase = `agent-${Date.now()}`;

  // Tools disabled for the rest of this turn after a failure — see
  // NON_RETRYABLE_ON_FAILURE above. `seenFailures` is a general safety net for
  // every other tool: if the identical (tool, reason) pair fails twice in one
  // turn, further retries are provably making no progress, so disable it too.
  const disabledTools = new Set<AiToolName>();
  const seenFailureKeys = new Set<string>();

  actions.beginAiBatch?.("AI run");
  let disposeStreamListener: (() => void) | undefined;
  if (opts.onAssistantDelta || opts.onEvent) {
    disposeStreamListener = window.electronAPI.ai.onStreamEvent((payload: unknown) => {
      if (
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: unknown }).type === "delta" &&
        typeof (payload as { requestId?: unknown }).requestId === "string"
      ) {
        const event = payload as { type: string; requestId: string; text?: string };
        if (event.requestId.startsWith(requestBase) && typeof event.text === "string") {
          opts.onAssistantDelta?.(event.text);
          opts.onEvent?.({ type: "text-delta", text: event.text });
        }
      }
    });
  }

  try {
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const brain = buildBrain(actions.getBrainInputs());
      const summary = summarizeBrain(brain);
      const system = buildAgentSystemPrompt(summary);

      const aiPrefs = await window.electronAPI.ai.getAiPreferences().catch(() => null);
      const model = aiPrefs?.selectedModel ?? AI_MODELS.minimaxPlanner;

      // Tools that already failed unrecoverably this turn are omitted from the
      // schema entirely, so the model has no way to call them again.
      const availableTools: AiToolDefinition[] = disabledTools.size
        ? AI_TOOLS.filter((tool) => !disabledTools.has(tool.name))
        : AI_TOOLS;

      const result = await window.electronAPI.ai.complete({
      requestId: `${requestBase}-${i}`,
      model,
      system,
      messages,
      tools: availableTools,
      maxTokens: DEFAULT_MAX_TOKENS,
      stream: Boolean(opts.onAssistantDelta || opts.onEvent),
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

      // Announce the call before running it, so the UI can show the tool part
      // in its "input-available" state while the edit is applied.
      opts.onEvent?.({
        type: "tool-input",
        toolCallId: toolBlock.id,
        toolName: toolBlock.name,
        input: toolBlock.input,
      });

      let toolResult: ToolResult;
      try {
        toolResult = await dispatchToolCall(toolBlock, { brain, actions });
      } catch (err) {
        toolResult = { ok: false, summary: `Tool error: ${String(err)}`, reason: "dispatch-error" };
      }

      opts.onEvent?.({
        type: "tool-output",
        toolCallId: toolBlock.id,
        toolName: toolBlock.name,
        output: toolResult,
      });

      toolsApplied.push({ name: toolBlock.name, result: toolResult });

      if (!toolResult.ok) {
        if (NON_RETRYABLE_ON_FAILURE.has(toolBlock.name)) {
          disabledTools.add(toolBlock.name);
        } else {
          const failureKey = `${toolBlock.name}:${toolResult.reason ?? toolResult.summary}`;
          if (seenFailureKeys.has(failureKey)) {
            disabledTools.add(toolBlock.name);
          } else {
            seenFailureKeys.add(failureKey);
          }
        }
      }

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
  } finally {
    disposeStreamListener?.();
    actions.endAiBatch?.();
  }
}

// Narrow helper type used for the error block check above.
interface AiTextContent {
  type: "text";
  text: string;
}
