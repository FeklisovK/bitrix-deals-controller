// ============================================
// Vega CRM Analytics Bot v2.0
// AI Assistant for Hotel Business Analytics
// Bot: @Vega_CRM_Analytics_bot
// ============================================
console.log('🚀 [INIT] Запуск Vega CRM Analytics Bot...');

const express = require('express');
const { Telegraf } = require('telegraf');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// 🔑 Конфигурация
const BOT_TOKEN = process.env.BOT_TOKEN;
const QWEN_KEY = process.env.QWEN_API_KEY;
const B24_WEBHOOK = process.env.B24_WEBHOOK_URL;

if (!BOT_TOKEN || !QWEN_KEY || !B24_WEBHOOK) {
  console.error('❌ [FATAL] Отсутствуют необходимые переменные окружения');
  process.exit(1);
}
// ============================================
// 🏥 Health Check Endpoints (для VibeCode)
// ============================================
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'Vega CRM Analytics Bot',
    bot: '@Vega_CRM_Analytics_bot',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.status(200).json({ 
    healthy: true,
    uptime: process.uptime(),
    memory: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2) + ' MB'
  });
});
// ============================================
// 🤖 Инициализация бота
const bot = new Telegraf(BOT_TOKEN);

// ============================================
// 📥 Получение данных из Битрикс24
// ============================================
async function fetchCRMData() {
  try {
    const url = `${B24_WEBHOOK}crm.deal.list.json`;
    const payload = {
      order: { DATE_CREATE: "DESC" },
      filter: {},
      select: [
        "ID", "TITLE", "OPPORTUNITY", "STAGE_ID", 
        "CATEGORY_ID", "ASSIGNED_BY_ID", "DATE_CREATE", 
        "SOURCE_ID", "BEGINDATE", "CLOSED"
      ],
      start: 0
    };
    
    const response = await axios.post(url, payload);
    return response.data.result || [];
  } catch (err) {
    console.error('💥 [B24 API] Ошибка:', err.response?.data || err.message);
    return [];
  }
}

// ============================================
// 🧠 Запрос к Qwen AI
// ============================================
async function askAI(userQuestion, crmData) {
  const systemPrompt = `Ты — профессиональный AI-аналитик CRM для отельного бизнеса Vega.
Твоя задача: анализировать сделки из CRM и отвечать на вопросы владельца бизнеса.

Правила:
1. Отвечай четко, структурированно, на русском языке
2. Используй только предоставленные данные
3. Если данных недостаточно — честно скажи об этом
4. Форматируй ответ с эмодзи и списками для Telegram
5. Делай акцент на метриках: количество сделок, суммы, конверсия, менеджеры`;

  const contextStr = JSON.stringify(crmData).substring(0, 15000);
  const userPrompt = `Вопрос: "${userQuestion}"\n\nДанные из CRM (последние 50 сделок):\n${contextStr}`;

  try {
    const response = await axios.post(
      'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation',
      {
        model: 'qwen-plus',
        input: {
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ]
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${QWEN_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data.output.text;
  } catch (err) {
    console.error('💥 [Qwen AI] Ошибка:', err.message);
    return '❌ Произошла ошибка при подключении к AI. Попробуйте позже.';
  }
}

// ============================================
//  Обработчики Telegram
// ============================================
bot.start((ctx) => ctx.reply(
  '*👋 Привет! Я AI-аналитик Vega CRM*\n\n' +
  'Я работаю с данными из вашей CRM в реальном времени.\n\n' +
  '📊 *Примеры вопросов:*\n' +
  '• "Какая воронка приносит больше денег?"\n' +
  '• "Топ-3 менеджера по сумме сделок"\n' +
  '• "Сколько новых сделок за сегодня?"\n' +
  '• "Какие источники лидов самые эффективные?"\n' +
  '• "Покажи общую статистику по сделкам"',
  { parse_mode: 'Markdown' }
));

bot.on('text', async (ctx) => {
  const query = ctx.message.text.trim();
  console.log(` [TG] ${ctx.from.first_name}: "${query}"`);
  
  await ctx.reply('⏳ Загружаю свежие данные из CRM и анализирую через Qwen AI...');
  
  // 1. Забираем данные из Битрикс24
  const deals = await fetchCRMData();
  
  if (deals.length === 0) {
    return ctx.reply('⚠️ Не удалось получить данные из CRM или в системе пока нет сделок.');
  }
  
  // 2. Отправляем данные + вопрос в Qwen
  const aiAnswer = await askAI(query, deals);
  
  // 3. Отдаем ответ пользователю
  await ctx.reply(aiAnswer);
  console.log('✅ [AI] Ответ отправлен');
});

// Запуск
bot.launch();
app.listen(PORT, () => {
  console.log(`✅ [SERVER] Vega CRM Analytics Bot запущен на порту ${PORT}`);
  console.log(`🤖 Telegram: @Vega_CRM_Analytics_bot`);
  console.log(` CRM: ${B24_WEBHOOK}`);
});

// Защита от крашей
process.on('uncaughtException', (err) => {
  console.error('💥 [FATAL]', err);
  process.exit(1);
});
