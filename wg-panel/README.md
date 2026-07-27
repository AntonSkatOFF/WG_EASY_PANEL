# WG Panel - WireGuard Easy Management с Telegram-аутентификацией

Веб-панель управления для **wg-easy v15.3.0** с безопасной аутентификацией через Telegram и автоматическим определением прав доступа.

## 🚀 Возможности

### Для Администраторов:
- 👥 Управление всеми клиентами WireGuard
- ✅ Одобрение/отклонение заявок новых пользователей
- 📊 Статистика подключений и трафика
- ⏸️ Включение/отключение клиентов
- 🗑️ Удаление клиентов

### Для Клиентов:
- 📱 QR-код для быстрого подключения на мобильных
- 📄 Скачивание .conf файла для ПК
- 📊 Просмотр статистики трафика
- 🔄 Мониторинг статуса подключения

## 🔐 Безопасность

- Вход только через Telegram Widget
- Автоматическое определение роли (Админ/Клиент)
- Сессионная аутентификация с SQLite хранением
- Интеграция с wg-easy API v15.3.0 (логин + пароль)

## 📋 Требования

- VPS с Ubuntu/Debian/CentOS
- Node.js 16+ и npm
- Docker (для wg-easy, опционально)
- Telegram Bot Token (получить у [@BotFather](https://t.me/botfather))

## 🛠️ Быстрая установка (One-Command Install)

```bash
# Клонируйте репозиторий
mkdir workspace
cd workspace
git clone <repository_url> wg-panel
cd wg-panel

# Запустите установку от root
sh ./install.sh
```

Скрипт автоматически:
1. Установит системные зависимости (Node.js, npm, git)
2. Предложит установить Docker и wg-easy если нужно
3. Настроит .env файл через интерактивный опрос
4. Установит npm пакеты
5. Настроит firewall (порт 3000)
6. Создаст systemd службу для автозапуска

## ⚙️ Ручная настройка

### 1. Создайте Telegram бота
1. Откройте [@BotFather](https://t.me/botfather) в Telegram
2. Отправьте `/newbot`
3. Следуйте инструкциям
4. Сохраните токен бота

### 2. Узнайте свой Telegram ID
1. Откройте [@userinfobot](https://t.me/userinfobot)
2. Ваш ID будет показан в ответе

### 3. Настройте .env файл

```bash
cp .env.example .env
nano .env
```

**Обязательные переменные:**

| Переменная | Описание | Пример |
|------------|----------|--------|
| `TELEGRAM_BOT_TOKEN` | Токен вашего бота | `1234567890:ABCdefGHIjklMNOpqrsTUVwxyz` |
| `TELEGRAM_ADMIN_ID` | Ваш Telegram ID | `123456789` |
| `TELEGRAM_BOT_USERNAME` | Имя бота (без @) | `my_wg_bot` |
| `WG_EASY_URL` | URL wg-easy API | `http://localhost:51821` |
| `WG_EASY_USERNAME` | Логин wg-easy (v15.3.0+) | `admin` |
| `WG_EASY_PASSWORD` | Пароль wg-easy | `your_password` |
| `PORT` | Порт панели | `3000` |
| `SESSION_SECRET` | Секрет сессий | (генерируется автоматически) |

### 4. Установка зависимостей

```bash
npm install --production
```

### 5. Запуск

```bash
# Прямой запуск
node app.js

# Или через PM2
pm2 start app.js --name wg-panel
pm2 save
pm2 startup
```

## 🌐 Использование

### Первый вход (Администратор)
1. Откройте `http://YOUR_SERVER_IP:3000`
2. Нажмите кнопку "Login with Telegram"
3. Если ваш Telegram ID совпадает с `TELEGRAM_ADMIN_ID` → вы получите доступ к админ-панели

### Новый пользователь
1. Пользователь входит через Telegram
2. Создает заявку с желаемым именем устройства
3. Заявка уходит администратору
4. После одобрения пользователь получает доступ к личному кабинету

### Админ-панель
- Просмотр всех клиентов wg-easy
- Одобрение заявок новых пользователей
- Создание новых конфигов
- Управление статусом клиентов (вкл/выкл)
- Удаление клиентов

### Клиентский кабинет
- Информация о подключении
- QR-код для мобильных устройств
- Скачать .conf файл
- Статистика трафика

## 📁 Структура проекта

```
wg-panel/
├── app.js                 # Основной сервер Express
├── models.js              # Модели базы данных (Sequelize)
├── wg-api.js              # WG-Easy API wrapper
├── telegram-service.js    # Telegram бот сервис
├── package.json           # Зависимости npm
├── .env.example           # Пример конфигурации
├── install.sh             # Скрипт установки
├── views/
│   ├── login.ejs          # Страница входа
│   ├── pending.ejs        # Ожидание подтверждения
│   ├── admin/
│   │   └── dashboard.ejs  # Админ-панель
│   └── client/
│       └── dashboard.ejs  # Личный кабинет клиента
└── public/
    └── css/
        └── style.css      # Стили (wg-easy дизайн)
```

## 🔧 Управление службой

```bash
# Проверка статуса
systemctl status wg-panel

# Перезапуск
systemctl restart wg-panel

# Остановка
systemctl stop wg-panel

# Просмотр логов
journalctl -u wg-panel -f
```

## 🔒 Безопасность

- Все данные хранятся локально в SQLite (`database.sqlite`)
- Сессии защищены случайным секретом
- HTTPS рекомендуется настроить через reverse proxy (nginx)
- Регулярно обновляйте зависимости

### Настройка HTTPS (рекомендуется)

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## 🐛 Решение проблем

### Панель не запускается
```bash
# Проверьте логи
journalctl -u wg-panel -f

# Проверьте .env файл
cat .env

# Проверьте подключение к wg-easy
curl -u admin:password http://localhost:51821/api/wireguard/status
```

### Telegram виджет не работает
- Убедитесь, что домен добавлен в разрешенные в @BotFather
- Проверьте `TELEGRAM_BOT_USERNAME` в .env

### Ошибка подключения к wg-easy
- Проверьте `WG_EASY_URL`, `WG_EASY_USERNAME`, `WG_EASY_PASSWORD`
- Убедитесь, что wg-easy запущен: `docker ps | grep wg-easy`

## 📝 Лицензия

MIT License

## 🤝 Поддержка

При возникновении проблем создайте issue в репозитории.

---

**Совместимо с wg-easy v15.3.0+**
