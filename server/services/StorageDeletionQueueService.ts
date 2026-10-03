import { dbPool } from "../db/pool.ts";
import { supabaseAdmin } from "../supabase/client.ts";
import { reportFailure } from "../config/reportFailure.ts";

type PendingObject = {
  id: string;
  bucket: string;
  object_path: string;
};

let draining = false;

/**
 * Remove objetos somente pela Storage API e conclui a fila transacional criada
 * quando um rascunho é apagado. A rotina é idempotente e segura para cold starts.
 */
export async function drainStorageDeletionQueue(limit = 200) {
  if (draining || !dbPool || !supabaseAdmin) return { processed: 0, failed: 0 };
  draining = true;
  try {
    const pending = await dbPool.query<PendingObject>(
      `SELECT id,bucket,object_path
         FROM public.app_storage_deletion_queue
        WHERE completed_at IS NULL
        ORDER BY requested_at,id
        LIMIT $1`,
      [limit],
    );
    let processed = 0;
    let failed = 0;

    const buckets = new Map<string,PendingObject[]>();
    for (const row of pending.rows) {
      const group = buckets.get(row.bucket) ?? [];
      group.push(row);
      buckets.set(row.bucket,group);
    }

    for (const [bucket,rows] of buckets) {
      const paths = rows.map((row) => row.object_path);
      const { error } = await supabaseAdmin.storage.from(bucket).remove(paths);
      if (error) {
        failed += rows.length;
        await dbPool.query(
          `UPDATE public.app_storage_deletion_queue
              SET last_error=$2
            WHERE id=ANY($1::uuid[]) AND completed_at IS NULL`,
          [rows.map((row) => row.id),String(error.message ?? "STORAGE_DELETE_FAILED").slice(0,1000)],
        );
        continue;
      }
      processed += rows.length;
      await dbPool.query(
        `UPDATE public.app_storage_deletion_queue
            SET completed_at=clock_timestamp(),last_error=NULL
          WHERE id=ANY($1::uuid[])`,
        [rows.map((row) => row.id)],
      );
    }
    return { processed, failed };
  } catch (error) {
    reportFailure("storage_deletion_queue_failed","storage-maintenance");
    return { processed: 0, failed: 1 };
  } finally {
    draining = false;
  }
}
