// Genera el catálogo de muebles y el índice de assets de la Oficina (ejecutar tras cambiar assets):
//   npx tsx scripts/oficina-assets.mts
import * as fs from "fs";
import * as path from "path";
import { buildAssetIndex, buildFurnitureCatalog } from "../vendor/pixel-agents/core/src/assets/build";

const dir = path.resolve("public/oficina");
fs.writeFileSync(path.join(dir, "furniture-catalog.json"), JSON.stringify(buildFurnitureCatalog(dir)));
fs.writeFileSync(path.join(dir, "asset-index.json"), JSON.stringify(buildAssetIndex(dir), null, 1));
console.log("Listo:", path.join(dir, "asset-index.json"));
