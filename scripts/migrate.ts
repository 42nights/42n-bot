import { runMigrations } from "../src/db/migrate";
import { PATHS } from "../src/db";

runMigrations();
// eslint-disable-next-line no-console
console.log(`Migrated ${PATHS.DB_PATH}`);
