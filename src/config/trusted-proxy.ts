import { isIP } from 'node:net';

export function validProxyAddress(value: string): boolean {
  const [address, prefix, extra] = value.split('/');
  if (!address || extra !== undefined) return false;
  const version = isIP(address);
  if (!version) return false;
  if (prefix === undefined) return true;
  return /^\d+$/.test(prefix) && Number(prefix) > 0 && Number(prefix) <= (version === 4 ? 32 : 128);
}
