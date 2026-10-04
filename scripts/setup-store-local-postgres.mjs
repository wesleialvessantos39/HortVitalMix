import pg from "pg";
import { readFileSync, readdirSync } from "node:fs";
// Run only against a fresh disposable local container; never resets data.
const value = process.env.HVM_T12_LOCAL_DATABASE_URL;
if (!value) throw new Error("HVM_T12_LOCAL_DATABASE_URL_REQUIRED");
const url = new URL(value);
if (
  url.hostname !== "127.0.0.1" ||
  url.port !== "55432" ||
  url.pathname !== "/postgres"
)
  throw new Error("T12_LOCAL_DATABASE_REQUIRED");
const pool = new pg.Pool({ connectionString: value });
try {
  const existing = await pool.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'app_%' LIMIT 1",
  );
  if (existing.rowCount) throw new Error("LOCAL_DATABASE_NOT_EMPTY");
  await pool.query(`
 DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
 END $$;
 CREATE SCHEMA IF NOT EXISTS extensions;
 CREATE SCHEMA IF NOT EXISTS auth;
 CREATE SCHEMA IF NOT EXISTS storage;
 CREATE SCHEMA IF NOT EXISTS supabase_migrations;
 CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations(version text PRIMARY KEY,name text);
 CREATE TABLE IF NOT EXISTS auth.users(id uuid PRIMARY KEY,email text,raw_app_meta_data jsonb DEFAULT '{}',raw_user_meta_data jsonb DEFAULT '{}',email_confirmed_at timestamptz,phone text,phone_confirmed_at timestamptz,deleted_at timestamptz,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),last_sign_in_at timestamptz);
 CREATE TABLE IF NOT EXISTS auth.sessions(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),not_after timestamptz,aal text);
 CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
 CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role',true),'') $$;
 CREATE TABLE IF NOT EXISTS storage.buckets(id text PRIMARY KEY,name text NOT NULL,public boolean DEFAULT false,file_size_limit bigint,allowed_mime_types text[],owner uuid,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
 CREATE TABLE IF NOT EXISTS storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text REFERENCES storage.buckets(id),name text NOT NULL,owner_id text,owner uuid,metadata jsonb DEFAULT '{}',created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
 ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
 CREATE OR REPLACE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array($1,'/') $$;
 GRANT USAGE ON SCHEMA public,auth,storage,extensions TO anon,authenticated,service_role;
 ALTER DATABASE postgres SET search_path=public,extensions,pg_catalog;
 `);
  const client = await pool.connect();
  try {
    await client.query("SET search_path=public,extensions,pg_catalog");
    const root = "supabase/migrations";
    for (const file of readdirSync(root)
      .filter((f) => f.endsWith(".sql"))
      .sort()) {
      const version = file.slice(0, 14),
        name = file.slice(15, -4);
      if (
        (
          await client.query(
            "SELECT 1 FROM supabase_migrations.schema_migrations WHERE version=$1",
            [version],
          )
        ).rowCount
      )
        continue;
      await client.query("BEGIN");
      try {
        await client.query(readFileSync(root + "/" + file, "utf8"));
        await client.query(
          "INSERT INTO supabase_migrations.schema_migrations(version,name) VALUES($1,$2)",
          [version, name],
        );
        await client.query("COMMIT");
        console.log("applied " + file);
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(file + ": " + error.message);
      }
    }
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
