// Constant-time string comparison for shared-secret checks (e.g. a health
// endpoint token). A naive `===` short-circuits on the first mismatched
// byte, which leaks timing information about how many leading characters
// of a guess were correct — a real, well-documented attack against secret
// comparisons, not just theoretical.
export function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= (aBytes[i] as number) ^ (bBytes[i] as number);
  }
  return diff === 0;
}
