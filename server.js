// ============================================
// Vega CRM Analytics Bot v6.0
// Features: Quarters, Category 0 Support, Funnel Context
// ============================================
console.log('🚀 [INIT] Vega CRM Analytics Bot v6.0...');

const express = require('express');
const { Telegraf } = require('telegraf');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');

const BOT_TOKEN = process.env.BOT_TOKEN;
const QWEN_KEY = process.env.QWEN_API_KEY;
const QWEN_BASE_URL = process.env.QWEN_BASE_URL || 'https://ws-l60ae5307m8kjrb3.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1';
const B24_WEBHOOK = process.env.B24_WEBHOOK_URL;

const PIPELINES = { 
  '0': 'Индивидуалы (Старая)', 
  '17': 'Индивидуалы (Новая)', 
  '2': 'Группы', 
  '4': 'Мероприятия' 
};

if (!BOT_TOKEN || !QWEN_KEY || !B24_WEBHOOK) {
  console.error(' [FATAL] Missing ENV vars'); process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// ============================================
// 🛡️ ANTI-SLEEP
// ============================================
if (process.env.KEEP_ALIVE !== 'false') {
  setInterval(async () => { try { await axios.get(`http://localhost:${PORT}/health`); } catch {} }, 40 * 60 * 1000);
}

// ============================================
//  DATA LAYERS
// ============================================
// Функция нормализации ключей (убирает пробелы типа "2022 ")
function normalizeKeys(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const res = {};
  for (const k in obj) res[k.trim()] = normalizeKeys(obj[k]);
  return res;
}

async function fetchHotData(days = 30, categoryId = null) {
  try {
    const dateFrom = new Date(Date.now() - days*86400000).toISOString().split('T')[0];
    const url = `${B24_WEBHOOK}crm.deal.list.json`;
    let all = [], start = 0;
    const filter = { '>=DATE_CREATE': dateFrom };
    if (categoryId) filter.CATEGORY_ID = categoryId;
    
    while (true) {
      const res = await axios.post(url, { order: { DATE_CREATE: 'DESC' }, filter, select: ['ID','TITLE','OPPORTUNITY','STAGE_ID','CATEGORY_ID','ASSIGNED_BY_ID','DATE_CREATE','CLOSED'], start }, { timeout: 15000 });
      const deals = res.data.result || [];
      if (!deals.length) break;
      all = all.concat(deals.map(d => ({ id:d.ID, t:(d.TITLE||'').slice(0,50), a:+d.OPPORTUNITY||0, s:d.STAGE_ID, p:d.CATEGORY_ID, m:d.ASSIGNED_BY_ID, d:d.DATE_CREATE, c:d.CLOSED })));
      start += 50; if (deals.length < 50) break;
    }
    return all;
  } catch (e) { return []; }
}

async function loadWarmData(categoryId = null) {
  try {
    const buf = fs.readFileSync(path.join(DATA_DIR, 'history-2024-2025.json.gz'));
    const data = JSON.parse(zlib.gunzipSync(buf).toString());
    return categoryId ? data.filter(d => d.p === categoryId) : data;
  } catch { return []; }
}

async function loadColdData(years = ['2021','2022','2023','2024','2025'], categoryId = null) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'aggregates-2021-2025.json'), 'utf8'));
    const cleaned = normalizeKeys(raw); // Нормализация ключей!
    const res = {};
    years.forEach(y => {
      if (cleaned[y]) {
        if (categoryId && cleaned[y].byPipeline?.[categoryId]) {
          res[y] = { byPipeline: { [categoryId]: cleaned[y].byPipeline[categoryId] }, byQuarter: cleaned[y].byQuarter };
        } else if (!categoryId) {
          res[y] = cleaned[y];
        }
      }
    });
    return res;
  } catch { return {}; }
}

// ============================================
//  ROUTER
// ============================================
function routeQuery(query) {
  const q = query.toLowerCase();
  const yearMatch = q.match(/(2021|2022|2023|2024|2025)/);
  const year = yearMatch ? yearMatch[1] : null;
  const quarterMatch = q.match(/(1|2|3|4)\s*квартал|q[1-4]/i);
  
  if (year) {
    if (['2024','2025'].includes(year)) return { layer: 'warm', year, quarter: quarterMatch };
    return { layer: 'cold', year, quarter: quarterMatch };
  }
  if (q.match(/сегодня|вчера|недел|3 дня/)) return { layer: 'hot', days: 7 };
  if (q.match(/месяц|квартал/)) return { layer: 'warm' }; // Дефолт на Warm если год не указан
  if (q.match(/тренд|5 лет/)) return { layer: 'cold' };
  return { layer: 'hot', days: 30 };
}

// ============================================
// 🧠 AI REQUEST + FUNNEL CONTEXT
// ============================================
async function askAI(query, layers, context = {}) {
  const isComplex = query.length > 40 || query.match(/статистик|анализ|прогноз|топ|конверс|сумм|менеджер|тренд|сравн/i);
  const model = isComplex ? 'qwen-plus' : 'qwen-turbo';
  
  let contextStr = '';
  if (layers.cold && Object.keys(layers.cold).length > 0) contextStr += `📊 COLD (Агрегаты с Кварталами):\n${JSON.stringify(layers.cold).slice(0, 6000)}\n\n`;
  if (layers.warm && layers.warm.length > 0) contextStr += `🌤 WARM (Детали 24-25):\n${JSON.stringify(layers.warm.slice(0, 80)).slice(0, 5000)}\n\n`;
  if (layers.hot && layers.hot.length > 0) contextStr += ` HOT (Свежие):\n${JSON.stringify(layers.hot.slice(0, 50)).slice(0, 4000)}\n`;

  const selectedPipeline = context.selectedPipeline ? ` (Воронка: ${context.selectedPipeline})` : '';

  const system = `Ты — AI-аналитик CRM отеля Vega${selectedPipeline}.

⚠️ СТРУКТУРА ВОРОНОК (CATEGORY_ID):
1. "0" = Индивидуалы (Старая/Легаси). Закрыта с Ноября 2025. Не считай эти сделки активными продажами, только история.
2. "17" = Индивидуалы (Новая/Вега). Активна с Ноября 2025.
3. "2" = Группы. Активна.
4. "4" = Мероприятия. Активна.

️ ПРАВИЛА:
• Используй данные из поля "byQuarter" (Q1, Q2, Q3, Q4) для кварталов.
• НИКОГДА не выдумывай данные.
• Если блок пуст — пропусти его.

📋 ФОРМАТ:
📊 Заголовок
🏆 ИТОГИ: Выручка, Сделки, Конверсия
📊 ПО ВОРОНКАМ: (только запрошенная или все)
💡 РЕКОМЕНДАЦИИ
📅 СРАВНЕНИЕ (если есть данные)`;

  try {
    const res = await axios.post(`${QWEN_BASE_URL}/chat/completions`, {
      model, messages: [{role:'system', content:system}, {role:'user', content:`Запрос: "${query}"\n\nДанные:\n${contextStr}`}],
      max_tokens: 1500, temperature: 0.7
    }, { headers: { 'Authorization': `Bearer ${QWEN_KEY}`, 'Content-Type': 'application/json' }, timeout: 60000 });
    return res.data.choices[0].message.content;
  } catch (e) {
    console.error('💥 AI:', e.message);
    return '❌ Ошибка AI.';
  }
}

// ============================================
// 📡 HANDLERS
// ============================================
app.get('/', (req, res) => res.json({ status: 'ok', v: '6.0' }));
app.get('/health', (req, res) => res.json({ status: 'healthy' }));

bot.start(ctx => ctx.reply(`*👋 Vega CRM Bot v6.0*\n\n🗂 Воронки:\n• 0: Инд. (Старая)\n• 17: Инд. (Новая)\n• 2: Группы\n• 4: Мероприятия\n\nЗапрос: "Статистика по группам за Q1 2024"`, { parse_mode: 'Markdown' }));

bot.on('text', async ctx => {
  const query = ctx.message.text.trim();
  if (process.uptime() < 60) await ctx.reply(' Пробуждение...');
  else await ctx.reply('⏳ Генерация отчета...');

  const route = routeQuery(query);
  const layers = {};
  
  let categoryId = null;
  const q = query.toLowerCase();
  if (q.includes('групп')) categoryId = '2';
  else if (q.includes('мероприят')) categoryId = '4';
  else if (q.includes('индивидуал') || q.includes('частн')) categoryId = '0'; // Дефолт на старую, если не уточнено, но лучше грузить обе
  
  // Если запрос про индивидуалов - грузим обе категории (0 и 17)
  if (q.includes('индивидуал') || q.includes('частн')) {
    layers.hot = await fetchHotData(route.days || 30); // Горячие грузим все, фильтрация внутри AI или пост-обработка
    layers.warm = await loadWarmData();
    layers.cold = await loadColdData();
  } else {
    if (route.layer === 'hot') layers.hot = await fetchHotData(route.days || 30, categoryId);
    if (route.layer === 'warm') layers.warm = await loadWarmData(categoryId);
    if (route.layer === 'cold') layers.cold = await loadColdData([route.year].filter(Boolean), categoryId);
  }

  const answer = await askAI(query, layers, { selectedPipeline: categoryId ? PIPELINES[categoryId] : null });
  await ctx.reply(answer, { parse_mode: 'Markdown' });
});

bot.launch();
app.listen(PORT, () => console.log(`✅ Server v6.0 running :${PORT}`));
