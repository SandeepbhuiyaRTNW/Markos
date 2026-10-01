/** Retain successful context reads when a sibling fails. No retry or extra request. */
export async function readContextOr<T>(
  read: Promise<T>, fallback: T, onError: (error: unknown) => void,
): Promise<T> {
  try { return await read; }
  catch (error) { onError(error); return fallback; }
}
