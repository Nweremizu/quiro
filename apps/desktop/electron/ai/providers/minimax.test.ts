import { describe, expect, it } from "vitest";
import {
  fromOpenAiResponse,
  toOpenAiRequest,
  type OpenAiChatResponse,
} from "./minimax";
import type { AiCompleteRequestWire } from "../types";

describe("minimax translation: wire → OpenAI", () => {
  it("maps system, string messages, tool_use, and tools", () => {
    const request: AiCompleteRequestWire = {
      requestId: "r1",
      model: "MiniMax-M2.5",
      system: "you are quiro",
      messages: [
        { role: "user", content: "zoom my clicks" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "on it" },
            {
              type: "tool_use",
              id: "call_1",
              name: "auto_zoom_on_clicks",
              input: { depth: 2 },
            },
          ],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "call_1", content: "added 4" },
          ],
        },
      ],
      tools: [
        {
          name: "auto_zoom_on_clicks",
          description: "zoom on clicks",
          input_schema: { type: "object", properties: { depth: {} } },
        },
      ],
    };

    const out = toOpenAiRequest(request);

    expect(out.model).toBe("MiniMax-M2.5");
    expect(out.messages[0]).toEqual({
      role: "system",
      content: "you are quiro",
    });
    expect(out.messages[1]).toEqual({ role: "user", content: "zoom my clicks" });

    const assistant = out.messages[2];
    expect(assistant.role).toBe("assistant");
    expect(assistant.content).toBe("on it");
    expect(assistant.tool_calls?.[0]).toEqual({
      id: "call_1",
      type: "function",
      function: { name: "auto_zoom_on_clicks", arguments: JSON.stringify({ depth: 2 }) },
    });

    // tool_result becomes its own role: "tool" message
    expect(out.messages[3]).toEqual({
      role: "tool",
      tool_call_id: "call_1",
      content: "added 4",
    });

    expect(out.tools?.[0]).toEqual({
      type: "function",
      function: {
        name: "auto_zoom_on_clicks",
        description: "zoom on clicks",
        parameters: { type: "object", properties: { depth: {} } },
      },
    });
  });
});

describe("minimax translation: OpenAI → wire", () => {
  it("maps text + tool_calls and finish_reason", () => {
    const response: OpenAiChatResponse = {
      choices: [
        {
          message: {
            content: "doing it",
            tool_calls: [
              {
                id: "call_9",
                function: {
                  name: "generate_captions",
                  arguments: '{"language":"auto"}',
                },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 12, completion_tokens: 7 },
    };

    const result = fromOpenAiResponse("r2", response);

    expect(result.requestId).toBe("r2");
    expect(result.stopReason).toBe("tool_use");
    expect(result.content[0]).toEqual({ type: "text", text: "doing it" });
    expect(result.content[1]).toEqual({
      type: "tool_use",
      id: "call_9",
      name: "generate_captions",
      input: { language: "auto" },
    });
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 7 });
  });

  it("falls back gracefully on unparseable tool arguments", () => {
    const result = fromOpenAiResponse("r3", {
      choices: [
        {
          message: { tool_calls: [{ id: "c", function: { name: "x", arguments: "{bad" } }] },
          finish_reason: "tool_calls",
        },
      ],
    });
    expect(result.content[0]).toEqual({
      type: "tool_use",
      id: "c",
      name: "x",
      input: { _unparsed: "{bad" },
    });
  });
});
