export async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    credentials: "include",
    ...options,
  });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await response.json().catch(() => ({}))
    : await response.text().catch(() => "");
  if (!response.ok) {
    const detail = typeof data === "object" && data ? data.detail : data;
    throw new Error(detail || `Request failed (${response.status})`);
  }
  return data;
}

export function jsonRequest(method, body) {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export function post(path, body) {
  return api(path, jsonRequest("POST", body));
}

export function put(path, body) {
  return api(path, jsonRequest("PUT", body));
}

export function remove(path) {
  return api(path, { method: "DELETE" });
}
