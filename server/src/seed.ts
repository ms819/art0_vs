import { getAllCards, initDatabase, seedDatabase } from "./db.js";

async function main() {
  const db = await initDatabase();
  const count = await seedDatabase(db);
  const cards = await getAllCards(db);
  console.info(`[seed] upserted ${count} cards`);
  console.info(`[seed] database now has ${cards.length} cards`);
  await db.close();
}

void main();
