import {readFile,writeFile,readdir} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import path from "node:path";
const market=process.argv[2];if(!["tw","kr"].includes(market))throw new Error("REGIONAL_MARKET");
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
for(const f of await readdir(path.join(root,"src")))if(/^web-.*\.ts$/.test(f))await writeFile(path.join(root,market,"src",f),await readFile(path.join(root,"src",f)));
