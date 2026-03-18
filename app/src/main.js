import { createEditorShell } from "./editor/ui-shell.js";
import { bootstrapProjectSession } from "./session/project-session.js";

const root = document.getElementById("app");

if (!root) {
  throw new Error("Missing #app mount node");
}

void bootstrapProjectSession()
  .then(({ userId, projectId, activeRevision }) => {
    console.log("Frontend bootstrap ready:", { userId, projectId, activeRevision });
    createEditorShell(root, {
      initialPlan: activeRevision.plan_json,
      backendProjectId: projectId
    });
  })
  .catch((error) => {
    console.error("Failed to bootstrap frontend session.", error);
    createEditorShell(root);
  });
