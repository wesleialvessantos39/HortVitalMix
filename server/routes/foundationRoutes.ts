import manifest from "../../supabase/manifest.json" with { type: "json" };
import { Router } from "express";
import { dbPool } from "../db/pool.ts";
import { supabasePublic } from "../supabase/client.ts";
import { runtime } from "../config/runtime.ts";
import { reportFailure } from "../config/reportFailure.ts";
import {
  FOUNDATION_SCHEMA_VERSION,
  GlobalConfigPublicSchema,
} from "../../shared/contracts/foundation.ts";
export const foundationRouter = Router();
foundationRouter.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    time: new Date().toISOString(),
    environment: runtime.appEnv,
    requestId: res.locals.requestId,
  });
});
foundationRouter.get("/ready", async (_req, res) => {
  const payload = {
    status: "unavailable",
    databaseConnected: false,
    schemaVersion: 0,
    releaseTag: "",
    requestId: res.locals.requestId,
  };
  if (!dbPool) {
    res.status(503).json({ ...payload, reason: runtime.dbRejection });
    return;
  }
  try {
    const result = await dbPool.query(
      "SELECT schema_version,release_tag,commit_sha,migration_history_hash FROM public.app_releases WHERE environment=$1 AND is_current=true",
      [runtime.appEnv],
    );
    const row = result.rows[0];
    if (!row) {
      res
        .status(503)
        .json({
          ...payload,
          status: "degraded",
          databaseConnected: true,
          reason: "RELEASE_NOT_CONFIGURED",
        });
      return;
    }
    const matches =
      row.schema_version === FOUNDATION_SCHEMA_VERSION &&
      row.migration_history_hash === manifest.migrationHistoryHash &&
      ((runtime.appEnv === "development" && !runtime.commitSha) ||
        row.commit_sha === runtime.commitSha);
    res
      .status(matches ? 200 : 503)
      .json({
        ...payload,
        status: matches ? "ready" : "degraded",
        databaseConnected: true,
        schemaVersion: row.schema_version,
        releaseTag: row.release_tag,
        ...(!matches ? { reason: "RELEASE_MISMATCH" } : {}),
      });
  } catch {
    reportFailure("db_unavailable", res.locals.requestId);
    res.status(503).json({ ...payload, reason: "DB_UNAVAILABLE" });
  }
});
foundationRouter.get("/v1/config", async (_req, res) => {
  if (!supabasePublic) {
    res.status(503).json({
      error: "SUPABASE_CONFIG_UNAVAILABLE",
      requestId: res.locals.requestId,
    });
    return;
  }

  try {
    const { data, error } = await supabasePublic
      .from("app_global_config")
      .select(
        "platform_name,slogan,default_municipality,default_state,currency,timezone,support_email,support_phone,revision",
      )
      .eq("singleton_guard", true)
      .maybeSingle();

    if (error) {
      reportFailure({
        category: "config_data_api_failed",
        requestId: res.locals.requestId,
        detail: error.code ?? "unknown",
      });
      res.status(503).json({
        error: "CONFIG_DATA_API_UNAVAILABLE",
        requestId: res.locals.requestId,
      });
      return;
    }

    if (!data) {
      res.status(503).json({
        error: "CONFIG_NOT_INITIALIZED",
        requestId: res.locals.requestId,
      });
      return;
    }

    res.json(
      GlobalConfigPublicSchema.parse({
        platformName: data.platform_name,
        slogan: data.slogan,
        defaultMunicipality: data.default_municipality,
        defaultState: data.default_state,
        currency: data.currency,
        timezone: data.timezone,
        supportEmail: data.support_email,
        supportPhone: data.support_phone,
        revision: data.revision,
      }),
    );
  } catch (error) {
    reportFailure({
      category: "config_unavailable",
      requestId: res.locals.requestId,
      detail: (error as { name?: string })?.name ?? "unknown",
    });
    res.status(503).json({
      error: "CONFIG_UNAVAILABLE",
      requestId: res.locals.requestId,
    });
  }
});
