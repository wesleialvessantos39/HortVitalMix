export interface ExpectedMigration {
  version: number;
  name: string;
  checksum: string;
}

export const EXPECTED_MIGRATIONS = [
  { version: 1, name: 'oe_001_001_foundation', checksum: '7affe9ce4ce91b115d537745c9f3bf53522450b66783a2c70c6a7633183c0563' },
  { version: 2, name: 'oe_001_002_global_configuration', checksum: 'e8c77e4a32c7006a1d4d8292586b695895b528786021f97c8e54e9bf94a98e68' },
  { version: 3, name: 'oe_001_003_environments', checksum: 'd4ed92b4d50d7944aab2dd06b987e100a236c8bbc0431e6b5aef69de5fe158a3' },
  { version: 4, name: 'oe_001_004_database_foundation', checksum: '1aa13dcf29dc9c535c5d8efbc707746957724761437589959752d9e9f452454e' },
] as const satisfies readonly ExpectedMigration[];

export const EXPECTED_SCHEMA_VERSION = 4;
export const EXPECTED_RELEASE_VERSION = 'oe-001-004';
export const EXPECTED_MIGRATION_HISTORY_HASH =
  '6593aac76cb473ab64e40d6de8bd093d1df88f21724025a1189d8649d4eb68f3';
export const MIGRATION_ADVISORY_LOCK_KEY = '62001004';
