import crypto from 'crypto';

// Discord signs every interaction POST with the app's ed25519 key and requires
// endpoints to reject bad signatures (it probes with invalid ones on setup).
// Node's crypto verifies ed25519 natively, so no third-party nacl dependency:
// we just wrap the portal's raw 32-byte key in the DER/SPKI envelope
// createPublicKey expects.

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const RAW_KEY_BYTES = 32;
const SIGNATURE_BYTES = 64;

/** The portal's hex public key as a KeyObject. Throws on malformed hex. */
export function discordPublicKey(publicKeyHex: string): crypto.KeyObject {
  const raw = Buffer.from(publicKeyHex, 'hex');
  if (raw.length !== RAW_KEY_BYTES) {
    throw new Error('Discord public key must be 32 bytes of hex');
  }
  return crypto.createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
    format: 'der',
    type: 'spki',
  });
}

/**
 * True only if `signatureHex` is a valid signature over timestamp+rawBody.
 * Any malformed input (odd hex, wrong length) is a plain false, not a throw -
 * this sits on an unauthenticated endpoint.
 */
export function verifyInteractionSignature(
  publicKey: crypto.KeyObject,
  signatureHex: string,
  timestamp: string,
  rawBody: string
): boolean {
  const signature = Buffer.from(signatureHex, 'hex');
  if (signature.length !== SIGNATURE_BYTES) {
    return false;
  }
  try {
    return crypto.verify(null, Buffer.from(timestamp + rawBody), publicKey, signature);
  } catch {
    return false;
  }
}
