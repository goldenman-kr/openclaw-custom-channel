export function pendingJobStoragePrefix({ storageKey, apiUrl, apiKey, authUserId }) {
  return `${storageKey}:${apiUrl}:${authUserId || apiKey || 'anonymous'}:`;
}

export function pendingJobStorageKey(scope, conversationId) {
  return `${pendingJobStoragePrefix(scope)}${conversationId || 'no-conversation'}`;
}

export function loadPendingJobFromStorage(storage, key) {
  try {
    const parsed = JSON.parse(storage.getItem(key) || 'null');
    return parsed?.job_id ? parsed : null;
  } catch {
    return null;
  }
}

export function pendingJobKeys(storage, prefix) {
  const keys = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(prefix)) {
      keys.push(key);
    }
  }
  return keys;
}

export async function prunePendingJobStorage({ storage, prefix, conversationIds = new Set(), fetchJob, isTerminalJobState }) {
  const keys = pendingJobKeys(storage, prefix);

  for (const key of keys) {
    const conversationId = key.slice(prefix.length);
    let pendingJob = null;
    try {
      pendingJob = JSON.parse(storage.getItem(key) || 'null');
    } catch {
      storage.removeItem(key);
      continue;
    }
    if (!conversationId || !pendingJob?.job_id || (conversationIds.size > 0 && !conversationIds.has(conversationId))) {
      storage.removeItem(key);
      continue;
    }
    try {
      const job = await fetchJob(pendingJob.job_id, conversationId);
      if (isTerminalJobState(job.state)) {
        storage.removeItem(key);
      }
    } catch (error) {
      if (error?.status === 404) {
        storage.removeItem(key);
      }
    }
  }
}
