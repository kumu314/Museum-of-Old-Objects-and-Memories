/** Refuse different credentials for the same database, including common loopback aliases. */
export function getIsolatedTestDatabaseUrl(environment: Readonly<Record<string, string | undefined>> = process.env): string {
  const test = environment.TEST_DATABASE_URL;
  const application = environment.DATABASE_URL;
  if (!test || !application) throw new Error('DATABASE_URL and TEST_DATABASE_URL are required.');
  function identity(value: string): string {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error('Invalid PostgreSQL connection configuration.');
    }
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname.length < 2) {
      throw new Error('PostgreSQL URL with an explicit host and database is required.');
    }
    // pg accepts query parameters that override the URL host/database. Refuse them so
    // the isolation comparison describes the connection that will actually be made.
    for (const key of url.searchParams.keys()) {
      if (key !== 'sslmode') throw new Error('Only sslmode is allowed as a database connection query parameter.');
    }
    const rawHost = url.hostname.toLowerCase();
    const host = ['localhost', '127.0.0.1', '[::1]'].includes(rawHost) ? 'loopback' : rawHost;
    return `${host}:${url.port || '5432'}/${decodeURIComponent(url.pathname)}`;
  }
  if (identity(test) === identity(application)) throw new Error('TEST_DATABASE_URL must use a separate database.');
  return test;
}
