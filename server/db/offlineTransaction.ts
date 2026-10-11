import { AsyncLocalStorage } from "node:async_hooks";
import type { Pool, PoolClient } from "pg";

const transactions = new AsyncLocalStorage<PoolClient>();
let sequence = 0;
export const offlineTransactionClient = () => transactions.getStore();
export const withOfflineTransaction = <T>(client: PoolClient, run: () => T) =>
  transactions.run(client, run);

/** Domain transactions become savepoints only within an offline receipt.
 * Ordinary requests retain the original pool and transaction semantics. */
function borrowedClient(client: PoolClient): PoolClient {
  const stack: string[] = [];
  return new Proxy(client, {
    get(target, property) {
      if (property === "release") return () => {};
      if (property === "query")
        return async (query: unknown, ...args: unknown[]) => {
          const sql = typeof query === "string" ? query.trim() : "";
          if (/^(?:BEGIN|START TRANSACTION)(?:\s|;|$)/i.test(sql)) {
            const name = `hvm_offline_${++sequence}`;
            stack.push(name);
            return target.query(`SAVEPOINT ${name}`);
          }
          if (/^(?:COMMIT|END)\s*;?$/i.test(sql)) {
            const name = stack.pop();
            if (!name) throw Error("OFFLINE_TRANSACTION_UNBALANCED");
            return target.query(`RELEASE SAVEPOINT ${name}`);
          }
          if (/^ROLLBACK\s*;?$/i.test(sql)) {
            const name = stack.pop();
            if (!name) throw Error("OFFLINE_TRANSACTION_UNBALANCED");
            await target.query(`ROLLBACK TO SAVEPOINT ${name}`);
            return target.query(`RELEASE SAVEPOINT ${name}`);
          }
          return Reflect.apply(target.query, target, [query, ...args]);
        };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
export function scopedDatabasePool(pool: Pool): Pool {
  return new Proxy(pool, {
    get(target, property) {
      if (property === "connect")
        return (...args: unknown[]) => {
          const client = transactions.getStore();
          return client
            ? Promise.resolve(borrowedClient(client))
            : Reflect.apply(target.connect, target, args);
        };
      if (property === "query")
        return (...args: unknown[]) => {
          const client = transactions.getStore();
          return Reflect.apply(
            client?.query ?? target.query,
            client ?? target,
            args,
          );
        };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
