const DEFAULT_API_BASE_URL = "/api";

export async function listUsers(options = {}) {
  return requestJson("/users/", {
    ...options,
    method: "GET"
  });
}

export async function createUser(payload = {}, options = {}) {
  return requestJson("/users/", {
    ...options,
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function listProjects({ userId } = {}, options = {}) {
  const searchParams = new URLSearchParams();
  if (userId) {
    searchParams.set("user", userId);
  }
  const query = searchParams.toString();
  const suffix = query ? `/projects/?${query}` : "/projects/";
  return requestJson(suffix, {
    ...options,
    method: "GET"
  });
}

export async function createProject(payload, options = {}) {
  return requestJson("/projects/", {
    ...options,
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function getProject(projectId, options = {}) {
  return requestJson(`/projects/${encodeURIComponent(projectId)}/`, {
    ...options,
    method: "GET"
  });
}

export async function getActiveRevision(projectId, options = {}) {
  return requestJson(`/projects/${encodeURIComponent(projectId)}/active-revision/`, {
    ...options,
    method: "GET"
  });
}

export async function updateActiveRevision(projectId, payload, options = {}) {
  return requestJson(`/projects/${encodeURIComponent(projectId)}/active-revision/`, {
    ...options,
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

async function requestJson(path, options = {}) {
  const baseUrl = options.baseUrl ?? DEFAULT_API_BASE_URL;
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(options.headers ?? {})
    },
    ...options
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API request failed (${response.status}): ${errorText || response.statusText}`);
  }

  return response.json();
}
