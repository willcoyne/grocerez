// Checks the SQL normalize_item_name() against prisma/fixtures/normalize-cases.json (run: npm run db:check:normalize).
import { readFileSync } from "node:fs";
import { prisma } from "../../src/db.js";
const { cases } = JSON.parse(readFileSync("prisma/fixtures/normalize-cases.json", "utf8"));
let bad = 0;
for (const c of cases) {
  const [r] = await prisma.$queryRaw<{ n: string; nn: string }[]>`SELECT normalize_item_name(${c.input}) AS n, normalize_item_name(normalize_item_name(${c.input})) AS nn`;
  if (r.n !== c.expected || r.nn !== r.n) { bad++; console.log("MISMATCH", JSON.stringify(c.input), "expected", JSON.stringify(c.expected), "got", JSON.stringify(r.n), "twice", JSON.stringify(r.nn)); }
}
console.log(`${cases.length - bad}/${cases.length} cases match (incl. idempotency)`);
await prisma.$disconnect();
