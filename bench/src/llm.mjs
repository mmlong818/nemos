import './proxy-boot.mjs';
import OpenAI from 'openai';
import { HttpsProxyAgent } from 'https-proxy-agent';

const key = process.env.OPENAI_API_KEY;
if (!key) throw new Error('OPENAI_API_KEY not set');

const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
export const client = new OpenAI({ apiKey: key, httpAgent: proxy ? new HttpsProxyAgent(proxy) : undefined });
export const GEN_MODEL = process.env.MNEMO_GEN_MODEL || 'gpt-4o';
export const JUDGE_MODEL = process.env.MNEMO_JUDGE_MODEL || 'gpt-4o';

export async function chatJSON(model, system, user, temperature = 0) {
  const resp = await client.chat.completions.create({
    model,
    temperature,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });
  return JSON.parse(resp.choices[0].message.content);
}
