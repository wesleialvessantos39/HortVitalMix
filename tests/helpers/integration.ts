import { describe, it } from 'vitest';
import { HAS_INTEGRATION } from '../setup/globalSetup';

export const integrationDescribe = HAS_INTEGRATION ? describe : describe.skip;
export const integrationIt = HAS_INTEGRATION ? it : it.skip;
