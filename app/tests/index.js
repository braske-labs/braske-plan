import { runRegisteredTests } from "./test-runner.js";

import "./specs/snapping.test.js";
import "./specs/plan-reducer.test.js";
import "./specs/coordinates.test.js";
import "./specs/scale.test.js";
import "./specs/validation.test.js";
import "./specs/wall-shell.test.js";
import "./specs/room-wall-topology.test.js";
import "./specs/room-merge.test.js";
import "./specs/baseboards.test.js";
import "./specs/baseboard-snapshot.test.js";

const summaryElement = document.querySelector("#summary");
const resultsElement = document.querySelector("#results");

runRegisteredTests({
  summaryElement,
  resultsElement
});
