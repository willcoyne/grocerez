// One-off run of the recall import (npm run job:recalls).
import { prisma } from "../db.js";
import { recallsService } from "../modules/recalls/service.js";

const result = await recallsService.importAndMatch();
console.log(`imported ${result.imported} recalls, ${result.matched} new matches`);
await prisma.$disconnect();
