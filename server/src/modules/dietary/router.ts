import { Router } from "express";
import { prisma } from "../../db.js";
import { type Allergen, type Diet, type Dietary, DietaryBody } from "../../contracts/dietary.js";
import { uid } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { emitGroup } from "../../lib/realtime.js";
import { lockGroups, regenerate } from "../shopping-list/engine.js";

async function getDietary(userId: string): Promise<Dietary> {
  const [diets, allergens] = await Promise.all([
    prisma.userDiet.findMany({ where: { userId }, orderBy: { diet: "asc" } }),
    prisma.userAllergen.findMany({ where: { userId }, orderBy: { allergen: "asc" } }),
  ]);
  return { diets: diets.map((d) => d.diet as Diet), allergens: allergens.map((a) => a.allergen as Allergen) };
}

/**
 * PUT replaces both sets in one transaction and regenerates every group the user is in (allergen flags change),
 * in that same transaction.
 */
async function putDietary(userId: string, body: Dietary): Promise<Dietary> {
  const diets = [...new Set(body.diets)];
  const allergens = [...new Set(body.allergens)];
  const changed = await prisma.$transaction(async (tx) => {
    const groups = await tx.groupMember.findMany({ where: { userId }, select: { groupId: true } });
    await lockGroups(tx, groups.map((g) => g.groupId));
    await tx.userDiet.deleteMany({ where: { userId } });
    await tx.userAllergen.deleteMany({ where: { userId } });
    if (diets.length) await tx.userDiet.createMany({ data: diets.map((diet) => ({ userId, diet })) });
    if (allergens.length) await tx.userAllergen.createMany({ data: allergens.map((allergen) => ({ userId, allergen })) });
    const out: string[] = [];
    for (const { groupId } of groups) if ((await regenerate(tx, groupId)) > 0) out.push(groupId);
    return out;
  });
  for (const groupId of changed) emitGroup(groupId, "shopping-list:changed", userId);
  return getDietary(userId);
}

export const dietaryRouter = Router();

dietaryRouter.get("/me/dietary", async (req, res) => {
  res.json(await getDietary(uid(req)));
});

dietaryRouter.put("/me/dietary", validate({ body: DietaryBody }), async (req, res) => {
  res.json(await putDietary(uid(req), req.body));
});
