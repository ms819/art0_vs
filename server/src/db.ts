import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import sqlite3 from "sqlite3";
import { open, type Database } from "sqlite";
import type { CardDefinition } from "./types.js";

const dataDir = path.resolve(process.cwd(), "data");
const defaultDbPath = path.join(dataDir, "cards.sqlite");
const dbPath = path.resolve(process.env.DB_PATH ?? defaultDbPath);
const sourceCardsPath = path.resolve(process.cwd(), "..", "src", "data", "cards.js");

export async function initDatabase() {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database,
  });

  const hasLegacySchema = await shouldRecreateCardsTable(db);
  if (hasLegacySchema) {
    await db.exec("DROP TABLE IF EXISTS cards");
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      cost INTEGER NOT NULL,
      reduction TEXT NOT NULL,
      color TEXT NOT NULL,
      symbolCount INTEGER NOT NULL,
      symbolColor TEXT NOT NULL,
      levels TEXT NOT NULL,
      type TEXT NOT NULL,
      img TEXT NOT NULL
    )
  `);

  return db;
}

export async function seedDatabase(db: Database) {
  const cards = await loadSourceCards();

  for (const card of cards) {
    await db.run(
      `
        INSERT INTO cards (id, name, cost, reduction, color, symbolCount, symbolColor, levels, type, img)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          cost = excluded.cost,
          reduction = excluded.reduction,
          color = excluded.color,
          symbolCount = excluded.symbolCount,
          symbolColor = excluded.symbolColor,
          levels = excluded.levels,
          type = excluded.type,
          img = excluded.img
      `,
      [
        card.id,
        card.name,
        card.cost,
        JSON.stringify(card.reduction),
        card.color,
        card.symbolCount,
        card.symbolColor,
        JSON.stringify(card.levels),
        card.type,
        normalizeImagePath(card.img),
      ],
    );
  }

  return cards.length;
}

export async function getAllCards(db: Database): Promise<CardDefinition[]> {
  const rows = await db.all<DatabaseRow[]>("SELECT * FROM cards ORDER BY id ASC");
  return rows.map(mapRowToCard);
}

export async function loadSourceCards(): Promise<CardDefinition[]> {
  const moduleUrl = pathToFileURL(sourceCardsPath).href;
  const imported = (await import(moduleUrl)) as { cards: CardDefinition[] };
  return imported.cards.map((card) => ({
    ...card,
    type: normalizeType(card.id, card.type),
    img: normalizeImagePath(card.img),
  }));
}

interface DatabaseRow {
  id: string;
  name: string;
  cost: number;
  reduction: string;
  color: CardDefinition["color"];
  symbolCount: number;
  symbolColor: string;
  levels: string;
  type: CardDefinition["type"];
  img: string;
}

function mapRowToCard(row: DatabaseRow): CardDefinition {
  return {
    id: row.id,
    name: row.name,
    cost: row.cost,
    reduction: JSON.parse(row.reduction) as CardDefinition["reduction"],
    color: row.color,
    symbolCount: row.symbolCount,
    symbolColor: row.symbolColor,
    levels: JSON.parse(row.levels) as CardDefinition["levels"],
    type: row.type,
    img: normalizeImagePath(row.img),
  };
}

function normalizeImagePath(img: string) {
  if (img === "/images/art.jpeg") {
    return "/images/art_j.jpeg";
  }
  if (img === "/images/uruh.png") {
    return "/images/uruhu.png";
  }
  if (img === "/images/tenpest.png") {
    return "/images/tennpest.png";
  }
  return img;
}

function normalizeType(cardId: string, type: string): CardDefinition["type"] {
  if (type === "arutimetto") {
    return "ultimate";
  }
  if (cardId === "A-007") {
    return "ultimate";
  }
  if (type === "spirit" || type === "nexus" || type === "magic" || type === "ultimate") {
    return type;
  }
  return "spirit";
}

async function shouldRecreateCardsTable(db: Database) {
  const tableInfo = (await db.all("PRAGMA table_info(cards)")) as Array<{ name: string }>;
  if (tableInfo.length === 0) {
    return false;
  }

  const columnNames = new Set(tableInfo.map((column) => column.name));
  return !columnNames.has("reduction") || !columnNames.has("levels") || !columnNames.has("img");
}
