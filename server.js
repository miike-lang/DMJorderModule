import "dotenv/config";
import express from "express";
import cors from "cors";
import { PrismaClient } from "@prisma/client";
import { Resend } from "resend";
import crypto from "crypto";

const app = express();
const prisma = new PrismaClient();
const resend = new Resend(process.env.RESEND_API_KEY);

app.use(cors());
app.use(express.json());

// ─── PRODUCTEN ───────────────────────────────────────────────
app.get("/api/products", async (req, res) => {
  const products = await prisma.product.findMany();
  res.json(products);
});

// ─── COLLECTIES ──────────────────────────────────────────────
app.get("/api/collections", async (req, res) => {
  const collections = await prisma.collection.findMany({
    include: { products: { include: { product: true } } }
  });
  res.json(collections);
});

// ─── KLANT VIA TOKEN (magic link) ────────────────────────────
app.get("/api/client/:token", async (req, res) => {
  const client = await prisma.client.findUnique({
    where: { token: req.params.token },
    include: {
      collections: {
        include: {
          collection: {
            include: { products: { include: { product: true } } }
          }
        }
      }
    }
  });
  if (!client) return res.status(404).json({ error: "Niet gevonden" });
  res.json(client);
});

// ─── BESTELLING PLAATSEN ──────────────────────────────────────
app.post("/api/orders", async (req, res) => {
  const { token, items, note } = req.body;

  const client = await prisma.client.findUnique({ where: { token } });
  if (!client) return res.status(404).json({ error: "Klant niet gevonden" });

  const total = items.reduce((s, i) => s + i.price * i.qty, 0);
  const orderNr = `ORD-${Date.now()}`;

  const order = await prisma.order.create({
    data: {
      orderNr,
      clientId: client.id,
      total,
      note: note || null,
      status: "Nieuw",
      items: {
        create: items.map(i => ({
          productId: i.id,
          sku: i.sku,
          name: i.name,
          price: i.price,
          qty: i.qty
        }))
      }
    },
    include: { items: true }
  });

  const itemLines = items
    .map(i => `• ${i.name} (${i.sku}) — ${i.qty}× — €${(i.price * i.qty).toFixed(2)}`)
    .join("\n");

  // Mail naar admin
  await resend.emails.send({
    from: "DMJ Showroom <noreply@dmjoutdoor.nl>",
    to: [process.env.ADMIN_EMAIL, process.env.ADMIN_EMAIL2],
    subject: `Nieuwe bestelling ${orderNr} — ${client.name}`,
    text: `Nieuwe bestelling ontvangen.\n\nOrdernummer: ${orderNr}\nKlant: ${client.name}\nE-mail: ${client.email}\n\nProducten:\n${itemLines}\n\nTotaal: €${total.toFixed(2)}\n${note ? `\nOpmerking: ${note}` : ""}`
  });

  // Bevestiging naar klant
  await resend.emails.send({
    from: "DMJ Outdoor <noreply@dmjoutdoor.nl>",
    to: client.email,
    subject: `Bevestiging bestelling ${orderNr}`,
    text: `Beste ${client.name.split(" ")[0]},\n\nBedankt voor uw bestelling!\n\nOrdernummer: ${orderNr}\n\nProducten:\n${itemLines}\n\nTotaal: €${total.toFixed(2)}\n\nWij nemen zo spoedig mogelijk contact op.\n\nMet vriendelijke groet,\nMike — DMJ Outdoor BV`
  });

  res.json({ success: true, orderNr });
});

// ─── BESTELLINGEN (admin) ─────────────────────────────────────
app.get("/api/orders", async (req, res) => {
  const orders = await prisma.order.findMany({
    include: { client: true, items: true },
    orderBy: { createdAt: "desc" }
  });
  res.json(orders);
});

app.patch("/api/orders/:id", async (req, res) => {
  const order = await prisma.order.update({
    where: { id: parseInt(req.params.id) },
    data: { status: req.body.status }
  });
  res.json(order);
});

// ─── KLANTEN (admin) ──────────────────────────────────────────
app.get("/api/clients", async (req, res) => {
  const clients = await prisma.client.findMany({
    include: { collections: true, orders: true }
  });
  res.json(clients);
});

app.post("/api/clients", async (req, res) => {
  const { name, email, note, collectionIds } = req.body;
  const token = crypto.randomBytes(16).toString("hex");
  const client = await prisma.client.create({
    data: {
      name, email, token, note,
      collections: {
        create: collectionIds.map(id => ({ collectionId: id }))
      }
    }
  });
  res.json(client);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server draait op poort ${PORT}`));