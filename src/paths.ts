/**
 * Project path constants — resolves paths relative to the project root.
 *
 * Uses import.meta.url (not process.cwd()) so paths are correct
 * regardless of the CWD when the server is started.
 */

import { join, dirname } from "path";

// This file is at src/paths.ts, so project root is one level up.
export const PROJECT_ROOT = join(dirname(decodeURIComponent(import.meta.url.replace("file://", ""))), "..");

export const DATA_DIR = join(PROJECT_ROOT, "data");
export const CONFIG_DIR = join(PROJECT_ROOT, "config");
export const PLUGINS_DIR = join(PROJECT_ROOT, "plugins");
export const SKILLS_DIR = join(PROJECT_ROOT, "skills");
export const FRONTEND_DIST = join(PROJECT_ROOT, "frontend", "dist");
