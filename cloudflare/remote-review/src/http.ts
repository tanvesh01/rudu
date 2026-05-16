export function jsonResponse(body: unknown, init?: ResponseInit) {
  return Response.json(body, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });
}

export function errorResponse(message: string, status: number) {
  return jsonResponse({ error: message }, { status });
}

export function readBearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) {
    return null;
  }

  return header.slice(prefix.length);
}

export async function readJson<T>(request: Request): Promise<T> {
  return (await request.json().catch(() => ({}))) as T;
}
