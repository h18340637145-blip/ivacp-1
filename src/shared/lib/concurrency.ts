/** 简单并发限制器：同一时刻最多运行 limit 个任务 */
export function createLimiter(limit: number) {
  const max = Math.max(1, Math.floor(limit) || 1);
  let active = 0;
  const queue: Array<() => void> = [];

  const next = () => {
    if (active >= max) return;
    const run = queue.shift();
    if (run) run();
  };

  return function schedule<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        active += 1;
        task()
          .then(resolve, reject)
          .finally(() => {
            active -= 1;
            next();
          });
      };
      queue.push(run);
      next();
    });
  };
}

export const CLIENT_CONCURRENCY = Math.max(1, Number(process.env.NEXT_PUBLIC_CONCURRENCY_LIMIT) || 3);

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
