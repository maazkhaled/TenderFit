/**
 * Anthropic provider.
 *
 * Structured output is implemented with forced tool-use: we register a
 * single tool whose input_schema mirrors the caller's JSON schema, then
 * tool_choice forces the model to emit a tool_use block. This is the
 * official, most-reliable structured-output path for Claude.
 *
 * The SDK is loaded lazily so the package still works when `LLM_PROVIDER`
 * is local and ANTHROPIC_API_KEY is unset.
 */

import type {
  ChatProvider,
  ChatStructuredRequest,
  ChatTextRequest,
} from "./types";
import { ProviderError } from "./types";
import type { ChatProviderConfig } from "./config";

type AnthropicCtor = new (opts: { apiKey: string; baseURL?: string }) => {
  messages: {
    create: (params: unknown) => Promise<{
      content: Array<
        | { type: "text"; text: string }
        | { type: "tool_use"; name: string; input: unknown }
      >;
    }>;
  };
};

let _SDK: AnthropicCtor | null = null;
async function loadSDK(): Promise<AnthropicCtor> {
  if (_SDK) return _SDK;
  try {
    const mod = await import("@anthropic-ai/sdk");
    _SDK = (mod as { default: AnthropicCtor }).default;
    return _SDK;
  } catch (err) {
    throw new ProviderError(
      "anthropic",
      "@anthropic-ai/sdk is not installed. Run: pnpm add @anthropic-ai/sdk -F @beta/llm",
      err,
    );
  }
}

export class AnthropicChatProvider implements ChatProvider {
  readonly name = "anthropic" as const;
  private _client: InstanceType<AnthropicCtor> | null = null;

  constructor(private readonly cfg: ChatProviderConfig) {}

  private async client(): Promise<InstanceType<AnthropicCtor>> {
    if (this._client) return this._client;
    if (!this.cfg.apiKey) {
      throw new ProviderError("anthropic", "ANTHROPIC_API_KEY is not set");
    }
    const SDK = await loadSDK();
    this._client = new SDK({ apiKey: this.cfg.apiKey, baseURL: this.cfg.baseUrl });
    return this._client;
  }

  async ping(): Promise<{ ok: boolean; detail: string }> {
    if (!this.cfg.apiKey) {
      return { ok: false, detail: "ANTHROPIC_API_KEY not set" };
    }
    try {
      await this.client(); // SDK construction validates the key shape
      return { ok: true, detail: "SDK ready" };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }

  async chatText(req: ChatTextRequest): Promise<string> {
    const c = await this.client();
    const model = req.tier === "fast" ? this.cfg.fastModel : this.cfg.reasoningModel;
    const response = await c.messages.create({
      model,
      max_tokens: req.maxTokens ?? 1500,
      temperature: req.temperature ?? 0.2,
      system: req.system,
      messages: [{ role: "user", content: req.user }],
    });
    const text = response.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (!text) throw new ProviderError("anthropic", "empty text response");
    return text;
  }

  async chatStructured<T = unknown>(req: ChatStructuredRequest<T>): Promise<T> {
    const c = await this.client();
    const model = req.tier === "fast" ? this.cfg.fastModel : this.cfg.reasoningModel;

    const tool = {
      name: req.schemaName,
      description: req.schemaDescription,
      input_schema: req.schema,
    };

    let lastError: string | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const messages: Array<{ role: "user" | "assistant"; content: string }> = [
        { role: "user", content: req.user },
      ];
      if (attempt > 0 && lastError) {
        messages.push({
          role: "user",
          content: `Your previous response was invalid because: ${lastError}\n\nReturn the assessment again by calling ${req.schemaName} with valid arguments.`,
        });
      }

      const response = await c.messages.create({
        model,
        max_tokens: req.maxTokens ?? 1500,
        temperature: req.temperature ?? 0,
        system: req.system,
        tools: [tool],
        tool_choice: { type: "tool", name: req.schemaName },
        messages,
      });

      const toolUse = response.content.find(
        (b): b is { type: "tool_use"; name: string; input: unknown } =>
          b.type === "tool_use",
      );
      if (!toolUse) {
        lastError = "no tool_use block returned";
        continue;
      }
      if (toolUse.name !== req.schemaName) {
        lastError = `unexpected tool name: ${toolUse.name}`;
        continue;
      }
      if (req.validate) {
        try {
          return req.validate(toolUse.input);
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          continue;
        }
      }
      return toolUse.input as T;
    }
    throw new ProviderError(
      "anthropic",
      `model failed to return valid tool input after 2 attempts (last error: ${lastError ?? "unknown"})`,
    );
  }
}
