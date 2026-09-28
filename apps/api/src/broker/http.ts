import { classifyHttpFailure, classifyNetworkFailure } from './broker.errors';

export interface HttpResponse {
  status: number;
  text: string;
  json<T = unknown>(): T;
}

/** fetch with a hard timeout; network errors and non-2xx are turned into BrokerError. */
export async function httpJson(
  url: string,
  init: RequestInit & { timeoutMs?: number; allowStatuses?: number[] } = {},
): Promise<HttpResponse> {
  const { timeoutMs = 10_000, allowStatuses = [], ...rest } = init;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, { ...rest, signal: ac.signal });
  } catch (err) {
    throw classifyNetworkFailure(err);
  } finally {
    clearTimeout(t);
  }
  const text = await res.text();
  if (!res.ok && !allowStatuses.includes(res.status)) throw classifyHttpFailure(res.status, text);
  return {
    status: res.status,
    text,
    json: <T>() => (text ? (JSON.parse(text) as T) : (undefined as T)),
  };
}
