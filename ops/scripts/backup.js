import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db.js";
import { backup } from "../src/app.js";
const config = loadConfig();
console.log("Copia creada:", backup(openDb(config.dataDir), config));
