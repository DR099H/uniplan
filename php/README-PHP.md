# UniPlan — PHP-версия (FastCGI + MySQL)

Расписание вуза с 1-й/2-й неделей и TODO-листом по дням.

## Требования

- Веб-сервер с поддержкой FastCGI (Nginx + PHP-FPM, Apache с `mod_proxy_fcgi` или IIS FastCGI)
- PHP 7.4+ или 8.x с расширениями: `pdo`, `pdo_mysql`, `mbstring`
- MySQL 5.7+ / MariaDB 10.3+

## Быстрый старт

### 1. Создать базу данных

```sql
CREATE DATABASE uniplan CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'uniplan'@'localhost' IDENTIFIED BY 'your_password';
GRANT ALL PRIVILEGES ON uniplan.* TO 'uniplan'@'localhost';
FLUSH PRIVILEGES;
```

```bash
mysql -u uniplan -p uniplan < sql/schema.sql
```

### 2. Настроить подключение

Отредактировать `config.php`:

```php
define('DB_HOST', 'localhost');
define('DB_NAME', 'uniplan');
define('DB_USER', 'uniplan');
define('DB_PASS', 'your_password');
```

Или задать через переменные окружения сервера (FastCGI params / env).

### 3. Загрузить тестовые данные

```bash
php tools/seed.php
```

### 4. Открыть в браузере

```
http://ваш-сервер/uniplan/
```

Демо-аккаунты (пароль: `uniplan2026`):
- `student` — студент группы 25ИП1б
- `starosta1` — староста группы 25ИП1б

## Структура проекта (PHP-файлы)

```
.htaccess          — URL-маршрутизация + защита каталогов
config.php         — настройки подключения к MySQL
index.php          — роутер + все API-эндпоинты + раздача статики
api/
  db.php           — PDO-подключение (singleton) + транзакции
  auth.php         — пароли (bcrypt), cookie-сессии
  week.php         — тип учебной недели, работа с датами
  validate.php     — валидация расписания и импорта JSON
sql/
  schema.sql       — DDL для MySQL (5 таблиц)
tools/
  seed.php         — заполнение тестовыми данными
  manage.php       — CLI: управление ролями
  reset.php        — CLI: полный сброс и пересоздание БД
client/            — фронтенд (без изменений)
shared/            — общий модуль week.js (без изменений)
```

## CLI-команды

```bash
php tools/manage.php users              # список пользователей
php tools/manage.php users 25ИП1б       # по группе
php tools/manage.php role student starosta   # назначить старостой
php tools/manage.php role starosta1 student  # снять роль
php tools/reset.php                     # полный сброс БД
```

## Настройка веб-сервера FastCGI (Nginx + PHP-FPM)

```nginx
server {
    listen 80;
    server_name uniplan.local;
    root /var/www/uniplan;
    index index.php index.html;

    # Сжатие статических ресурсов
    gzip on;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location ~ \.php$ {
        fastcgi_pass 127.0.0.1:9000; # либо unix:/var/run/php/php-fpm.sock
        fastcgi_index index.php;
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
    }

    # Кэширование статики
    location ~* \.(css|js|svg|png|jpg|ico)$ {
        expires 30d;
        add_header Cache-Control "public, no-transform";
    }
}
```

*(Для Apache при подключении через `mod_proxy_fcgi` также поставляется `.htaccess` с директивами маршрутизации, ETag и кэширования).*

## Оптимизация ресурсов и сборка

В проекте настроено:
- **Gzip-сжатие** (`mod_deflate` / Nginx gzip), сокращает размер CSS и JS на 75–80%.
- **Кэширование**: статика кэшируется в браузере на 1 месяц со `stale-while-revalidate`, а `index.html` ревалидируется через ETag / Last-Modified (при отсутствии изменений сервер отвечает `304 Not Modified`, не расходуя трафик).
- **Сборка и минификация**:
  ```bash
  npm run build
  ```
  Создаёт компактные `.min.css` и `.min.js` в `php/` и `client/`. Если файлы `.min` существуют, `index.php` автоматически подключает их в продакшене. Если их удалить, сервер прозрачно возвращается к читаемым исходникам.

## Файлы от Node.js-версии (можно удалить)

- `server/`, `node_modules/`, `data/`, `tests/`
- `package.json`, `package-lock.json`, `start.bat`
