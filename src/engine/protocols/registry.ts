import type { Side } from '../types';
import { KNEE_DEFAULT_PLAN, KNEE_SIT_TO_STAND, KNEE_SIT_TO_STAND_V1_0, KNEE_SQUAT, KNEE_SQUAT_V1_0, KNEE_SUPPORTED_FLEXION, KNEE_SUPPORTED_FLEXION_V1_0 } from './knee';
import { SHOULDER_DEFAULT_PLAN, SHOULDER_PROTOCOLS } from './shoulder';
import type { ProtocolDef, Region } from './types';

/**
 * Versioned protocol registry for every pathway. Current versions are used for new captures;
 * every released version stays resolvable so historical captures are read with the definition
 * they were recorded under.
 */

export const PROTOCOLS: Record<string, ProtocolDef> = Object.fromEntries([KNEE_SUPPORTED_FLEXION, KNEE_SIT_TO_STAND, KNEE_SQUAT, ...SHOULDER_PROTOCOLS].map((p) => [p.id, p]));

const HISTORY: Record<string, ProtocolDef> = Object.fromEntries(
  [KNEE_SUPPORTED_FLEXION_V1_0, KNEE_SIT_TO_STAND_V1_0, KNEE_SQUAT_V1_0, ...Object.values(PROTOCOLS)].map((p) => [`${p.id}@${p.version}`, p]),
);

/** Every version ever released, for provenance display. */
export const PROTOCOL_VERSIONS = Object.keys(HISTORY);

export function getProtocol(id: string, version?: string): ProtocolDef {
  return (version && HISTORY[`${id}@${version}`]) || PROTOCOLS[id];
}

export const protocolsForRegion = (region: Region) => Object.values(PROTOCOLS).filter((p) => p.region === region);

export const DEFAULT_PLANS: Partial<Record<Region, { protocolId: string; side: Side | null }[]>> = {
  knee: KNEE_DEFAULT_PLAN,
  shoulder: SHOULDER_DEFAULT_PLAN,
};
