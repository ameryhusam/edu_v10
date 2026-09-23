import bcrypt from "bcryptjs";
import { db } from "../src/db.js";
import { importQuestionBankDirectory } from "./question-bank-importer.js";

await importQuestionBankDirectory();

const pinHash = await bcrypt.hash("1234", 10);
await db.$transaction(async (tx) => {
  const parent = await tx.user.upsert({
    where: { username: "parent" },
    update: { displayName: "ولي الأمر", role: "PARENT", pinHash },
    create: { username: "parent", displayName: "ولي الأمر", role: "PARENT", pinHash }
  });
  const child = await tx.user.upsert({
    where: { username: "child" },
    update: { displayName: "الابن", role: "CHILD", pinHash },
    create: { username: "child", displayName: "الابن", role: "CHILD", pinHash }
  });
  await tx.user.upsert({
    where: { username: "admin" },
    update: { displayName: "مدير النظام", role: "SYSTEM_ADMIN", pinHash },
    create: { username: "admin", displayName: "مدير النظام", role: "SYSTEM_ADMIN", pinHash }
  });
  await tx.parentChildLink.upsert({
    where: { parentId_childId: { parentId: parent.id, childId: child.id } },
    update: {},
    create: { parentId: parent.id, childId: child.id }
  });
});
await db.$disconnect();
console.log("Seed complete. Demo accounts use PIN 1234.");
