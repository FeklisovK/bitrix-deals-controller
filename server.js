// ============================================
// Vega CRM Analytics Bot v3.0
// AI Assistant with Multi-Pipeline Support
// Bot: @Vega_CRM_Analytics_bot
// ============================================
console.log('🚀 [INIT] Запуск Vega CRM Analytics Bot v3.0...');

const express = require('express');
const { Telegraf } = require('telegraf');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// 🔑 Конфигурация
const BOT_TOKEN = process.env.BOT_TOKEN;
const QWEN_KEY = process.env.QWEN_API_KEY;
const QWEN_BASE_URL = process.env.QWEN_BASE_URL || 'https://ws-l60ae5307m8kjrb3.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1';
const QWEN_MODEL = process.env.QWEN_MODEL || 'qwen-plus';
const B24_WEBHOOK = process.env.B24_WEBHOOK_URL;

//  Карта воронок (CATEGORY_ID → Название)
const PIPELINES = {
  '17': 'Индивидуалы',
  '2': 'Группы',
  '4': 'Мероприятия'
};

if (!BOT_TOKEN || !QWEN_KEY || !B24_WEBHOOK) {
  console.error('❌ [FATAL] Отсутствуют необходимые переменные окружения');
  process.exit(1);
}

// 🤖 Инициализация бота
const bot = new Telegraf(BOT_TOKEN);

// ============================================
// 📥 Получение данных из Битрикс24 (расширенное)
// ============================================
async function fetchCRMData({ dateFrom = null, limit = 300, categoryId = null } = {}) {
  try {
    console.log(`📡 [B24] Запрос данных (лимит: ${limit}, категория: ${categoryId || 'все'})...`);
    
    const url = `${B24_WEBHOOK}crm.deal.list.json`;
    const filter = {};
    
    // Фильтр по дате
    if (dateFrom) {
      filter['>=DATE_CREATE'] = dateFrom;
    }
    
    // Фильтр по воронке (CATEGORY_ID)
    if (categoryId) {
      filter['CATEGORY_ID'] = categoryId;
    }
    
    let allDeals = [];
    let start = 0;
    const batchSize = 50;
    
    // Пагинация
    while (allDeals.length < limit) {
      const payload = {
        order: { DATE_CREATE: "DESC" },
        filter: filter,
        select: [
          "ID", "TITLE", "OPPORTUNITY", "STAGE_ID", 
          "CATEGORY_ID", "ASSIGNED_BY_ID", "DATE_CREATE", 
          "SOURCE_ID", "BEGINDATE", "CLOSED", "COMMENTS",
          "CONTACT", "COMPANY_TITLE", "UF_CRM_*"
        ],
        start: start
      };
      
      const response = await axios.post(url, payload, { timeout: 20000 });
      const deals = response.data.result || [];
      
      if (deals.length === 0) break;
      
      allDeals = allDeals.concat(deals);
      start += batchSize;
      
      if (deals.length < batchSize) break;
      await new Promise(resolve => setTimeout(resolve, 150)); // пауза 150ms
    }
    
    allDeals = allDeals.slice(0, limit);
    
    // Добавляем человекочитаемые названия воронок
    const dealsWithPipelines = allDeals.map(deal => ({
      ...deal,
      PIPELINE_NAME: PIPELINES[deal.CATEGORY_ID] || `Другое (${deal.CATEGORY_ID})`
    }));
    
    console.log(`✅ [B24] Получено ${dealsWithPipelines.length} сделок`);
    return dealsWithPipelines;
    
  } catch (err) {
    console.error('💥 [B24 API] Ошибка:', err.message);
    return [];
  }
}

// ============================================
// 🧠 Запрос к Qwen AI
// ============================================
async function askAI(userQuestion, crmData, context = {}) {
  const systemPrompt = `Ты — профессиональный AI-аналитик CRM для отельного бизнеса Vega.

📊 **Структура CRM:**
В системе есть 3 воронки (CATEGORY_ID):
1. **Индивидуалы** (ID: 17) — бронирования отдельных гостей
2. **Группы** (ID: 2) — групповые бронирования, тургруппы
3. **Мероприятия** (ID: 4) — корпоративы, конференции, свадьбы

📋 **Твои задачи:**
1. Анализировать сделки из CRM и отвечать на вопросы владельца бизнеса
2. Различать воронки по полю CATEGORY_ID или PIPELINE_NAME
3. Считать метрики: количество, суммы, конверсия по каждой воронке
4. Выявлять тренды и аномалии
5. Давать практические рекомендации

📝 **Правила ответов:**
1. Отвечай четко, структурированно, на русском языке
2. Используй только предоставленные данные
3. Если данных недостаточно — честно скажи об этом
4. Форматируй ответ с эмодзи и списками для Telegram
5. Используй Markdown: **жирный**, *курсив*, списки
6. Делай акцент на: количество сделок, суммы, конверсия, менеджеры, воронки
7. При сравнении воронок — показывай таблицу или список`;

  const contextStr = JSON.stringify(crmData).substring(0, 14000);
  const extraContext = Object.keys(context).length > 0 ? `\n\nДополнительный контекст:\n${JSON.stringify(context)}` : '';
  const userPrompt = `Вопрос: "${userQuestion}"\n\nДанные из CRM (${crmData.length} сделок):\n${contextStr}${extraContext}`;

  try {
    console.log('🔄 [Qwen] Отправка запроса к AI...');
    
    const response = await axios.post(
      `${QWEN_BASE_URL}/chat/completions`,
      {
        model: QWEN_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 2500,
        temperature: 0.7,
        stream: false
      },
      {
        headers: {
          'Authorization': `Bearer ${QWEN_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 40000
      }
    );
    
    console.log('✅ [Qwen] Ответ получен');
    return response.data.choices[0].message.content;
    
  } catch (err) {
    console.error('💥 [Qwen AI] Ошибка:', err.message);
    console.error('💥 [Qwen] Status:', err.response?.status);
    console.error('💥 [Qwen] Data:', JSON.stringify(err.response?.data));
    
    let errorMsg = '❌ Ошибка подключения к AI.\n\n';
    if (err.response?.status === 401) {
      errorMsg += '🔑 Неверный API ключ Qwen';
    } else if (err.response?.status === 429) {
      errorMsg += '⏱️ Превышен лимит запросов';
    } else if (err.response?.status === 400) {
      errorMsg += '📝 Ошибка формата запроса';
    } else {
      errorMsg += 'Попробуйте позже.\nДетали: ' + err.message;
    }
    return errorMsg;
  }
}

// ============================================
// 🤖 Обработчики Telegram
// ============================================
bot.start((ctx) => ctx.reply(
  '*👋 Привет! Я AI-аналитик Vega CRM*\n\n' +
  'Я анализирую данные из 3 воронок:\n' +
  '• 🏨 **Индивидуалы** — частные бронирования\n' +
  '• 👥 **Группы** — групповые заезды\n' +
  '• 🎉 **Мероприятия** — корпоративы, конференции\n\n' +
  '📊 *Примеры вопросов:*\n' +
  '• "Покажи статистику по всем воронкам"\n' +
  '• "Какая воронка приносит больше денег?"\n' +
  '• "Топ-3 менеджера по группам"\n' +
  '• "Сколько мероприятий запланировано на май?"\n' +
  '• "Конверсия по индивидуалам"',
  { parse_mode: 'Markdown' }
));

// Быстрые команды
bot.command('pipelines', (ctx) => {
  ctx.reply(
    '*📊 Доступные воронки:*\n\n' +
    '1️⃣ *Индивидуалы* (ID: 17)\n' +
    '   Частные бронирования гостей\n\n' +
    '2️⃣ *Группы* (ID: 2)\n' +
    '   Тургруппы, организованные группы\n\n' +
    '3️⃣ *Мероприятия* (ID: 4)\n' +
    '   Корпоративы, свадьбы, конференции',
    { parse_mode: 'Markdown' }
  );
});

bot.on('text', async (ctx) => {
  const query = ctx.message.text.trim();
  console.log(` [TG] ${ctx.from.first_name}: "${query}"`);
  
  await ctx.reply('⏳ Загружаю данные из CRM и анализирую через Qwen AI...');
  
  // 🔍 Парсинг запроса
  let dealLimit = 300;
  let dateFilter = null;
  let categoryId = null;
  const context = {};
  
  // Проверка на упоминание конкретной воронки
  const queryLower = query.toLowerCase();
  
  if (queryLower.includes('индивидуал') || queryLower.includes('индивидуальные')) {
    categoryId = '17';
    context.selectedPipeline = 'Индивидуалы';
  } else if (queryLower.includes('групп')) {
    categoryId = '2';
    context.selectedPipeline = 'Группы';
  } else if (queryLower.includes('мероприят') || queryLower.includes('корпоратив') || queryLower.includes('конференц')) {
    categoryId = '4';
    context.selectedPipeline = 'Мероприятия';
  }
  
  // Проверка на расширенную выгрузку
  if (queryLower.includes('все сделки') || queryLower.includes('расширить') || queryLower.includes('максимум')) {
    dealLimit = 500;
    context.dataScope = 'расширенная выгрузка';
  }
  
  // Проверка на фильтр по дате
  const dateMatch = query.match(/с\s+(\d{1,2})[\s.-]+(\d{1,2})[\s.-]+(\d{2,4})?/i);
  if (dateMatch) {
    const day = dateMatch[1].padStart(2, '0');
    const month = dateMatch[2].padStart(2, '0');
    let year = dateMatch[3] || '2026';
    if (year.length === 2) year = '20' + year;
    dateFilter = `${year}-${month}-${day}`;
    context.dateFilter = dateFilter;
  }
  
  // Загрузка данных
  const deals = await fetchCRMData({
    dateFrom: dateFilter,
    limit: dealLimit,
    categoryId: categoryId
  });
  
  if (deals.length === 0) {
    return ctx.reply('⚠️ Не удалось получить данные из CRM или в системе пока нет сделок.' + 
      (categoryId ? `\n\nВыбранная воронка: ${PIPELINES[categoryId]}` : ''));
  }
  
  // Добавляем статистику в контекст
  context.totalDeals = deals.length;
  context.byPipeline = {};
  deals.forEach(deal => {
    const pipe = deal.PIPELINE_NAME;
    if (!context.byPipeline[pipe]) {
      context.byPipeline[pipe] = { count: 0, sum: 0, won: 0 };
    }
    context.byPipeline[pipe].count++;
    context.byPipeline[pipe].sum += parseFloat(deal.OPPORTUNITY) || 0;
    if (deal.STAGE_ID === 'WON' || deal.CLOSED === 'Y') {
      context.byPipeline[pipe].won++;
    }
  });
  
  // Формируем обогащённый запрос
  const enrichedQuery = `[Контекст: доступно ${deals.length} сделок${categoryId ? ` (воронка: ${PIPELINES[categoryId]})` : ''}${dateFilter ? ` (с ${dateFilter})` : ''}]\n\n${query}`;
  
  const aiAnswer = await askAI(enrichedQuery, deals, context);
  await ctx.reply(aiAnswer, { parse_mode: 'Markdown' });
  console.log('✅ [AI] Ответ отправлен');
});

// Запуск
bot.launch();
app.listen(PORT, () => {
  console.log(`✅ [SERVER] Vega CRM Analytics Bot v3.0 запущен на порту ${PORT}`);
  console.log(`🤖 Telegram: @Vega_CRM_Analytics_bot`);
  console.log(`🧠 Qwen: ${QWEN_BASE_URL}`);
  console.log(` CRM: ${B24_WEBHOOK}`);
  console.log(`📊 Воронки: ${Object.keys(PIPELINES).length} (${Object.values(PIPELINES).join(', ')})`);
});

// Защита от крашей
process.on('uncaughtException', (err) => {
  console.error('💥 [FATAL]', err);
  process.exit(1);
});
