import { ConnectionString } from 'mongodb-connection-string-url';

export function mongoUriIsValid(uri: string): boolean {
  try { new ConnectionString(uri); return true; } catch { return false; }
}
export function productionMongoUriIsSecure(uri: string): boolean {
  try {
    const params = new ConnectionString(uri).typedSearchParams<Record<string, string>>();
    for (const [key, value] of params) {
      const option = key.toLowerCase();
      const enabled = value.toLowerCase() === 'true';
      if ((option === 'tls' || option === 'ssl') && !enabled) return false;
      if (['tlsinsecure', 'tlsallowinvalidcertificates', 'tlsallowinvalidhostnames'].includes(option) && enabled) return false;
    }
    return true;
  } catch { return false; }
}
