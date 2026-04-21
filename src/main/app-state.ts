import path from "node:path";
import fs from "node:fs/promises";
import { app } from "electron";
import type { Kysely } from "kysely";
import { createDb } from "./sqlite/db.js";
import { createBlobStore, type BlobStore } from "./blob-store/store.js";
import { createSnapshotStore, type SnapshotStore } from "./snapshot-store/store.js";
import { loadTemplatesFromDir } from "./templates/loader.js";
import type { Database } from "./sqlite/schema.js";
import type { Template } from "@shared/schemas/template.js";
import { createLogger } from "./logger.js";

// App-state singleton: the handles main-process IPC handlers share.
// Initialized on app.whenReady via bootstrap().

const logger = createLogger("app-state");

interface AppState {
  db: Kysely<Database>;
  blobs: BlobStore;
  snapshots: SnapshotStore;
  templates: Template[];
  dataDir: string;
  exportDir: string;
}

let state: AppState | null = null;

export async function bootstrap(): Promise<AppState> {
  if (state) return state;

  const dataDir = app.getPath("userData");
  const dbPath = path.join(dataDir, "forme.sqlite");
  await fs.mkdir(dataDir, { recursive: true });

  logger.info({ dbPath }, "Bootstrapping app state");

  const db = await createDb({ filename: dbPath });
  const blobs = createBlobStore({ rootDir: dataDir });
  const snapshots = createSnapshotStore(db);

  // Load templates bundled with the app. In dev, they live at the repo root;
  // in production, electron-builder copies them into resources.
  const templatesDir = await resolveTemplatesDir();
  const templates = await loadTemplatesFromDir(templatesDir);
  logger.info({ count: templates.length, dir: templatesDir }, "Templates loaded");

  // Export dir — normally ~/Documents/Forme. Tests can override via
  // FORME_TEST_DOCUMENTS_DIR so we never stomp on real user files.
  const docsRoot =
    process.env.FORME_TEST_DOCUMENTS_DIR ?? app.getPath("documents");
  const exportDir = path.join(docsRoot, "Forme");
  await fs.mkdir(exportDir, { recursive: true });

  state = { db, blobs, snapshots, templates, dataDir, exportDir };
  return state;
}

export function getState(): AppState {
  if (!state) throw new Error("app-state not bootstrapped — call bootstrap() first");
  return state;
}

async function resolveTemplatesDir(): Promise<string> {
  // Dev: running from the repo
  const repoPath = path.resolve(process.cwd(), "templates");
  try {
    await fs.access(repoPath);
    return repoPath;
  } catch {
    // fall through to packaged location
  }
  const resourcesPath = path.join(process.resourcesPath ?? "", "templates");
  return resourcesPath;
}
