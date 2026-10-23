// Runs one heartbeat from the command line (local development): `npm run tick`.
import "dotenv/config";
import { getConnection } from "../src/db";
import { tick } from "../src/server/jobs";

getConnection()
  .then((conn) => tick({ force: true, conn }))
  .then((r) => {
    console.log(r);
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
