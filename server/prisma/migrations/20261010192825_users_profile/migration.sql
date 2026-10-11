-- CreateEnum
CREATE TYPE "allergen" AS ENUM ('milk', 'eggs', 'fish', 'shellfish', 'tree_nuts', 'peanuts', 'wheat', 'soy', 'sesame', 'gluten');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "google_sub" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "avatar_url" TEXT,
    "zip_code" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_allergens" (
    "user_id" UUID NOT NULL,
    "allergen" "allergen" NOT NULL,

    CONSTRAINT "user_allergens_pkey" PRIMARY KEY ("user_id","allergen")
);

-- CreateTable
CREATE TABLE "user_diets" (
    "user_id" UUID NOT NULL,
    "diet" TEXT NOT NULL,

    CONSTRAINT "user_diets_pkey" PRIMARY KEY ("user_id","diet")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_google_sub_key" ON "users"("google_sub");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- AddForeignKey
ALTER TABLE "user_allergens" ADD CONSTRAINT "user_allergens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_diets" ADD CONSTRAINT "user_diets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written: rules Prisma can't express
ALTER TABLE "users" ADD CONSTRAINT "users_email_lowercase_chk" CHECK ("email" = lower(btrim("email")));
ALTER TABLE "user_diets" ADD CONSTRAINT "user_diets_diet_chk" CHECK ("diet" IN (
  'vegetarian', 'vegan', 'pescatarian', 'keto', 'halal', 'kosher', 'low_sodium', 'dairy_free', 'gluten_free'
));
