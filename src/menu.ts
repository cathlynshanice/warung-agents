export type MenuItem = {
  id: string;
  name: string;
  category: "makanan" | "minuman";
  priceRp: number;
  description: string;
  ingredients: string[];
};

export const MENU: MenuItem[] = [
  {
    id: "nasi-goreng",
    name: "Nasi Goreng Spesial",
    category: "makanan",
    priceRp: 30_000,
    description: "Nasi goreng kecap dengan telur ceplok, ayam suwir, dan kerupuk. Pedas sedang, bisa minta tidak pedas.",
    ingredients: ["nasi", "telur", "ayam", "kecap manis", "bawang", "cabai", "kerupuk udang"],
  },
  {
    id: "mie-ayam",
    name: "Mie Ayam Bakso",
    category: "makanan",
    priceRp: 25_000,
    description: "Mie kuning dengan ayam kecap, sawi, dan dua bakso sapi. Tidak pedas, sambal terpisah.",
    ingredients: ["mie telur", "ayam", "bakso sapi", "sawi", "daun bawang", "minyak bawang"],
  },
  {
    id: "gado-gado",
    name: "Gado-gado",
    category: "makanan",
    priceRp: 18_000,
    description: "Sayuran rebus dengan tahu, tempe, telur, dan lontong, disiram bumbu kacang. Vegetarian.",
    ingredients: ["kacang tanah", "kangkung", "tauge", "kol", "tahu", "tempe", "telur", "lontong"],
  },
  {
    id: "es-teh",
    name: "Es Teh Manis",
    category: "minuman",
    priceRp: 5_000,
    description: "Teh melati dengan gula dan es batu.",
    ingredients: ["teh melati", "gula", "es batu"],
  },
  {
    id: "es-jeruk",
    name: "Es Jeruk",
    category: "minuman",
    priceRp: 7_000,
    description: "Jeruk peras segar dengan es batu.",
    ingredients: ["jeruk", "gula", "es batu"],
  },
];

export function findItem(id: string | undefined): MenuItem | undefined {
  return MENU.find((item) => item.id === id);
}

export type CartLine = { item: MenuItem; quantity: number };

/** A cart travels in the URL as `items=nasi-goreng:2,es-teh:1`. Returns the cart, or an error message when an item or quantity is invalid. */
export function parseCart(param: unknown): CartLine[] | string {
  if (typeof param !== "string" || !param.trim()) return `Missing ?items=, e.g. items=nasi-goreng:2,es-teh:1`;
  const lines: CartLine[] = [];
  for (const part of param.split(",")) {
    const [id, qty = "1"] = part.split(":");
    const item = findItem(id.trim());
    const quantity = Number(qty);
    if (!item) return `Item not found: "${id}". Use an id from GET /menu, like "nasi-goreng".`;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) return `Quantity for ${id} must be 1-10.`;
    lines.push({ item, quantity });
  }
  return lines;
}

export function cartTotalRp(lines: CartLine[]): number {
  return lines.reduce((sum, line) => sum + line.item.priceRp * line.quantity, 0);
}

export function describeCart(lines: CartLine[]): string {
  return lines.map((line) => `${line.quantity}x ${line.item.name}`).join(", ");
}
