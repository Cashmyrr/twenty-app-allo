/**
 * Twenty stores the national number and the calling code apart; Allo wants one
 * E.164 string. Same shape as the one the backfill script uses, kept here so the
 * logic function bundle does not reach into scripts/.
 */
export const toE164 = (phone: {
  primaryPhoneNumber?: string | null;
  primaryPhoneCallingCode?: string | null;
}): string | null => {
  const national = (phone.primaryPhoneNumber ?? '').replace(/[^\d]/g, '');

  if (national.length === 0) {
    return null;
  }

  const calling = (phone.primaryPhoneCallingCode ?? '').replace(/[^\d]/g, '');

  return calling.length > 0 ? `+${calling}${national}` : `+${national}`;
};
