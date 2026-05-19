// ============================================
// Bitrix24 Deals Controller
// Версия: 1.1 (с подробным логированием)
// ============================================

console.log('🚀 [START] Запуск приложения...');
console.log('🚀 [START] NODE_ENV:', process.env.NODE_ENV);
console.log('🚀 [START] PORT:', process.env.PORT || 3000);

const express = require('express');
const bodyParser = require('body-parser');

console.log('✅ [MODULES] Express и body-parser загружены');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

console.log('✅ [MIDDLEWARE] JSON и URL-encoded парсеры подключены');

// Карта воронок
const PIPELINE_MAP = {
  '1': 'Группы',
  '2': 'Мероприятия'
};

console.log('✅ [CONFIG] PIPELINE_MAP настроен:', JSON.stringify(PIPELINE_MAP));

// 📡 Корневой маршрут (тест)
app.get('/', (req, res) => {
  console.log('📡 [GET /] Тестовый запрос получен');
  res.json({ 
    status: 'ok', 
    message: 'Bitrix24 Deals Controller is running!',
    timestamp: new Date().toISOString()
  });
});

// 📡 Health check
app.get('/health', (req, res) => {
  console.log('💚 [GET /health] Health check запрошен');
  res.json({ 
    status: 'healthy',
    uptime: process.uptime(),
    memory: process.memoryUsage().heapUsed / 1024 / 1024 + ' MB'
  });
});

// 📡 Обработчик вебхуков
app.post('/webhook', (req, res) => {
  console.log('📥 [WEBHOOK] Получен POST запрос на /webhook');
  console.log('📥 [WEBHOOK] Headers:', JSON.stringify(req.headers));
  console.log('📥 [WEBHOOK] Body:', JSON.stringify(req.body, null, 2));
  
  try {
    // Валидация
    if (!req.body || typeof req.body !== 'object') {
      console.warn('⚠️ [WEBHOOK] Пустое или некорректное тело запроса');
      return res.status(400).json({ error: 'Invalid request body' });
    }

    // Извлечение данных
    const fields = req.body.fields || req.body;
    const categoryId = String(fields.CATEGORY_ID || '').trim();
    const dealId = fields.ID || req.body.id || 'unknown';
    
    console.log('🔍 [WEBHOOK] Сделка ID:', dealId);
    console.log('🔍 [WEBHOOK] Воронка ID:', categoryId);

    // Проверка CATEGORY_ID
    if (!categoryId) {
      console.warn('⚠️ [WEBHOOK] CATEGORY_ID отсутствует');
      return res.status(200).json({ status: 'ok', message: 'CATEGORY_ID missing' });
    }

    // Определение типа сделки
    const pipelineName = PIPELINE_MAP[categoryId];
    
    if (pipelineName === 'Группы') {
      console.log('📦 [PIPELINE] Обработка Группы');
      // TODO: Добавить логику для групп
    } else if (pipelineName === 'Мероприятия') {
      console.log('🎉 [PIPELINE] Обработка Мероприятия');
      // TODO: Добавить логику для мероприятий
    } else {
      console.log('📋 [PIPELINE] Неизвестная воронка ID:', categoryId);
    }

    // Успешный ответ
    console.log('✅ [WEBHOOK] Обработка завершена успешно');
    res.status(200).json({ 
      status: 'success', 
      message: 'Webhook processed successfully',
      dealId: dealId,
      pipeline: pipelineName || 'unknown'
    });

  } catch (error) {
    console.error('💥 [WEBHOOK] Ошибка обработки:', error.message);
    console.error('💥 [WEBHOOK] Stack:', error.stack);
    res.status(500).json({ 
      status: 'error', 
      message: 'Internal server error',
      error: error.message 
    });
  }
});

// 🚀 Запуск сервера
console.log('🚀 [SERVER] Запуск сервера на порту', PORT);

app.listen(PORT, () => {
  console.log('✅ [SERVER] Сервер успешно запущен!');
  console.log('✅ [SERVER] Порт:', PORT);
  console.log('✅ [SERVER] Webhook endpoint: http://localhost:' + PORT + '/webhook');
  console.log('✅ [SERVER] Health check: http://localhost:' + PORT + '/health');
  console.log('✅ [SERVER] Готов к приему запросов!');
});

// 🛡️ Глобальная обработка ошибок
process.on('uncaughtException', (err) => {
  console.error('💥 [FATAL] Uncaught Exception:', err.message);
  console.error('💥 [FATAL] Stack:', err.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 [FATAL] Unhandled Rejection at:', promise);
  console.error('💥 [FATAL] Reason:', reason);
  process.exit(1);
});

console.log('✅ [INIT] Все обработчики ошибок подключены');
