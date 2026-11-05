// Signing in to the admin panel with a passkey: Face ID or Touch ID on an iPhone, iPad or Mac
// (kept in iCloud Keychain, so it's on all of the person's Apple devices), a fingerprint or
// Windows Hello elsewhere, or a phone held up to a computer's QR code.
//
// There's no password anywhere. The phone keeps a private key that never leaves it; the site
// keeps only the matching public key, and checks each sign-in against it (WebAuthn, the web
// standard behind passkeys). A passkey only works on the site it was made for, so a fake
// copy of the site can't use it.

const utf8 = new TextEncoder();

export const b64url = {
  encode(bytes) {
    let s = '';
    for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode(text) {
    const b64 = String(text ?? '').replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  },
};

/** A random code, as URL-safe text. 32 bytes: impossible to guess. */
export const randomCode = (bytes = 32) => b64url.encode(crypto.getRandomValues(new Uint8Array(bytes)));

export async function sha256(data) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? utf8.encode(data) : data));
}

/** What's stored instead of a code or a session's cookie: its SHA-256, in hex. */
export const hashCode = async (code) => Array.from(await sha256(String(code)), (b) => b.toString(16).padStart(2, '0')).join('');

const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// The two kinds of passkey phones and computers make.
const ALGS = {
  [-7]: { key: { name: 'ECDSA', namedCurve: 'P-256' }, verify: { name: 'ECDSA', hash: 'SHA-256' } },
  [-257]: { key: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, verify: { name: 'RSASSA-PKCS1-v1_5' } },
};

export class PasskeyError extends Error {}

function readClientData(clientDataJSON, { type, challenge, origin }) {
  let data;
  try {
    data = JSON.parse(new TextDecoder().decode(b64url.decode(clientDataJSON)));
  } catch {
    throw new PasskeyError('unreadable client data');
  }
  if (data?.type !== type) throw new PasskeyError('wrong type');
  if (data.challenge !== challenge) throw new PasskeyError('wrong challenge');
  if (data.origin !== origin) throw new PasskeyError('made on another site');
  if (data.crossOrigin === true) throw new PasskeyError('inside another site');
  return data;
}

/** The phone's own statement: for which site, that the person was there and verified (Face ID). */
async function readAuthData(bytes, rpId) {
  if (bytes.length < 37) throw new PasskeyError('authenticator data too short');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const flags = bytes[32];
  if (!same(bytes.slice(0, 32), await sha256(rpId))) throw new PasskeyError('made for another site');
  if (!(flags & 0x01)) throw new PasskeyError('nobody was there');
  if (!(flags & 0x04)) throw new PasskeyError('the person was not verified');
  const out = { signCount: view.getUint32(33) };
  if (flags & 0x40) {
    if (bytes.length < 55) throw new PasskeyError('no passkey in the data');
    const length = view.getUint16(53);
    out.credentialId = bytes.slice(55, 55 + length);
  }
  return out;
}

/**
 * A new passkey, from navigator.credentials.create() on the admin page.
 * → { id, publicKey, alg, signCount } to store.
 */
export async function verifyRegistration(credential, { challenge, origin, rpId }) {
  const r = credential?.response || {};
  readClientData(r.clientDataJSON, { type: 'webauthn.create', challenge, origin });
  const auth = await readAuthData(b64url.decode(r.authenticatorData), rpId);
  if (!auth.credentialId || !same(auth.credentialId, b64url.decode(credential.rawId || credential.id))) {
    throw new PasskeyError('the passkey does not match');
  }
  const alg = Number(r.publicKeyAlgorithm);
  if (!ALGS[alg]) throw new PasskeyError('unsupported kind of passkey');
  try {
    await crypto.subtle.importKey('spki', b64url.decode(r.publicKey), ALGS[alg].key, false, ['verify']);
  } catch {
    throw new PasskeyError('unreadable public key');
  }
  return { id: b64url.encode(auth.credentialId), publicKey: r.publicKey, alg, signCount: auth.signCount };
}

// Phones send ECDSA signatures DER-encoded; WebCrypto wants r and s side by side.
function derToRaw(der) {
  if (der[0] !== 0x30 || der.length < 8) throw new PasskeyError('unreadable signature');
  let i = 2;
  const part = () => {
    if (der[i] !== 0x02) throw new PasskeyError('unreadable signature');
    const length = der[i + 1];
    let v = der.slice(i + 2, i + 2 + length);
    i += 2 + length;
    while (v.length > 32 && v[0] === 0) v = v.slice(1);
    if (v.length > 32) throw new PasskeyError('unreadable signature');
    const out = new Uint8Array(32);
    out.set(v, 32 - v.length);
    return out;
  };
  const raw = new Uint8Array(64);
  raw.set(part(), 0);
  raw.set(part(), 32);
  return raw;
}

/** A sign-in, from navigator.credentials.get(), against the stored passkey. → its new counter. */
export async function verifyLogin(credential, stored, { challenge, origin, rpId }) {
  const r = credential?.response || {};
  readClientData(r.clientDataJSON, { type: 'webauthn.get', challenge, origin });
  const authBytes = b64url.decode(r.authenticatorData);
  const auth = await readAuthData(authBytes, rpId);
  const alg = ALGS[stored.alg];
  if (!alg) throw new PasskeyError('unsupported kind of passkey');
  const key = await crypto.subtle.importKey('spki', b64url.decode(stored.public_key), alg.key, false, ['verify']);
  let signature = b64url.decode(r.signature);
  if (stored.alg === -7) signature = derToRaw(signature);
  const clientHash = await sha256(b64url.decode(r.clientDataJSON));
  const signed = new Uint8Array(authBytes.length + clientHash.length);
  signed.set(authBytes, 0);
  signed.set(clientHash, authBytes.length);
  if (!(await crypto.subtle.verify(alg.verify, key, signature, signed))) throw new PasskeyError('wrong signature');
  // A counter that goes backwards means a copied passkey. (Synced passkeys, like iCloud's, always say 0.)
  if ((auth.signCount || stored.sign_count) && auth.signCount <= stored.sign_count) throw new PasskeyError('counter went back');
  return auth.signCount;
}
