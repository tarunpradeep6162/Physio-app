import { useSessionUserId } from '../data/auth';
import { clinicianForUser, patientForUser } from '../data/queries';
import { useDb } from '../data/store';

export function useCurrentUser() {
  const uid = useSessionUserId();
  return useDb((d) => d.users.find((u) => u.id === uid) ?? null, [uid]);
}

export function useCurrentPatient() {
  const uid = useSessionUserId();
  return useDb((d) => patientForUser(d, uid) ?? null, [uid]);
}

export function useCurrentClinician() {
  const uid = useSessionUserId();
  return useDb((d) => clinicianForUser(d, uid) ?? null, [uid]);
}
