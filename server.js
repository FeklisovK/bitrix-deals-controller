// ============================================
// Vega CRM Analytics Bot v4.0
// Features: Anti-Sleep, Smart Models, Optimized Payload
// ============================================
console.log('🚀 [INIT] Запуск Vega CRM Analytics Bot v4.0...');

const express = require('express');
const { Telegraf } = require('telegraf');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// 🔑 Конфигурация
const BOT_TOKEN = process.env.BOT_TOKEN;
const QWEN_KEY = process.env.QWEN_API_KEY;
const QWEN_BASE_URL = process.env.QWEN_BASE_URL || 'https://ws-l60ae5307m8kjrb3.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1';
const B24_WEBHOOK = process.env.B24_WEBHOOK_URL;

// 🗺 Карта воронок
const PIPELINES = {
  '17': 'Индивидуалы',
  '2': 'Группы',
  '4': 'Мероприятия'
};

if (!BOT_TOKEN || !QWEN_KEY || !B24_WEBHOOK) {
  console.error('❌ [FATAL] Missing ENV vars');
  process.exit(1);
}

// 🤖 Bot Init
const bot = new Telegraf(BOT_TOKEN);

// ============================================
// 🛡️ ANTI-SLEEP: Keep-Alive Mechanism
// ============================================
// Серверы Black Hole засыпают через 1 час. Пингуем себя каждые 40 мин.
if (process.env.KEEP_ALIVE !== 'false') {
  const KEEP_ALIVE_INTERVAL = 40 * 60 * 1000; // 40 минут
  
  setInterval(async () => {
    try {
      await axios.get(`http://localhost:${PORT}/health`);
      console.log('💓 [KEEP-ALIVE] Server awake');
    } catch (err) {
      console.error('⚠️ [KEEP-ALIVE] Ping failed', err.message);
    }
  }, KEEP_ALIVE_INTERVAL);
  
  console.log(`💤 [CONFIG] Anti-sleep enabled (ping every ${KEEP_ALIVE_INTERVAL/1000}s)`);
}

// ============================================
// 📥 Fetch Data (Optimized)
// ============================================
async function fetchCRMData({ dateFrom = null, limit = 300, categoryId = null } = {}) {
  try {
    console.log(` [B24] Fetching (limit: ${limit})...`);
    const url = `${B24_WEBHOOK}crm.deal.list.json`;
    const filter = {};
    if (dateFrom) filter['>=DATE_CREATE'] = dateFrom;
    if (categoryId) filter['CATEGORY_ID'] = categoryId;
    
    let allDeals = [];
    let start = 0;
    
    while (allDeals.length < limit) {
      const response = await axios.post(url, {
        order: { DATE_CREATE: "DESC" },
        filter,
        select: ["ID", "TITLE", "OPPORTUNITY", "STAGE_ID", "CATEGORY_ID", "ASSIGNED_BY_ID", "DATE_CREATE", "CLOSED"],
        start
      }, { timeout: 15000 });
      
      const deals = response.data.result || [];
      if (deals.length === 0) break;
      
      // ⚡ OPTIMIZATION: Map to minimal structure immediately
      const mapped = deals.map(d => ({
        id: d.ID,
        t: d.TITLE,            // Title
        a: parseFloat(d.OPPORTUNITY) || 0, // Amount
        s: d.STAGE_ID,         // Stage
        p: d.CATEGORY_ID,      // Pipeline ID
        m: d.ASSIGNED_BY_ID,   // Manager
        d: d.DATE_CREATE,      // Date
        c: d.CLOSED            // Closed status
      }));
      
      allDeals = allDeals.concat(mapped);
      start += 50;
      if (deals.length < 50) break;
      await new Promise(r => setTimeout(r, 200));
    }
    
    console.log(`✅ [B24] Fetched ${allDeals.length} deals`);
    return allDeals;
  } catch (err) {
    console.error('💥 [B24] Error:', err.message);
    return [];
  }
}

// ============================================
// 🧠 Smart AI Request
// ============================================
async function askAI(query, deals, context = {}) {
  // 🧠 SMART MODEL SELECTION
  // Используем qwen-turbo для простых вопросов, qwen-plus для аналитики
  const isComplex = query.length > 50 || 
                    query.match(/статистик|анализ|прогноз|топ|конверс|деньг|сумм|менеджер/i);
  
  const model = isComplex ? 'qwen-plus' : 'qwen-turbo';
  console.log(`🤖 [AI] Model: ${model} (Complex: ${isComplex})`);

  // ⚡ PAYLOAD OPTIMIZATION
  // Отправляем только компактный JSON, обрезая лишнее
  let dataStr = JSON.stringify(deals);
  if (dataStr.length > 10000) {
    console.log('️ [AI] Data too large, truncating...');
    // Берем только первые N сделок если данных слишком много
    dataStr = JSON.stringify(deals.slice(0, 100)); 
  }

  const systemPrompt = `Ты — AI-аналитик CRM отеля Vega.
Воронки: Индивидуалы(17), Группы(2), Мероприятия(4).
Отвечай кратко, по делу, на русском. Используй Markdown.`;

  const userPrompt = `Вопрос: "${query}"\nДанные (${deals.length} сделок):\n${dataStr}`;

  try {
    const response = await axios.post(
      `${QWEN_BASE_URL}/chat/completions`,
      {
        model: model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 1500,
        temperature: 0.7
      },
      {
        headers: { 'Authorization': `Bearer ${QWEN_KEY}`, 'Content-Type': 'application/json' },
        timeout: 60000 // 60 сек
      }
    );
    return response.data.choices[0].message.content;
  } catch (err) {
    console.error('💥 [AI] Error:', err.message);
    return '❌ Ошибка AI. Попробуйте позже.';
  }
}

// ============================================
// 📡 Endpoints & Handlers
// ============================================
app.get('/', (req, res) => res.json({ status: 'ok', version: '4.0' }));
app.get('/health', (req, res) => res.json({ status: 'healthy', uptime: process.uptime() }));

bot.start((ctx) => ctx.reply(
  '*👋 Привет! Я AI-аналитик Vega CRM v4.0*\n\n' +
  'Воронки:\n• 🏨 Индивидуалы\n• 👥 Группы\n• 🎉 Мероприятия\n\n' +
  'Спросите: "Статистика", "Топ сделок", "Анализ групп"',
  { parse_mode: 'Markdown' }
));

bot.on('text', async (ctx) => {
  const query = ctx.message.text.trim();
  
  // ⚠️ SLEEP CHECK: Если сервер только проснулся
  if (process.uptime() < 60) {
    await ctx.reply(' Сервер только проснулся... Загрузка данных может занять чуть больше времени. ⏳');
  } else {
    await ctx.reply(' Анализирую данные...');
  }

  // Parsing logic (simplified for v4.0)
  let categoryId = null;
  if (query.toLowerCase().includes('групп')) categoryId = '2';
  else if (query.toLowerCase().includes('мероприят')) categoryId = '4';
  else if (query.toLowerCase().includes('индивидуал')) categoryId = '17';

  const deals = await fetchCRMData({ limit: 300, categoryId });
  if (deals.length === 0) return ctx.reply('⚠️ Нет данных.');

  const answer = await askAI(query, deals);
  await ctx.reply(answer, { parse_mode: 'Markdown' });
});

bot.launch();
app.listen(PORT, () => console.log(`✅ Server v4.0 running on :${PORT}`));
