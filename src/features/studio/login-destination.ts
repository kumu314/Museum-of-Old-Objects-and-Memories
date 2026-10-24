import { shareTokenSchema } from '../../contracts/session';

// Only a current share-page path can override the usual post-login destination.
export function loginDestination(value: unknown): string {
  const prefix = '/share/';
  if (typeof value !== 'string' || !value.startsWith(prefix)) return '/studio';
  return shareTokenSchema.safeParse(value.slice(prefix.length)).success ? value : '/studio';
}
