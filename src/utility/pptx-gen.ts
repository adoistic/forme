// Electron utility process for PPTX generation.
// Per eng-plan §1 + outside-voice finding 2: pptxgenjs is CPU-intensive so we
// isolate it from the renderer thread. The renderer sends a layout object via
// IPC; this utility process generates the ArrayBuffer and ships it back to
// main for atomic disk write.
//
// Phase 0: minimal entry that handles the "ping" message for smoke testing.
// Phase 2 will add the real buildIssue(layout) pipeline.

import { parentPort } from "node:worker_threads";

// When spawned as an Electron utility process, the parent communicates via
// UtilityProcess.postMessage; in worker_threads mode (when bundled as a
// Node worker) we use parentPort. Both API shapes are handled.

type UtilityMessage = { type: "ping"; id: string } | { type: "shutdown" };

function handle(message: UtilityMessage): void {
  if (message.type === "ping") {
    postToParent({ type: "pong", id: message.id, t: Date.now() });
  } else if (message.type === "shutdown") {
    process.exit(0);
  }
}

function postToParent(msg: Record<string, unknown>): void {
  if (parentPort) {
    parentPort.postMessage(msg);
    return;
  }
  if (typeof process.parentPort === "object" && process.parentPort !== null) {
    (process.parentPort as { postMessage: (m: unknown) => void }).postMessage(msg);
    return;
  }
  // Fallback: print to stdout for debugging
  // eslint-disable-next-line no-console
  console.log("[pptx-gen]", JSON.stringify(msg));
}

if (parentPort) {
  parentPort.on("message", (raw) => handle(raw as UtilityMessage));
} else if (typeof process.parentPort === "object" && process.parentPort !== null) {
  (process.parentPort as { on: (e: string, cb: (m: unknown) => void) => void }).on(
    "message",
    (raw) => handle(raw as UtilityMessage)
  );
}
