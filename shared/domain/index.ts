/**
 * Canonical domain definitions for HortiVitalMix.
 * Fonte normativa: HortiVitalMix Manual Mestre Técnico Greenfield v6.
 */

export const APP_ENVIRONMENTS = ['development', 'homologation', 'production'] as const;
export type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];

export const DEPENDENCY_STATUSES = ['ready', 'unavailable'] as const;
export type DependencyStatus = (typeof DEPENDENCY_STATUSES)[number];

export const SERVICE_STATUSES = ['ok', 'unavailable'] as const;
export type ServiceStatus = (typeof SERVICE_STATUSES)[number];
