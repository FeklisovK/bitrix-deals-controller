// Подключаем необходимые модули
const express = require('express');
const bodyParser = require('body-parser');

// Инициализируем приложение
const app = express();

// Порт из переменной окружения или 3000 по умолчанию
const PORT = process.env.PORT || 3000;

// Middleware для парсинга входящих данных (JSON и формы)
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// 🗺️ Карта соответствия ID воронок и их названий
// ВАЖНО: Замените '1' и '2' на реальные ID ваших воронок из Битрикс24.
// Узнать ID можно: открыть воронку в CRM -> посмотреть в URL (параметр CATEGORY_ID) 
// или через метод API: crm.dealcategory.list
const PIPELINE_MAP = {
  '1': 'Группы',       // Замените 1 на ваш реальный ID
  '2': 'Мероприятия'   // Замените 2 на ваш реальный ID
};

// 📡 Обработчик вебхуков
app.post('/webhook', (req, res) => {
  try {
    // 1. Базовая валидация входящих данных
    if (!req.body || typeof req.body !== 'object') {
      console.error('❌ Ошибка: Пришёл пустой или некорректный запрос');
      return res.status(400).json({ error: 'Invalid request body' });
    }

    // 2. Логируем сырые данные от Битрикс24
    console.log('📥 Получен вебхук от Битрикс24:');
    console.log(JSON.stringify(req.body, null, 2));

    // 3. Извлекаем нужные поля
    // Битрикс обычно присылает данные в req.body.fields, но иногда напрямую в req.body
    const fields = req.body.fields || req.body;
    
    const categoryId = String(fields.CATEGORY_ID || '').trim();
    const dealId = fields.ID || req.body.id || 'unknown';
    
    // Пример чтения кастомного поля (замените UF_CRM_* на ваше реальное название поля)
    const customField = fields.UF_CRM_CUSTOM_EXAMPLE || req.body.UF_CRM_CUSTOM_EXAMPLE;

    // Проверка наличия обязательного поля CATEGORY_ID
    if (!categoryId) {
      console.warn('⚠️ Предупреждение: В запросе отсутствует CATEGORY_ID. Пропускаем логику.');
      return res.status(200).json({ status: 'ok', message: 'CATEGORY_ID missing' });
    }

    console.log(`🔍 Сделка ID: ${dealId} | Воронка ID: ${categoryId}`);

    // 4. Определяем тип сделки и выполняем логику
    if (PIPELINE_MAP[categoryId] === 'Группы') {
      console.log('📦 Обработка Группы');
      // Здесь можно добавить вызов API Битрикса, запись в БД и т.д.
    } else if (PIPELINE_MAP[categoryId] === 'Мероприятия') {
      console.log('🎉 Обработка Мероприятия');
      // Логика для мероприятий
    } else {
      console.log(`📋 Сделка из другой воронки (ID: ${categoryId})`);
    }

    // 5. Успешный ответ Битриксу (обязательно 200, иначе Битрикс будет слать повторные запросы)
    res.status(200).json({ status: 'success', message: 'Webhook processed successfully' });

  } catch (error) {
    // Graceful обработка ошибок
    console.error('💥 Произошла ошибка при обработке вебхука:', error.message);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// 🚀 Запуск сервера
app.listen(PORT, () => {
  console.log(`✅ Сервер запущен на порту ${PORT}`);
  console.log(`🌐 Ожидание вебхуков на: http://localhost:${PORT}/webhook`);
});

// Глобальная обработка необработанных ошибок (защита от падения процесса)
process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught Exception:', err);
  process.exit(1);
});
