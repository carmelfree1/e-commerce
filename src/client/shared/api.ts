export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };

export async function api<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const data = (await r.json().catch(() => ({}))) as { error?: string };
  if (r.status === 401 && onUnauthorized) onUnauthorized();
  if (!r.ok) throw new ApiError(data.error || 'Erreur', r.status);
  return data as T;
}

export const send = <T = unknown>(url: string, body: unknown, method = 'POST'): Promise<T> =>
  api<T>(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
