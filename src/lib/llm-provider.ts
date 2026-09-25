/** Model adapters. Provider selection does not replace school data/content review.
 * Keys are read from environment variables, never included in teaching records.
 */

import { MODEL_REQUEST_TIMEOUT_MS, modelTimeout } from './diagnosis-policy';

export type ProviderName = 'qianfan' | 'spark' | 'glm';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatResult {
  content: string;
  provider: ProviderName;
  model: string;
}

interface ProviderConfig {
  name: ProviderName;
  /** 对外可读的中文名，用于界面与留痕。 */
  label: string;
  base_url: string;
  /** 主密钥环境变量；后面几项作为本机已有密钥的兼容别名。 */
  api_key_envs: readonly string[];
  model_env: string;
  default_model: string;
}

const PROVIDER_CONFIGS: Record<ProviderName, ProviderConfig> = {
  qianfan: {
    name: 'qianfan',
    label: '文心一言（百度千帆）',
    base_url: 'https://qianfan.baidubce.com/v2',
    api_key_envs: ['QIANFAN_API_KEY'],
    model_env: 'QIANFAN_MODEL',
    default_model: 'ernie-4.5-turbo-128k',
  },
  spark: {
    name: 'spark',
    label: '讯飞星火',
    base_url: 'https://spark-api-open.xf-yun.com/v1',
    api_key_envs: ['SPARK_API_KEY'],
    model_env: 'SPARK_MODEL',
    default_model: 'generalv3.5',
  },
  glm: {
    name: 'glm',
    label: '智谱 GLM',
    base_url: 'https://open.bigmodel.cn/api/paas/v4',
    api_key_envs: ['GLM_API_KEY', 'ZHIPU_API_KEY', 'ZHIPU_API_KEY_V2', 'ZHIPUAI_API_KEY'],
    model_env: 'GLM_MODEL',
    default_model: 'glm-4.5-flash',
  },
};

const PROVIDER_PRIORITY: readonly ProviderName[] = ['qianfan', 'spark', 'glm'];

/**
 * 取提供方实际请求地址。GLM 允许用 GLM_BASE_URL 覆盖，便于对照标准端点与
 * Coding Plan 端点，但默认必须是标准 PaaS，不能静默切到编码套餐地址。
 *
 * @param config 提供方配置
 * @returns 不含尾斜杠的 base URL
 */
function resolveBaseUrl(config: ProviderConfig): string {
  if (config.name === 'glm') {
    const override = process.env.GLM_BASE_URL?.trim();
    if (override) return override.replace(/\/$/, '');
  }
  return config.base_url;
}

/**
 * 按别名列表取第一个非空密钥。
 *
 * @param config 提供方配置
 * @returns 密钥，全部未配置时返回空串
 */
function resolveApiKey(config: ProviderConfig): string {
  for (const env_name of config.api_key_envs) {
    const value = process.env[env_name]?.trim();
    if (value) return value;
  }
  return '';
}

// Leave time for validation and durable manual fallback before the HTTP deadline.

export class LlmConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmConfigError';
  }
}

export class LlmRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmRequestError';
  }
}

/**
 * 读取当前配置的主用模型提供方。
 *
 * 显式设置 LLM_PROVIDER 时按设置走。未设置时按申报书优先序挑第一个已配密钥
 * 的提供方：千帆 → 星火 → GLM。开发机上往往只有 GLM 密钥，这时会落到 GLM，
 * 方便先把闭环跑通；课堂材料仍应切回千帆或星火。
 *
 * @returns 提供方名称
 */
export function resolveProviderName(): ProviderName {
  const configured = process.env.LLM_PROVIDER?.trim().toLowerCase();
  if (configured === 'spark' || configured === 'qianfan' || configured === 'glm') {
    return configured;
  }
  const first_ready = PROVIDER_PRIORITY.find((name) => Boolean(resolveApiKey(PROVIDER_CONFIGS[name])));
  return first_ready ?? 'qianfan';
}

/**
 * 取提供方的中文名，用于界面展示与诊疗留痕。
 *
 * @param provider_name 提供方名称
 * @returns 中文名
 */
export function getProviderLabel(provider_name: string): string {
  if (provider_name === 'qianfan' || provider_name === 'spark' || provider_name === 'glm') {
    return PROVIDER_CONFIGS[provider_name].label;
  }
  return provider_name;
}

/**
 * 列出已配置密钥、当前可用的提供方。
 *
 * @returns 可用提供方名称
 */
export function listConfiguredProviders(): ProviderName[] {
  return PROVIDER_PRIORITY.filter((name) => Boolean(resolveApiKey(PROVIDER_CONFIGS[name])));
}

/**
 * 调用大模型完成一次对话。
 *
 * 两家接口均为 OpenAI 兼容形状，差异只在 base_url、鉴权值与 model 取值。
 * temperature 压低是为了让排查线索稳定复现，便于教师复核与课堂演示。
 *
 * @param messages 对话消息，第一条通常是带【知识约束】的 system 提示
 * @param options.provider 指定提供方；省略时用环境变量配置的主用方
 * @param options.temperature 采样温度，默认 0.2
 * @returns 模型返回的文本与实际使用的提供方、模型名
 * @throws LlmConfigError 未配置对应密钥
 * @throws LlmRequestError 接口返回非 2xx 或响应结构异常
 *
 * @example
 * const result = await chatComplete([
 *   { role: 'system', content: '你是虚拟工程师……' },
 *   { role: 'user', content: '定时器中断进不去' },
 * ]);
 */
export async function chatComplete(
  messages: readonly ChatMessage[],
  options: { provider?: ProviderName; temperature?: number; deadlineAt?: number } = {},
): Promise<ChatResult> {
  const timeoutMs=modelTimeout(options.deadlineAt ?? Date.now()+MODEL_REQUEST_TIMEOUT_MS);
  if(timeoutMs<=0)throw new LlmRequestError('诊疗生成已达到总时限，转教师人工处理');
  const provider_name = options.provider ?? resolveProviderName();
  const config = PROVIDER_CONFIGS[provider_name];

  const api_key = resolveApiKey(config);
  if (!api_key) {
    throw new LlmConfigError(
      `未配置 ${config.label} 的密钥，请在 .env.local 设置 ${config.api_key_envs[0]}`,
    );
  }

  const model_name = process.env[config.model_env]?.trim() || config.default_model;
  const abort_controller = new AbortController();
  const timeout_handle = setTimeout(() => abort_controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${resolveBaseUrl(config)}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${api_key}`,
      },
      body: JSON.stringify(buildRequestBody(provider_name, model_name, messages, options.temperature)),
      signal: abort_controller.signal,
    });

    if (!response.ok) {
      const error_body = await response.text().catch(() => '');
      throw new LlmRequestError(
        `${config.label} 返回 ${response.status}：${error_body.slice(0, 300)}`,
      );
    }

    const payload = (await response.json()) as {
      choices?: { message?: { content?: unknown; reasoning_content?: unknown } }[];
    };
    const content = extractMessageText(payload.choices?.[0]?.message);
    if (!content) {
      throw new LlmRequestError(`${config.label} 返回内容为空`);
    }

    return { content, provider: provider_name, model: model_name };
  } catch (error) {
    if (error instanceof LlmConfigError || error instanceof LlmRequestError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new LlmRequestError(`${config.label} 请求超时（${timeoutMs / 1000}s）`);
    }
    throw new LlmRequestError(`${config.label} 请求失败：${(error as Error).message}`);
  } finally {
    clearTimeout(timeout_handle);
  }
}

/**
 * 组装 OpenAI 兼容请求体。GLM 额外关掉思考链，缩短延迟、少耗额度。
 *
 * @param provider_name 提供方
 * @param model_name 模型名
 * @param messages 对话消息
 * @param temperature 采样温度
 * @returns 可 JSON 序列化的请求体
 */
function buildRequestBody(
  provider_name: ProviderName,
  model_name: string,
  messages: readonly ChatMessage[],
  temperature: number | undefined,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: model_name,
    messages,
    temperature: temperature ?? 0.2,
    stream: false,
  };
  if (provider_name === 'glm') {
    body.max_tokens = 2048;
    body.thinking = { type: 'disabled' };
  }
  return body;
}

/**
 * 从 OpenAI 兼容的 message 里抽出文本。
 *
 * 只读取正式 content；思考内容不作为正文或教师初稿。
 *
 * @param message 模型返回的 message 字段
 * @returns 去空白后的正文，取不到则空串
 */
function extractMessageText(
  message: { content?: unknown; reasoning_content?: unknown } | undefined,
): string {
  if (!message) return '';
  const from_content = flattenContent(message.content);
  if (from_content) return from_content;
  return ''; // Never repurpose private reasoning as a teaching response.
}

/**
 * 把 content 字段收成一段纯文本。
 *
 * @param value 字符串、片段数组或其他
 * @returns 去空白后的文本
 */
function flattenContent(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part) {
          return String((part as { text?: unknown }).text ?? '');
        }
        return '';
      })
      .join('')
      .trim();
  }
  return '';
}
