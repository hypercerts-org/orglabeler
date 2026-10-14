const locks = new Map<string, Promise<void>>()

/** Runs one actor-DID mutation after earlier mutations for that DID finish. */
export async function withDidLock<T>(did: string, operation: () => Promise<T>): Promise<T> {
  const previous = locks.get(did) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => { release = resolve })
  const queued = previous.then(() => current)
  locks.set(did, queued)

  await previous
  try {
    return await operation()
  } finally {
    release()
    if (locks.get(did) === queued) locks.delete(did)
  }
}

/** Acquires multiple actor locks in stable order to avoid deadlocks. */
export async function withDidLocks<T>(dids: readonly string[], operation: () => Promise<T>): Promise<T> {
  const orderedDids = [...new Set(dids)].sort()

  const acquire = (index: number): Promise<T> => {
    if (index >= orderedDids.length) return operation()
    return withDidLock(orderedDids[index], () => acquire(index + 1))
  }

  return acquire(0)
}
