// Mermaid configuration is module-global, including across plugin stop/start.
// Keep the entire asynchronous render transaction under one shared owner.
let tail: Promise<void> = Promise.resolve();
let currentOwner: symbol | undefined;
let currentKey = "";

export function mermaidTransaction<T>(
  owner: symbol,
  key: string,
  operation: (initialize: boolean) => Promise<T>,
): Promise<T> {
  const transaction = tail.then(async () => {
    try {
      const value = await operation(
        currentOwner !== owner || currentKey !== key,
      );
      currentOwner = owner;
      currentKey = key;
      return value;
    } catch (error) {
      // A failed initializer or renderer must not leave a reusable assumption.
      currentOwner = undefined;
      currentKey = "";
      throw error;
    }
  });
  // Rejections reach their caller, but must not poison subsequent render jobs.
  tail = transaction.then(
    () => {},
    () => {},
  );
  return transaction;
}
