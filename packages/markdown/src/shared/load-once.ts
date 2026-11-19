/**
 * `load`, run once and its result shared, unless it fails: a failed load
 * (a chunk that did not arrive, a dropped connection) is forgotten, so the
 * next caller tries again instead of failing for the rest of the session.
 */
export function loadOnceUnlessFailed<T>(
  load: () => Promise<T>,
): () => Promise<T> {
  let loading: Promise<T> | undefined;
  return () => {
    if (!loading) {
      const attempt = load();
      loading = attempt;
      attempt.catch(() => {
        if (loading === attempt) {
          loading = undefined;
        }
      });
    }
    return loading;
  };
}
