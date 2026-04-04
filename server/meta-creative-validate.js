/**
 * Conservative limits aligned with Meta link-ad feed best practices (truncation / UI).
 * Set META_SKIP_CREATIVE_COPY_VALIDATION=true to bypass (e.g. legacy long copy).
 */

export const AD_COPY_LIMITS = {
  /** Primary text (message) */
  message: 5000,
  /** Link title / headline */
  headline: 40,
  /** Link description */
  description: 30,
};

export function shouldValidateAdCopy() {
  return process.env.META_SKIP_CREATIVE_COPY_VALIDATION !== "true";
}

/**
 * @param {{ message?: string, headline?: string, description?: string }} resolved
 *   Values should already include defaults where applicable.
 */
export function validateAdCopyForLinkCreative(resolved) {
  if (!shouldValidateAdCopy()) return;
  const message = String(resolved?.message ?? "");
  const headline = String(resolved?.headline ?? "");
  const description = String(resolved?.description ?? "");
  const errs = [];
  if (message.length > AD_COPY_LIMITS.message) {
    errs.push(`message length ${message.length} exceeds max ${AD_COPY_LIMITS.message}`);
  }
  if (headline.length > AD_COPY_LIMITS.headline) {
    errs.push(`headline length ${headline.length} exceeds max ${AD_COPY_LIMITS.headline}`);
  }
  if (description.length > AD_COPY_LIMITS.description) {
    errs.push(`description length ${description.length} exceeds max ${AD_COPY_LIMITS.description}`);
  }
  if (errs.length) {
    const err = new Error(`Ad copy validation: ${errs.join("; ")}`);
    err.code = "AD_COPY_VALIDATION";
    throw err;
  }
}
