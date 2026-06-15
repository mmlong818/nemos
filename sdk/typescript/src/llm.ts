// llm.ts — LLM Provider 抽象
//
// 支持三类 provider：anthropic / openai / custom。
// 失败重试用 exponential backoff，最多 3 次。

import type { LLMConfig, LLMProvider } from "./types.js";

const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6";
const DEFAULT_OPENAI_MODEL = "gpt-4o";
const DEFAULT_ZHIPU_MODEL = "glm-5.1";
const ZHIPU_ENDPOINT = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
const MAX_TOKENS = 4000;
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 500;

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model?: string) {
    if (!apiKey) throw new Error("[mnemos] Anthropic provider 缺少 apiKey");
    this.apiKey = apiKey;
    this.model = model || DEFAULT_ANTHROPIC_MODEL;
  }

  async chat(system: string, user: string): Promise<string> {
    return withRetry(async () => {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: MAX_TOKENS,
          system,
          messages: [{ role: "user", content: user }],
        }),
      });
      if (!resp.ok) {
        const body = await resp.text();
        throw makeHttpError("Anthropic", resp.status, body);
      }
      const data = (await resp.json()) as {
        content?: Array<{ text?: string }>;
      };
      return data.content?.[0]?.text || "";
    });
  }
}

export class OpenAIProvider implements LLMProvider {
  readonly name = "openai";
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model?: string) {
    if (!apiKey) throw new Error("[mnemos] OpenAI provider 缺少 apiKey");
    this.apiKey = apiKey;
    this.model = model || DEFAULT_OPENAI_MODEL;
  }

  async chat(system: string, user: string): Promise<string> {
    return withRetry(async () => {
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          response_format: { type: "json_object" },
        }),
      });
      if (!resp.ok) {
        const body = await resp.text();
        throw makeHttpError("OpenAI", resp.status, body);
      }
      const data = (await resp.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return data.choices?.[0]?.message?.content || "";
    });
  }
}

export class ZhipuProvider implements LLMProvider {
  readonly name = "zhipu";
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model?: string) {
    if (!apiKey) throw new Error("[mnemos] Zhipu provider 缺少 apiKey");
    this.apiKey = apiKey;
    this.model = model || DEFAULT_ZHIPU_MODEL;
  }

  async chat(system: string, user: string): Promise<string> {
    return withRetry(async () => {
      const resp = await fetch(ZHIPU_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          response_format: { type: "json_object" },
        }),
      });
      if (!resp.ok) {
        const body = await resp.text();
        throw makeHttpError("Zhipu", resp.status, body);
      }
      const data = (await resp.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return data.choices?.[0]?.message?.content || "";
    });
  }
}

export class CustomProvider implements LLMProvider {
  readonly name: string;
  private readonly fn: (system: string, user: string) => Promise<string>;

  constructor(
    fn: (system: string, user: string) => Promise<string>,
    name = "custom",
  ) {
    this.fn = fn;
    this.name = name;
  }

  chat(system: string, user: string): Promise<string> {
    return this.fn(system, user);
  }
}

export function makeProvider(config: LLMConfig): LLMProvider {
  switch (config.provider) {
    case "anthropic":
      return new AnthropicProvider(config.apiKey, config.model);
    case "openai":
      return new OpenAIProvider(config.apiKey, config.model);
    case "zhipu":
      return new ZhipuProvider(config.apiKey, config.model);
    case "custom":
      return new CustomProvider(config.chat, config.name);
    default: {
      const _exhaustive: never = config;
      void _exhaustive;
      throw new Error("[mnemos] 未知 LLM provider");
    }
  }
}

// ============================================================================
// 重试 + 错误工具
// ============================================================================

function makeHttpError(provider: string, status: number, body: string): Error {
  const err = new Error(`[mnemos] ${provider} HTTP ${status}: ${body.slice(0, 240)}`);
  // 标记可重试：5xx / 429 网络抖动可重试；4xx 业务错误不重试
  (err as { retryable?: boolean }).retryable = status >= 500 || status === 429;
  return err;
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (e: unknown) {
      lastErr = e;
      const retryable =
        e instanceof Error && (e as { retryable?: boolean }).retryable !== false;
      if (!retryable || attempt === MAX_RETRIES - 1) break;
      const backoff = BASE_BACKOFF_MS * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("[mnemos] LLM call failed after retries");
}
