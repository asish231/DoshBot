const TOKEN_KEY = 'opendots-token';
function readStored(): string {
  try {
    // Session-scoped unlock wins over a remembered one; both may exist if
    // the owner re-locked and chose not to remember this time.
    return (
      sessionStorage.getItem(TOKEN_KEY) ?? localStorage.getItem(TOKEN_KEY) ?? ''
    );
  } catch {
    /* storage unavailable (private mode) — stay locked until set */
    return '';
  }
}
let token = readStored();
export function setToken(value: string, remember = false) {
  token = value;
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_KEY);
    if (value)
      (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, value);
  } catch {
    /* storage unavailable — the token still lives in memory for this tab */
  }
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  // FormData (file uploads) is passed through untouched so the browser sets
  // the multipart boundary itself; anything else travels as JSON.
  const isFormData =
    typeof FormData !== 'undefined' && body instanceof FormData;
  const response = await fetch(`/api${path}`, {
    method,
    signal,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(isFormData
        ? {}
        : ['GET', 'HEAD'].includes(method)
          ? {}
          : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined
      ? {}
      : { body: isFormData ? (body as FormData) : JSON.stringify(body) }),
  });
  const data = (await response
    .json()
    .catch(() => ({ error: 'Server returned an unreadable response.' }))) as {
    error?: string;
  };
  if (!response.ok)
    throw new ApiError(
      data.error ?? `Request failed (${response.status}).`,
      response.status,
    );
  return data as T;
}
export function authHeaders(): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}
export function getToken(): string {
  return token;
}
