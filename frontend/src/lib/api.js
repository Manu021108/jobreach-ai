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

// Auto-extract CSRF token from cookies and add to headers for state-changing requests
export function setCSRFToken() {
  if (typeof document === "undefined") return;
  const cookies = document.cookie.split(";");
  for (const cookie of cookies) {
    const trimmed = cookie.trim();
    if (trimmed.startsWith("jr_csrf=")) {
      const token = trimmed.split("=")[1];
      // Add token to upcoming requests via a global hook
      const originalFetch = window.fetch;
      window.fetch = function(input, init) {
        if (init && init.method && !["GET", "HEAD", "OPTIONS"].includes(init.method)) {
          init.headers = {
            ...init.headers,
            "X-CSRF-Token": token,
          };
        }
        return originalFetch(input, init);
      };
      // Remove hook after first use
      delete window._jr_csrf_token;
      break;
    }
  }
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
