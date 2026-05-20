// ============================================
// Vega CRM Analytics Bot v5.3
// Features: Pipeline Filtering + Anti-Hallucination + Compact Format
// ============================================
console.log('🚀 [INIT] Vega CRM Analytics Bot v5.3...');

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
  console.error('❌ [FATAL] Missing ENV vars'); process.exit(1);
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
// 📦 DATA LAYERS
// ============================================
async function fetchHotData(days = 30, categoryId = null) {
  try {
    const dateFrom = new Date(Date.now() - days*86400000).toISOString().split('T')[0];
    const url = `${B24_WEBHOOK}crm.deal.list.json`;
    let all = [], start = 0;
    
    const filter = { '>=DATE_CREATE': dateFrom };
    if (categoryId) filter.CATEGORY_ID = categoryId;
    
    while (true) {
      const res = await axios.post(url, {
        order: { DATE_CREATE: 'DESC' }, filter,
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
    const res = {};
    years.forEach(y => {
      if (raw[y]) {
        if (categoryId && raw[y].byPipeline?.[categoryId]) {
          res[y] = { byPipeline: { [categoryId]: raw[y].byPipeline[categoryId] } };
        } else if (!categoryId) {
          res[y] = raw[y];
        }
      }
    });
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
// 🧠 LAYERED AI REQUEST + ANTI-HALLUCINATION
// ============================================
async function askAI(query, layers, context = {}) {
  const isComplex = query.length > 40 || query.match(/статистик|анализ|прогноз|топ|конверс|сумм|менеджер|тренд|сравн/i);
  const model = isComplex ? 'qwen-plus' : 'qwen-turbo';
  
  let contextStr = '';
  if (layers.cold && Object.keys(layers.cold).length > 0) contextStr += `📊 COLD:\n${JSON.stringify(layers.cold).slice(0, 6000)}\n\n`;
  if (layers.warm && layers.warm.length > 0) contextStr += `🌤 WARM:\n${JSON.stringify(layers.warm.slice(0, 80)).slice(0, 5000)}\n\n`;
  if (layers.hot && layers.hot.length > 0) contextStr += `🔥 HOT:\n${JSON.stringify(layers.hot.slice(0, 50)).slice(0, 4000)}\n`;

  const selectedPipeline = context.selectedPipeline ? ` (воронка: ${context.selectedPipeline})` : '';

  const system = `Ты — AI-аналитик CRM отеля Vega${selectedPipeline}.

⚠️ КРИТИЧЕСКИ ВАЖНО:
• НИКОГДА не выдумывай цифры, имена, проценты или суммы
• Если данных нет — честно напиши "Нет данных" или пропусти блок
• НЕ показывай пустую структуру с "—" — лучше скажи, чего не хватает
• Работай ТОЛЬКО с переданными JSON-данными

📋 ФОРМАТ (показывай ТОЛЬКО если есть реальные данные):
📊 [Заголовок] за [период]

🏆 ОБЩИЕ ИТОГИ: [показывай, если есть хотя бы 1 показатель]
💰 Выручка: [сумма] ₽ [если есть]
 Сделки: [кол-во] [если есть]
✅ Конверсия: [%] [если есть]

📊 ПО ВОРОНКАМ: [показывай ТОЛЬКО запрошенную, если данные есть]
[Эмодзи] [Название] ([ID])
   • Лиды: [N] [если есть]
   • Конверсия: [%] [если есть]
   • Выручка: [сумма] ₽ [если есть]
   • Средний чек: [сумма] ₽ [если есть]

💡 РЕКОМЕНДАЦИИ: [2-3 вывода на основе РЕАЛЬНЫХ цифр]

🎨 СТИЛЬ:
• Максимум 25 строк, компактно
• Числа: 124 580 000 ₽ (с пробелами)
• Если данных мало: "⚠️ Доступно только [N] показателей. Обновите экспорт для полного анализа."
• Не добавляй вступлений/прощаний — сразу отчёт`;

  try {
    const res = await axios.post(`${QWEN_BASE_URL}/chat/completions`, {
      model, messages: [{role:'system', content:system}, {role:'user', content:`Запрос: "${query}"\n\nДанные:\n${contextStr}`}],
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
app.get('/', (req, res) => res.json({ status: 'ok', v: '5.3' }));
app.get('/health', (req, res) => res.json({ status: 'healthy', uptime: process.uptime() }));

bot.start(ctx => ctx.reply(
  `*👋 Vega CRM Bot v5.3*\n\n Слои: 🔥Hot / 🌤Warm / ❄️Cold\nВоронки: 17=Индивидуалы, 2=Группы, 4=Мероприятия\n\nПримеры:\n"Статистика по группам за 2024"\n"Тренд по всем воронкам 5 лет"\n"Сравнение 2024 vs 2025"`,
  { parse_mode: 'Markdown' }
));

bot.on('text', async ctx => {
  const query = ctx.message.text.trim();
  if (process.uptime() < 60) await ctx.reply('🔋 Сервер просыпается... ⏳');
  else await ctx.reply('⏳ Генерирую отчёт...');

  const route = routeQuery(query);
  const layers = {};
  
  // 🔍 Определяем воронку по ключевым словам
  let categoryId = null;
  const q = query.toLowerCase();
  if (q.includes('индивидуал') || q.includes('частн') || q.includes('физлиц')) categoryId = '17';
  else if (q.includes('групп')) categoryId = '2';
  else if (q.includes('мероприят') || q.includes('корпорат') || q.includes('конференц') || q.includes('ивент')) categoryId = '4';
  
  // Загружаем данные с учётом фильтра
  if (route.layer === 'hot' || route.layer === 'all') {
    layers.hot = await fetchHotData(route.days || 30, categoryId);
  }
  if (route.layer === 'warm' || route.layer === 'all') {
    layers.warm = await loadWarmData(categoryId);
  }
  if (route.layer === 'cold' || route.layer === 'all') {
    layers.cold = await loadColdData([route.year].filter(Boolean) || ['2021','2022','2023','2024','2025'], categoryId);
  }

  // Проверка: есть ли хоть какие-то данные
  const hasData = (layers.hot?.length > 0) || (layers.warm?.length > 0) || (layers.cold && Object.keys(layers.cold).length > 0);
  if (!hasData) {
    return ctx.reply(`⚠️ Нет данных для анализа${categoryId ? ` по воронке "${PIPELINES[categoryId]}"` : ''} за запрошенный период.\n\nПроверьте:\n• Корректность дат в запросе\n• Наличие сделок в CRM\n• Актуальность экспорта истории`);
  }

  const answer = await askAI(query, layers, { selectedPipeline: categoryId ? PIPELINES[categoryId] : null });
  await ctx.reply(answer, { parse_mode: 'Markdown' });
});

bot.launch();
app.listen(PORT, () => console.log(`✅ Server v5.3 running :${PORT}`));
process.on('uncaughtException', () => process.exit(1));
