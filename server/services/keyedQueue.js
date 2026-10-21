/**
 * Runs async tasks one at a time per key, in the order they were queued, while
 * tasks for different keys run concurrently. `atomicTeamUpdate` queues each
 * team's writes here: a burst of writers on one team (a whole retro voting at
 * once) then waits its turn on this pod instead of racing for the record, and
 * holds one database connection rather than one per writer.
 *
 * Each caller gets its own task's result or failure; a failure never reaches
 * the tasks queued behind it. A key is forgotten once its last task settles, so
 * the map holds only the teams being written right now.
 */
const createKeyedQueue = () => {
  const tails = new Map();

  const run = (key, task) => {
    const previous = tails.get(key) ?? Promise.resolve();
    const result = previous.then(() => task());
    // The tail never rejects: what failed belongs to its own caller.
    const tail = result.then(() => undefined, () => undefined);
    tails.set(key, tail);
    tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return result;
  };

  return { run, size: () => tails.size };
};

export { createKeyedQueue };
