// ============================================
// Vega CRM Analytics Bot v2.2
// AI Assistant for Hotel Business Analytics
// Bot: @Vega_CRM_Analytics_bot
// ============================================
console.log('🚀 [INIT] Запуск Vega CRM Analytics Bot v2.2...');

const express = require('express');
const { Telegraf } = require('telegraf');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// 🔑 Конфигурация из переменных окружения
const BOT_TOKEN = process.env.BOT_TOKEN;
const QWEN_KEY = process.env.QWEN_API_KEY;
const QWEN_BASE_URL = process.env.QWEN_BASE_URL || 'https://ws-l60ae5307m8kjrb3.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1';
const QWEN_MODEL = process.env.QWEN_MODEL || 'qwen-plus';
const B24_WEBHOOK = process.env.B24_WEBHOOK_URL;

if (!BOT_TOKEN || !QWEN_KEY || !B24_WEBHOOK) {
  console.error('❌ [FATAL] Отсутствуют необходимые переменные окружения');
  process.exit(1);
}

// 🤖 Инициализация бота (Polling режим)
const bot = new Telegraf(BOT_TOKEN);

// ============================================
// 📥 Получение данных из Битрикс24
// ============================================
async function fetchCRMData() {
  try {
    console.log('📡 [B24] Запрос данных из CRM...');
    
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
    
    const response = await axios.post(url, payload, { timeout: 15000 });
    const deals = response.data.result || [];
    console.log(`✅ [B24] Получено ${deals.length} сделок`);
    return deals;
  } catch (err) {
    console.error('💥 [B24 API] Ошибка:', err.message);
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

  const contextStr = JSON.stringify(crmData).substring(0, 12000);
  const userPrompt = `Вопрос: "${userQuestion}"\n\nДанные из CRM (последние 50 сделок):\n${contextStr}`;

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
        max_tokens: 2000,
        temperature: 0.7,
        stream: false
      },
      {
        headers: {
          'Authorization': `Bearer ${QWEN_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
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
  'Я работаю с данными из вашей CRM в реальном времени.\n\n' +
  '📊 *Примеры вопросов:*\n' +
  '• "Какая воронка приносит больше денег?"\n' +
  '• "Топ-3 менеджера по сумме сделок"\n' +
  '• "Сколько новых сделок за сегодня?"\n' +
  '• "Какие источники лидов самые эффективные?"',
  { parse_mode: 'Markdown' }
));

bot.on('text', async (ctx) => {
  const query = ctx.message.text.trim();
  console.log(` [TG] ${ctx.from.first_name}: "${query}"`);
  
  await ctx.reply('⏳ Загружаю свежие данные из CRM и анализирую через Qwen AI...');
  
  const deals = await fetchCRMData();
  if (deals.length === 0) {
    return ctx.reply('⚠️ Не удалось получить данные из CRM или в системе пока нет сделок.');
  }
  
  const aiAnswer = await askAI(query, deals);
  await ctx.reply(aiAnswer);
  console.log('✅ [AI] Ответ отправлен');
});

// Запуск
bot.launch();
app.listen(PORT, () => {
  console.log(`✅ [SERVER] Vega CRM Analytics Bot запущен на порту ${PORT}`);
  console.log(`🤖 Telegram: @Vega_CRM_Analytics_bot`);
  console.log(`🧠 Qwen: ${QWEN_BASE_URL}`);
  console.log(` CRM: ${B24_WEBHOOK}`);
});

// Защита от крашей
process.on('uncaughtException', (err) => {
  console.error('💥 [FATAL]', err);
  process.exit(1);
});
