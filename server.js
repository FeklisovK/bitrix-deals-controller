// ============================================
// Vega CRM Analytics Bot v5.2
// Architecture: 3-Layer Data + Compact Reporting Format
// ============================================
console.log('🚀 [INIT] Vega CRM Analytics Bot v5.2...');

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

const PIPELINES = { '17': 'Индивидуалы', '2': 'Группы', '4': 'Мероприятия' };

if (!BOT_TOKEN || !QWEN_KEY || !B24_WEBHOOK) {
  console.error(' [FATAL] Missing ENV vars'); process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// ============================================
// 🛡️ ANTI-SLEEP (Keep-Alive)
// ============================================
if (process.env.KEEP_ALIVE !== 'false') {
  setInterval(async () => {
    try { await axios.get(`http://localhost:${PORT}/health`); } catch {}
  }, 40 * 60 * 1000);
}

// ============================================
//  DATA LAYERS
// ============================================
async function fetchHotData(days = 30) {
  try {
    const dateFrom = new Date(Date.now() - days*86400000).toISOString().split('T')[0];
    const url = `${B24_WEBHOOK}crm.deal.list.json`;
    let all = [], start = 0;
    while (true) {
      const res = await axios.post(url, {
        order: { DATE_CREATE: 'DESC' }, filter: { '>=DATE_CREATE': dateFrom },
        select: ['ID','TITLE','OPPORTUNITY','STAGE_ID','CATEGORY_ID','ASSIGNED_BY_ID','DATE_CREATE','CLOSED'], start
      }, { timeout: 15000 });
      const deals = res.data.result || [];
      if (!deals.length) break;
      all = all.concat(deals.map(d => ({
        id:d.ID, t:(d.TITLE||'').slice(0,50), a:+d.OPPORTUNITY||0, s:d.STAGE_ID,
        p:d.CATEGORY_ID, m:d.ASSIGNED_BY_ID, d:d.DATE_CREATE, c:d.CLOSED
      })));
      start += 50;
      if (deals.length < 50) break;
    }
    return all;
  } catch (e) { return []; }
}

async function loadWarmData() {
  try {
    const buf = fs.readFileSync(path.join(DATA_DIR, 'history-2024-2025.json.gz'));
    return JSON.parse(zlib.gunzipSync(buf).toString());
  } catch { return []; }
}

async function loadColdData(years = ['2021','2022','2023','2024','2025']) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'aggregates-2021-2025.json'), 'utf8'));
    const res = {};
    years.forEach(y => { if (raw[y]) res[y] = raw[y]; });
    return res;
  } catch { return {}; }
}

// ============================================
// 🧭 ROUTER
// ============================================
function routeQuery(query) {
  const q = query.toLowerCase();
  const yearMatch = q.match(/(2021|2022|2023|2024|2025)/);
  const year = yearMatch ? yearMatch[1] : null;
  const monthMatch = q.match(/(январ[яь]|феврал[яь]|март[ае]?|апрел[яь]|ма[яй]|июн[яь]|июл[яь]|август[ае]?|сентябр[яь]|октябр[яь]|ноябр[яь]|декабр[яь])/);
  
  if (monthMatch && year) {
    if (['2024','2025'].includes(year)) return { layer: 'warm', year, month: monthMatch[1] };
    if (['2021','2022','2023'].includes(year)) return { layer: 'cold', year, month: monthMatch[1] };
  }
  if (year) {
    if (['2024','2025'].includes(year)) return { layer: 'warm', year };
    if (['2021','2022','2023'].includes(year)) return { layer: 'cold', year };
  }
  if (q.match(/сегодня|вчера|недел|3 дня|последн.*день|72 часа/)) return { layer: 'hot', days: 7 };
  if (q.match(/месяц|квартал|полгода/)) return { layer: 'warm' };
  if (q.match(/тренд|динамика|2021|2022|2023|история.*3.*год|год-к-году|5 лет/)) return { layer: 'cold' };
  if (q.match(/все данные|полный анализ|максимум/)) return { layer: 'all' };
  return { layer: 'hot', days: 30 };
}

// ============================================
// 🧠 LAYERED AI REQUEST + COMPACT FORMAT
// ============================================
async function askAI(query, layers) {
  const isComplex = query.length > 40 || query.match(/статистик|анализ|прогноз|топ|конверс|сумм|менеджер|тренд|сравн/i);
  const model = isComplex ? 'qwen-plus' : 'qwen-turbo';
  
  let context = '';
  if (layers.cold && Object.keys(layers.cold).length > 0) context += `📊 COLD (Агрегаты):\n${JSON.stringify(layers.cold).slice(0, 6000)}\n\n`;
  if (layers.warm && layers.warm.length > 0) context += `🌤 WARM (Детали 24-25):\n${JSON.stringify(layers.warm.slice(0, 80)).slice(0, 5000)}\n\n`;
  if (layers.hot && layers.hot.length > 0) context += ` HOT (Свежие):\n${JSON.stringify(layers.hot.slice(0, 50)).slice(0, 4000)}\n`;

  const system = `Ты — AI-аналитик CRM отеля Vega. Отвечай СТРОГО по шаблону ниже. Не добавляй лишних вступлений или прощаний.

📋 ФОРМАТ ОТВЕТА:
📊 Заголовок + Период
🏆 ОБЩИЕ ИТОГИ:
💰 Выручка: [сумма] ₽ ([%] к прошлому/плану)
 Сделки: [кол-во] ([%] динамика)
✅ Конверсия: [%] ([±] п.п.)

📊 ПО ВОРОНКАМ:
[Эмодзи] [Название] ([ID])
   • Лиды: [N] ([%] от всех)
   • Конверсия: [%] ([🌟/✅/⚠️])
   • Выручка: [сумма] ₽ ([%] доли)
   • Средний чек: [сумма] ₽
(Повторить для 17, 2, 4)

🏆 ТОП-3 МЕНЕДЖЕРА: (если есть данные)
1. [Имя/ID] — [N] сделок | [сумма] ₽
2. ...
3. ...

💡 РЕКОМЕНДАЦИИ AI:
🎯 [Конкретная рекомендация 1]
 [Конкретная рекомендация 2]
📈 [Конкретная рекомендация 3]

📅 СРАВНЕНИЕ С ЦЕЛЯМИ/ПРОШЛЫМ ГОДОМ:
💰 План: [сумма] | Факт: [сумма] ([%] выполнения)
 Дефицит/Избыток: [сумма]
📅 Осталось дней: [N], необходимый темп: [сумма]/день

🎨 ПРАВИЛА:
1. Максимум 35-40 строк. Компактно, без воды.
2. Числа с пробелами: 124 580 000 ₽. Миллионы: 124.58 млн ₽.
3. Используй эмодзи только как маркеры, не перегружай.
4. Если данных нет для блока — пиши "—".
5. Анализируй только переданные JSON-данные.`;

  try {
    const res = await axios.post(`${QWEN_BASE_URL}/chat/completions`, {
      model, messages: [{role:'system', content:system}, {role:'user', content:`Запрос: "${query}"\n\nДанные:\n${context}`}],
      max_tokens: 1500, temperature: 0.7
    }, { headers: { 'Authorization': `Bearer ${QWEN_KEY}`, 'Content-Type': 'application/json' }, timeout: 60000 });
    return res.data.choices[0].message.content;
  } catch (e) {
    console.error('💥 AI:', e.message);
    return '❌ Ошибка AI. Попробуйте позже.';
  }
}

// ============================================
// 📡 HANDLERS
// ============================================
app.get('/', (req, res) => res.json({ status: 'ok', v: '5.2' }));
app.get('/health', (req, res) => res.json({ status: 'healthy', uptime: process.uptime() }));

bot.start(ctx => ctx.reply(
  `*👋 Vega CRM Bot v5.2*\n\n Слои: 🔥Hot / 🌤Warm / ❄️Cold\n\nПримеры:\n"Статистика за 2024"\n"Тренд по группам 5 лет"\n"Сравнение 2024 vs 2025"`,
  { parse_mode: 'Markdown' }
));

bot.on('text', async ctx => {
  const query = ctx.message.text.trim();
  if (process.uptime() < 60) await ctx.reply('🔋 Сервер просыпается... ⏳');
  else await ctx.reply('⏳ Генерирую отчёт...');

  const route = routeQuery(query);
  const layers = {};
  
  if (route.layer === 'hot' || route.layer === 'all') layers.hot = await fetchHotData(route.days || 30);
  if (route.layer === 'warm' || route.layer === 'all') layers.warm = await loadWarmData();
  if (route.layer === 'cold' || route.layer === 'all') layers.cold = await loadColdData();

  const answer = await askAI(query, layers);
  await ctx.reply(answer, { parse_mode: 'Markdown' });
});

bot.launch();
app.listen(PORT, () => console.log(`✅ Server v5.2 running :${PORT}`));
process.on('uncaughtException', () => process.exit(1));
