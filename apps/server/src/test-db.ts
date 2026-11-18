/**
 * Test database selection. By default tests use crm_test (TEST_DATABASE_URL). Setting TEST_DB_NAME=crm_test_w1 (etc.)
 * points the same credentials at another empty database, so several test runs can go on at once without
 * truncating each other's data.
 */
const swap = (url: string | undefined): string | undefined => {
  const name = process.env.TEST_DB_NAME;
  return url && name ? url.replace(/\/[^/?]+(\?.*)?$/, `/${name}$1`) : url;
};
export const testDbUrl = (): string | undefined => swap(process.env.TEST_DATABASE_URL);
export const testDbMigratorUrl = (): string | undefined => swap(process.env.TEST_DATABASE_URL_MIGRATOR);
