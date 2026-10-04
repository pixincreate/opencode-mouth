/** Select the host's SQLite implementation without loading Bun modules in Node. */
type Parameter = string | number | null;
export interface Connection {
  prepare(sql: string): {
    all(...parameters: Parameter[]): unknown[];
    get(...parameters: Parameter[]): unknown;
    run(...parameters: Parameter[]): unknown;
  };
  exec(sql: string): unknown;
}

export const openDatabase: (path: string, readonly?: boolean) => Connection = process.versions.bun
  ? (({ Database }) => (path: string, readonly = false) => new Database(path, { readonly, create: !readonly }))(await import("bun:sqlite"))
  : (({ DatabaseSync }) => (path: string, readonly = false) => new DatabaseSync(path, { readOnly: readonly }))(await import("node:sqlite"));

export function transaction(connection: Connection, run: () => void): void {
  connection.exec("BEGIN");
  try {
    run();
    connection.exec("COMMIT");
  } catch (error) {
    connection.exec("ROLLBACK");
    throw error;
  }
}
