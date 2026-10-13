// Vercel Serverless Function: принимает заявку с сайта и отправляет её в Telegram.
// Переменные окружения (Vercel → Settings → Environment Variables):
//   TG_BOT_TOKEN  — токен от @BotFather
//   TG_CHAT_ID    — id чата/группы; можно несколько через запятую: 123,-100456
//   ALLOWED_ORIGIN — (необязательно) адрес сайта, например https://example.ru

const hits = new Map(); // простая защита от флуда: 5 заявок в 10 минут с одного IP

const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

export default async function handler(req, res) {
  const origin = process.env.ALLOWED_ORIGIN;
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  }
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false });

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 600000);
  if (recent.length >= 5) return res.status(429).json({ ok: false, error: "too_many" });
  hits.set(ip, [...recent, now]);

  const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const name = String(b.name || "").trim().slice(0, 100);
  const phone = String(b.phone || "").replace(/\D/g, "");
  const email = String(b.email || "").trim().slice(0, 100);
  const type = String(b.type || "").slice(0, 50);
  const text = String(b.text || "").trim().slice(0, 1500);

  if (b.website) return res.status(200).json({ ok: true }); // honeypot
  if (name.length < 2 || phone.length !== 11 || !b.agree) {
    return res.status(400).json({ ok: false, error: "invalid" });
  }
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ ok: false, error: "invalid_email" });
  }

  const when = new Date().toLocaleString("ru-RU", { timeZone: "Asia/Omsk" });
  const msg =
    `📩 <b>Новая заявка</b>\n` +
    `<b>Имя:</b> ${esc(name)}\n` +
    `<b>Телефон:</b> +${phone}\n` +
    (email ? `<b>E-mail:</b> ${esc(email)}\n` : "") +
    `<b>Тип:</b> ${esc(type)}\n` +
    (text ? `<b>Вопрос:</b> ${esc(text)}\n` : "") +
    `<i>${when} (Омск)</i>`;

  const token = process.env.TG_BOT_TOKEN;
  const chats = (process.env.TG_CHAT_ID || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!token || !chats.length) return res.status(500).json({ ok: false, error: "not_configured" });

  try {
    const results = await Promise.all(
      chats.map((chat_id) =>
        fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id, text: msg, parse_mode: "HTML", disable_web_page_preview: true }),
        })
      )
    );
    if (!results.some((r) => r.ok)) throw new Error("telegram_failed");
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(502).json({ ok: false, error: "send_failed" });
  }
}
