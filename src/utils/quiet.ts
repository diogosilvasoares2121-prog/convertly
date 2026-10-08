/**
 * Some third-party decoders (UTIF, libheif) report warnings with console.log.
 * These helpers mute console.log only for the duration of the call so production
 * builds keep a clean console.
 */
/* eslint-disable no-console */
export function quietSync<T>(fn: () => T): T {
  const log = console.log;
  console.log = () => {};
  try {
    return fn();
  } finally {
    console.log = log;
  }
}

export async function quietAsync<T>(fn: () => Promise<T>): Promise<T> {
  const log = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = log;
  }
}
/* eslint-enable no-console */
