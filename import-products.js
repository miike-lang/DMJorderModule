import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { createRequire } from "module";

const req = createRequire(import.meta.url);
const XLSX = req("xlsx");
const prisma = new PrismaClient();

async function importProducts() {
  console.log("Producten laden uit Excel...");

  const workbook = XLSX.readFile("./Export_2026-04-24_201815.xlsx");
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet);

  const products = {};

  for (const row of rows) {
    const handle = row["Handle"];
    const isMain = row["Top Row"] === true || row["Top Row"] === "TRUE";
    const img = row["Image Src"];

    if (isMain && handle) {
      const sku = String(row["Variant SKU"] || "");
      const brand = sku.toUpperCase().startsWith("CG") ? "CG" : "HC";
      const desc = String(row["Body HTML"] || "").replace(/<[^>]+>/g, "").trim().slice(0, 300);

      products[handle] = {
        id: handle,
        sku,
        brand,
        name: String(row["Title"] || ""),
        description: desc,
        price: parseFloat(row["Variant Price"]) || 0,
        ean: String(row["Variant Barcode"] || ""),
        weight: String(row["Variant Weight"] || ""),
        imageUrl: img ? String(img) : null,
        images: img ? [String(img)] : [],
        usps: [
          row["Metafield: custom.usp_1 [single_line_text_field]"] || "",
          row["Metafield: custom.usp_2 [single_line_text_field]"] || "",
          row["Metafield: custom.usp_3 [single_line_text_field]"] || "",
          row["Metafield: custom.usp_4 [single_line_text_field]"] || "",
          row["Metafield: custom.usp_5 [single_line_text_field]"] || "",
        ].filter(Boolean)
      };
    } else if (handle && products[handle] && img) {
      products[handle].images.push(String(img));
    }
  }

  const productList = Object.values(products);
  console.log(`${productList.length} producten gevonden. Importeren...`);

  let count = 0;
  for (const p of productList) {
    await prisma.product.upsert({
      where: { id: p.id },
      update: p,
      create: p
    });
    count++;
    if (count % 50 === 0) console.log(`${count}/${productList.length} geïmporteerd...`);
  }

  console.log(`Klaar! ${count} producten geïmporteerd.`);
  await prisma.$disconnect();
}

importProducts().catch(console.error);