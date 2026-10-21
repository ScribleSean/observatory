// The time zone that decides which day and hour a record belongs to.
// It follows this computer's own zone. OBSERVATORY_TIMEZONE overrides it, which
// the tests use to pin America/New_York so their saved results match anywhere.
export function validTimeZone(value) {
  if(typeof value!=='string' || !value)return false;
  try {new Intl.DateTimeFormat('en-US',{timeZone:value});return true;}
  catch {return false;}
}

export function resolveTimeZone(environment=process.env) {
  if(validTimeZone(environment.OBSERVATORY_TIMEZONE))return environment.OBSERVATORY_TIMEZONE;
  const system=Intl.DateTimeFormat().resolvedOptions().timeZone;
  return validTimeZone(system)?system:'UTC';
}

export const TIME_ZONE=resolveTimeZone();
