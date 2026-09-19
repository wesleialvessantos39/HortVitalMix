import { Pool } from 'pg';
import { runtime } from '../config/runtime';
export const DATABASE_CONFIGURED = runtime.dbUrl !== null;
export const dbPool = runtime.dbUrl ? new Pool({connectionString:runtime.dbUrl,max:runtime.isServerless?1:5,idleTimeoutMillis:30_000,connectionTimeoutMillis:5_000,ssl:{rejectUnauthorized:false}}) : null;
