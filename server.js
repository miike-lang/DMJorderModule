import "dotenv/config";
import express from "express";
import cors from "cors";
import pg from "pg";
import { Resend } from "resend";
import crypto from "crypto";

const app = express();
const { Pool } = pg;

const pool = new Pool({
  connectionString: "postgresql://postgres:fDxMcwpNpIIpVPqfjQwqwqxKhblxPYNo@shuttle.proxy.rlwy.net:48338/railway",
  ssl: false
});

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

app.use(cors());
app.use(express.json());

app.get("/api/products", async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM "Product"');
  res.json(rows);
});

app.get("/api/collections", async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM "Collection"');
  res.json(rows);
});

app.get("/api/client/:token", async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM "Client" WHERE token = $1', [req.params.token]);
  if (!rows.length) return res.status(404).json({ error: "Niet gevonden" });
  res.json(rows[0]);
});

app.get("/api/orders", async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM "Order" ORDER BY "createdAt" DESC');
  res.json(rows);
});

app.patch("/api/orders/:id", async (req, res) => {
  const { rows } = await pool.query('UPDATE "Order" SET status = $1 WHERE id = $2 RETURNING *', [req.body.status, req.params.id]);
  res.json(rows[0]);
});

app.post("/api/orders", async (req, res) => {
  const { token, items, note } = req.body;
  const { rows: clients } = await pool.query('SELECT * FROM "Client" WHERE token = $1', [token]);
  if (!clients.length) return res.status(404).json({ error: "Klant niet gevonden" });
  const client = clients[0];

  const total = items.reduce((s, i) => s + i.price * i.qty, 0);
  const orderNr = `ORD-${Date.now()}`;

  const { rows: orders } = await pool.query(
    'INSERT INTO "Order" ("orderNr", "clientId", total, note, status) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [orderNr, client.id, total, note || null, "Nieuw"]
  );

  for (const i of items) {
    await pool.query(
      'INSERT INTO "OrderItem" ("orderId", "productId", sku, name, price, qty) VALUES ($1, $2, $3, $4, $5, $6)',
      [orders[0].id, i.id, i.sku, i.name, i.price, i.qty]
    );
  }

  const itemLines = items.map(i => `• ${i.name} (${i.sku}) — ${i.qty}× — €${(i.price * i.qty).toFixed(2)}`).join("\n");

  if (resend) {
    await resend.emails.send({
      from: "DMJ Showroom <noreply@dmjoutdoor.nl>",
      to: [process.env.ADMIN_EMAIL, process.env.ADMIN_EMAIL2],
      subject: `Nieuwe bestelling ${orderNr} — ${client.name}`,
      text: `Nieuwe bestelling!\n\nOrdernummer: ${orderNr}\nKlant: ${client.name}\nEmail: ${client.email}\n\nProducten:\n${itemLines}\n\nTotaal: €${total.toFixed(2)}`
    });
  }

  res.json({ success: true, orderNr });
});

app.get("/api/clients", async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM "Client"');
  res.json(rows);
});

app.post("/api/clients", async (req, res) => {
  const { name, email, note } = req.body;
  const token = crypto.randomBytes(16).toString("hex");
  const { rows } = await pool.query(
    'INSERT INTO "Client" (name, email, token, note) VALUES ($1, $2, $3, $4) RETURNING *',
    [name, email, token, note || null]
  );
  res.json(rows[0]);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server draait op poort ${PORT}`));