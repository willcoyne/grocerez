import { afterAll, expect, it } from "vitest";
import { prisma } from "../src/db.js";
import { normalizeItemName } from "../src/lib/normalize.js";

afterAll(() => prisma.$disconnect());

const cases: [string, string][] = [
  ["Cheerios!", "cheerio"],
  ["  Cherios ", "cherio"],
  ["Tomatoes", "tomato"],
  ["Peaches", "peach"],
  ["Boxes", "box"],
  ["Oranges", "orange"],
  ["Cheeses", "cheese"],
  ["Glasses", "glass"],
  ["Hummus", "hummus"],
  ["Asparagus", "asparagus"],
  ["Swiss", "swiss"],
  ["Peas", "pea"],
  ["Gas", "gas"],
  ["Ben & Jerry's   Ice-Cream", "ben & jerrys icecream"],
  ["M&M's", "m&m"],
  ["2% Milk", "2 milk"],
  ["Jalapeños", "jalapeño"],
  ["CRÈME FRAÎCHE", "crème fraîche"],
  ["\tGreen\n Beans ", "green bean"],
  ["!!!", ""],
  ["Lays", "lay"],
];

it("normalizeItemName matches SQL normalize_item_name() on tricky inputs", async () => {
  for (const [input] of cases) {
    const [{ n }] = await prisma.$queryRaw<{ n: string }[]>`SELECT normalize_item_name(${input}) AS n`;
    expect(normalizeItemName(input), input).toBe(n);
  }
});

it("normalizes as designed", () => {
  for (const [input, want] of cases) expect(normalizeItemName(input), input).toBe(want);
});
