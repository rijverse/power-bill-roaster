import crypto from 'crypto';
import { discordPublicKey, verifyInteractionSignature } from '../../discord/verify';

// A real ed25519 keypair: the public half in the raw-hex form the Discord
// portal hands out, the private half to forge valid signatures with.
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const publicKeyHex = publicKey
  .export({ format: 'der', type: 'spki' })
  .subarray(-32)
  .toString('hex');

function signHex(timestamp: string, body: string): string {
  return crypto.sign(null, Buffer.from(timestamp + body), privateKey).toString('hex');
}

describe('discordPublicKey', () => {
  it('parses the 64-char hex key the portal shows', () => {
    expect(() => discordPublicKey(publicKeyHex)).not.toThrow();
  });

  it('rejects a key of the wrong length', () => {
    expect(() => discordPublicKey('abcd')).toThrow('32 bytes');
  });
});

describe('verifyInteractionSignature', () => {
  const key = discordPublicKey(publicKeyHex);
  const body = '{"type":1}';
  const ts = '1700000000';

  it('accepts a valid signature over timestamp+body', () => {
    expect(verifyInteractionSignature(key, signHex(ts, body), ts, body)).toBe(true);
  });

  it('rejects when the body was tampered with', () => {
    expect(verifyInteractionSignature(key, signHex(ts, body), ts, '{"type":2}')).toBe(false);
  });

  it('rejects when the timestamp was swapped', () => {
    expect(verifyInteractionSignature(key, signHex(ts, body), '1700000001', body)).toBe(false);
  });

  it('rejects a signature from a different key', () => {
    const other = crypto.generateKeyPairSync('ed25519');
    const forged = crypto.sign(null, Buffer.from(ts + body), other.privateKey).toString('hex');
    expect(verifyInteractionSignature(key, forged, ts, body)).toBe(false);
  });

  it('returns false (never throws) on malformed signature input', () => {
    expect(verifyInteractionSignature(key, 'zz-not-hex', ts, body)).toBe(false);
    expect(verifyInteractionSignature(key, 'abcd', ts, body)).toBe(false);
    expect(verifyInteractionSignature(key, '', ts, body)).toBe(false);
  });
});
