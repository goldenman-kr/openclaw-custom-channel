import { realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import type { WorkspaceScopeRecord } from "../session/AuthStore.js";

export type WorkspaceAccessMode = "read" | "write";

export function isWithinDir(candidatePath: string, rootPath: string): boolean {
  const relativePath = relative(rootPath, candidatePath);
  return relativePath === "" || (!!relativePath && !relativePath.startsWith("..") && !relativePath.startsWith(sep) && !isAbsoluteRelative(relativePath));
}

export async function resolveAllowedWorkspacePath(
  rawPath: string,
  scope: WorkspaceScopeRecord,
  mode: WorkspaceAccessMode,
): Promise<string | null> {
  const resolvedCandidate = await realpath(resolve(rawPath));
  const workspaceRoot = await realpath(resolve(scope.workspaceRoot));
  const userDir = await realpath(resolve(scope.userDir));
  const commonDir = await realpath(resolve(scope.commonDir));

  if (!isWithinDir(userDir, workspaceRoot) || !isWithinDir(commonDir, workspaceRoot)) {
    return null;
  }

  const readRoots = [userDir, commonDir];
  const writeRoots = [userDir, ...(scope.commonWritable ? [commonDir] : [])];
  const roots = mode === "write" ? writeRoots : readRoots;
  return roots.some((root) => isWithinDir(resolvedCandidate, root)) ? resolvedCandidate : null;
}

function isAbsoluteRelative(relativePath: string): boolean {
  return /^[a-zA-Z]:/.test(relativePath);
}
