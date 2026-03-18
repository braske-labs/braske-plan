import {
  createProject,
  createUser,
  getActiveRevision,
  getProject,
  listProjects,
  listUsers
} from "../api/planner-api.js";

const USER_ID_STORAGE_KEY = "braske.userId";
const PROJECT_ID_STORAGE_KEY = "braske.projectId";

export async function bootstrapProjectSession() {
  const userId = await getOrCreateUserId();
  const projectId = await getOrCreateProjectId(userId);
  const activeRevision = await getActiveRevision(projectId);
  return { userId, projectId, activeRevision };
}

async function getOrCreateUserId() {
  const storage = getLocalStorage();
  const storedUserId = storage?.getItem(USER_ID_STORAGE_KEY) ?? null;
  if (storedUserId) {
    const users = await listUsers();
    const matchingUser = users.find((user) => user.id === storedUserId);
    if (matchingUser) {
      return matchingUser.id;
    }
  }

  const createdUser = await createUser({});
  storage?.setItem(USER_ID_STORAGE_KEY, createdUser.id);
  return createdUser.id;
}

async function getOrCreateProjectId(userId) {
  const storage = getLocalStorage();
  const storedProjectId = storage?.getItem(PROJECT_ID_STORAGE_KEY) ?? null;
  if (storedProjectId) {
    try {
      const project = await getProject(storedProjectId);
      if (project?.user === userId) {
        return project.id;
      }
    } catch (_error) {
      // Ignore missing or stale stored project ids and continue with fallback bootstrap.
    }
  }

  const projects = await listProjects({ userId });
  const latestProject = projects.at(-1) ?? null;
  if (latestProject) {
    storage?.setItem(PROJECT_ID_STORAGE_KEY, latestProject.id);
    return latestProject.id;
  }

  const createdProject = await createProject({
    user: userId,
    name: "Untitled project"
  });
  storage?.setItem(PROJECT_ID_STORAGE_KEY, createdProject.id);
  return createdProject.id;
}

function getLocalStorage() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch (_error) {
    return null;
  }
}
