# RESINT — Full Architecture Snapshot

> **Назначение:** внешний архитектор / onboarding-документ.  
> **Дата генерации:** автоматически из кодовой базы.

---

## 1. Общая схема

```
Browser / PWA
     │
     ▼
Nginx (proxy) :80/:443  ← TLS termination, Let's Encrypt certs
     │
     ├──► /api/*  → FastAPI API (Gunicorn + Uvicorn)  :8000
     │                     │
     │                     ▼
     │           PostgreSQL 16  (Docker volume pgdata)
     │
     └──► /*      → Next.js 14.2 Standalone  :3000

Docker Compose (prod):  db | api | frontend | proxy | backup
```

**Репозиторий:** `https://github.com/doshikrn/resint.git`  
**Ветка:** `main`  
**Окружение prod:** VPS `89.23.96.231`, домен `resint.cc`

---

## 2. Директивная структура репозитория

```
inventory-app/
├── backend/               # FastAPI + Python 3.12
│   ├── app/
│   │   ├── main.py        # FastAPI app, middleware, router registration
│   │   ├── core/          # config, auth, roles, errors, logging, rate-limit
│   │   ├── db/            # SQLAlchemy engine/session, Base, base.py (all-import)
│   │   ├── models/        # ORM models (18 files)
│   │   ├── routers/       # HTTP route handlers (8 files)
│   │   ├── schemas/       # Pydantic v2 I/O schemas
│   │   ├── services/      # business logic (audit, export, export_repository)
│   │   └── templates/     # (Jinja2 templates, currently unused)
│   ├── alembic/           # DB migrations
│   ├── docker/            # entrypoint.sh, backup.sh, restore_check.sh, nginx/
│   ├── scripts/           # one-off admin scripts (bulk user create, seed, etc.)
│   ├── tests/             # pytest integration tests
│   ├── Dockerfile
│   ├── docker-compose.prod.yml
│   ├── requirements.txt
│   └── pyproject.toml
├── frontend/              # Next.js 14.2, TypeScript, Tailwind CSS
│   ├── app/               # App Router pages
│   ├── components/        # shared React components
│   ├── lib/               # API client, hooks, i18n, offline utilities
│   ├── public/brand/      # SVG logo assets
│   ├── middleware.ts       # auth guard
│   ├── next.config.mjs
│   └── package.json
└── docs/
    └── architecture.md    # ← этот файл
```

---

## 3. Инфраструктура — Docker Compose (prod)

Файл: `backend/docker-compose.prod.yml`

| Сервис | Image | Роль |
|--------|-------|------|
| `db` | `postgres:16` | PostgreSQL, volume `pgdata` |
| `api` | `./Dockerfile` (Python 3.12-slim) | FastAPI + Gunicorn |
| `frontend` | `../frontend/Dockerfile` (Node → standalone) | Next.js SSR/static |
| `proxy` | `nginx:1.27-alpine` | Reverse proxy, TLS |
| `backup` | `postgres:16` | Cron-like backup loop (shell+pg_dump) |
| `restore_check` | `postgres:16` | Profile `ops` — ручная проверка бэкапов |

**Shared volumes:**
- `pgdata` — данные PostgreSQL
- `pgbackups` — файлы резервных копий (монтируется в `api` и `backup`)

**Healthchecks:** `db` → `pg_isready`; `api` → HTTP GET `/health`; `frontend` → service_started.

**Env-переменные API-контейнера:**
```
DATABASE_URL, JWT_SECRET, JWT_ALG, CORS_ALLOW_ORIGINS,
BACKUP_DIR=/backups, POSTGRES_HOST/PORT/USER/PASSWORD/DB,
BACKUP_S3_*, BACKUP_RETENTION_*_DAYS,
WEB_CONCURRENCY, GUNICORN_TIMEOUT, EXPOSE_STACKTRACE
```

**Env-переменные Frontend (build args):**
```
NEXT_PUBLIC_APP_ENV, NEXT_PUBLIC_KITCHEN_WAREHOUSE_ID,
NEXT_PUBLIC_BAR_WAREHOUSE_ID, NEXT_PUBLIC_BRAND_NAME
```
> На сервере: `NEXT_PUBLIC_KITCHEN_WAREHOUSE_ID=2`, `NEXT_PUBLIC_BAR_WAREHOUSE_ID=3`

---

## 4. Backend — FastAPI

### 4.1 Точка входа (`app/main.py`)

Middleware (в порядке добавления):
1. `MaintenanceMiddleware` — возвращает 503 в режиме обслуживания
2. `RateLimitMiddleware` — ограничение запросов
3. `RequestLoggingMiddleware` — structured JSON-логирование
4. `GZipMiddleware` — gzip для ответов ≥ 500 байт
5. `CORSMiddleware` — настраивается через `CORS_ALLOW_ORIGINS`

Глобальные обработчики ошибок:
- `StarletteHTTPException` → `http_exception_handler`
- `RequestValidationError` → `validation_exception_handler`
- `Exception` → `unhandled_exception_handler`

OpenAPI: `BearerAuth` (JWT) зарегистрирован как `securityScheme`.

### 4.2 Роутеры (API)

| Файл | Prefix | Теги |
|------|--------|------|
| `auth.py` | `/auth` | auth |
| `warehouses.py` | `/warehouses` | warehouses |
| `items.py` | `/items` | items |
| `inventory.py` | `/inventory` | inventory |
| `zones.py` | `/zones` | zones |
| `stations.py` | `/stations` | stations |
| `users.py` | `/users` | users |
| `health.py` | `/health` | health |
| `admin_backups.py` | `/admin/backups` | backups |

### 4.3 Эндпоинты — подробно

#### `/auth`
| Метод | Путь | Описание |
|-------|------|----------|
| POST | `/auth/login` | Логин: возвращает access + refresh токены |
| POST | `/auth/refresh` | Обновить токены по refresh-токену |
| POST | `/auth/logout` | Отозвать refresh-токен |
| GET | `/auth/me` | Профиль текущего пользователя |

#### `/users`
| Метод | Путь | Роль | Описание |
|-------|------|------|----------|
| GET | `/users/me` | all | Мой профиль |
| PATCH | `/users/me` | all | Обновить имя / язык |
| POST | `/users/me/password` | all | Сменить пароль (с текущим) |
| GET | `/users` | manager | Список пользователей (поиск, фильтр роль/склад) |
| POST | `/users` | manager | Создать пользователя |
| PATCH | `/users/{id}` | manager | Обновить профиль/роль/склад/статус |
| POST | `/users/{id}/reset-password` | manager | Сброс пароля |
| DELETE | `/users/{id}` | manager | Мягкое удаление (soft-delete) |
| POST | `/users/heartbeat` | all | Обновить `last_seen_at` |
| GET | `/users/online` | all | Онлайн-пользователи одного склада (за 60 с) |

#### `/items`
| Метод | Путь | Роль | Описание |
|-------|------|------|----------|
| GET | `/items` | all | Список товаров (фильтр по warehouse/category/search) |
| GET | `/items/units` | all | Справочник единиц измерения |
| GET | `/items/recent` | warehouse | Недавние товары (по текущей сессии) |
| GET | `/items/frequent` | warehouse | Частые товары (по периоду, default 30d) |
| GET | `/items/search` | all | Поиск: name + product_code + aliases |
| POST | `/items` | all (w/h bound) | Создать товар |
| POST | `/items/import` | souschef+ | Импорт из CSV/XLSX (dry_run по умолчанию) |
| GET | `/items/export` | all | Экспорт в CSV/XLSX |
| PATCH | `/items/{id}` | souschef+ | Обновить товар |
| POST | `/items/bulk-upsert` | souschef+ | Bulk upsert (JSON payload) |
| GET | `/items/categories` | all | Список категорий (с usage-score по складу) |
| POST | `/items/categories` | souschef+ | Создать категорию |
| POST | `/items/{id}/aliases` | souschef+ | Добавить алиас поиска |
| DELETE | `/items/{id}/aliases/{alias_id}` | souschef+ | Удалить алиас |

#### `/inventory`
| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/inventory/sessions` | Список сессий (история ревизий) |
| POST | `/inventory/sessions` | Создать / получить активную сессию |
| GET | `/inventory/sessions/active` | Текущая активная сессия |
| GET | `/inventory/sessions/{id}` | Сессия по ID |
| POST | `/inventory/sessions/{id}/close` | Закрыть ревизию |
| POST | `/inventory/sessions/{id}/reopen` | Возобновить ревизию |
| DELETE | `/inventory/sessions/{id}` | Удалить сессию (soft-delete) |
| GET | `/inventory/sessions/{id}/entries` | Позиции ревизии |
| GET | `/inventory/sessions/{id}/entries/snapshot` | Снапшот для оффлайн-кэша |
| POST | `/inventory/sessions/{id}/entries` | Добавить/обновить позицию (idempotency-key) |
| PATCH | `/inventory/sessions/{id}/entries/{entry_id}` | Скорректировать позицию (If-Match versioning) |
| DELETE | `/inventory/sessions/{id}/entries/{entry_id}` | Удалить позицию |
| GET | `/inventory/sessions/{id}/events/recent` | Журнал последних событий |
| GET | `/inventory/sessions/{id}/audit` | Аудит-лог позиций |
| GET | `/inventory/sessions/{id}/progress` | Прогресс ревизии (по станциям/зонам) |
| GET | `/inventory/sessions/{id}/report` | Итоговый отчёт сессии |
| GET | `/inventory/sessions/{id}/participants` | Кто участвовал в ревизии |
| GET | `/inventory/sessions/{id}/export` | Экспорт сессии в CSV/XLSX |
| GET | `/inventory/sessions/{id}/catalog` | Каталог товаров для ревизии (ETag caching) |
| GET | `/inventory/audit-log` | Глобальный аудит-лог (admin) |
| GET | `/inventory/diff-report` | Diff между ревизиями |
| GET | `/inventory/items/{item_id}/contributors` | Кто редактировал позицию |

#### `/warehouses`
CRUD для складов. Склад привязан к Zone.

#### `/zones`
CRUD для зон (Кухня, Бар). Зона объединяет склады.

#### `/stations`
CRUD для станций (cook-stations в рамках department: kitchen/bar).

#### `/health`
| GET | `/health` | Базовая проверка живости |
| GET | `/health/ready` | Позволяет обнаружить maintenance-mode |

#### `/admin/backups`
| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/admin/backups` | Список резервных копий |
| POST | `/admin/backups` | Создать резервную копию немедленно |
| GET | `/admin/backups/{filename}/download` | Скачать файл |
| POST | `/admin/backups/{filename}/restore` | Восстановить из копии |
| DELETE | `/admin/backups/{filename}` | Удалить копию |

Механизм бэкапа: `shutil.which("pg_dump")` → прямой pg_dump внутри API-контейнера (установлен пакет `postgresql-client`). Опционально выгружается в S3 (boto3).

### 4.4 Core модули

| Файл | Назначение |
|------|-----------|
| `core/config.py` | `Settings` через pydantic-settings (`.env`) |
| `core/security.py` | `hash_password`, `verify_password`, JWT (PyJWT), refresh token (bcrypt hash) |
| `core/deps.py` | `get_current_user` — FastAPI Depends, декодирует JWT, загружает User |
| `core/roles.py` | Константы ролей + permission-helpers (описаны в §5) |
| `core/errors.py` | Стандартизированные JSON-ответы ошибок |
| `core/rate_limit.py` | Sliding-window rate limiter (in-memory) |
| `core/maintenance.py` | `MaintenanceMiddleware` — 503 по флагу |
| `core/logging_mw.py` | JSON-логирование каждого запроса |
| `core/log_json.py` | Настройка structlog/standard logging в JSON |
| `core/metrics.py` | Счётчики для idempotency-ключей |
| `core/clock.py` | `utc_now()` — injectable clock для тестов |
| `core/backup_storage.py` | Абстракция хранилища бэкапов (local + S3) |

### 4.5 Сервисы

| Файл | Назначение |
|------|-----------|
| `services/audit.py` | `log_audit()`, `verify_audit_chain()` — цепочка хешей |
| `services/export.py` | Построение CSV/XLSX (`build_csv_export`, `build_xlsx_accounting_template_export`) |
| `services/export_repository.py` | Запросы к БД для экспорта сессий (`fetch_session_export_rows`, `fetch_session_catalog_export_rows`) |

---

## 5. Домен — модели (PostgreSQL)

### 5.1 Схема таблиц

```
zones
  id, name(unique, 120), description

warehouses
  id, name, zone_id(FK→zones)
  → items, sessions

zones ──< warehouses ──< items
                    ──< inventory_sessions

users
  id, username(unique, 50), full_name(120), password_hash(255)
  role: cook|souschef|chef|manager  (default: cook)
  department: kitchen|bar  (nullable)
  warehouse_id(FK→warehouses, nullable)
  default_warehouse_id(FK→warehouses, nullable)
  default_station_id(FK→stations, nullable)
  is_active(bool), preferred_language(5), deleted_at, last_seen_at

refresh_tokens
  id, user_id(FK), token_hash(255, unique), expires_at, revoked_at
  replaced_by_token_id(self-ref, nullable), created_at

items
  id, product_code(64, unique, nullable), name(200), unit(20)
  step(float, default=1.0), min_qty, max_qty, is_favorite, is_active
  warehouse_id(FK), category_id(FK→item_categories, nullable)
  station_id(FK→stations, nullable), updated_at

item_categories
  id, name(unique, 100)

item_aliases
  id, item_id(FK), alias_text(200)  [unique together]

item_usage_stats
  id, item_id(FK), warehouse_id(FK), use_count(int), updated_at

stations
  id, name(100), department: kitchen|bar, is_active, sort_order

inventory_sessions
  id, warehouse_id(FK), created_by_user_id(FK→users)
  revision_no(int), status: draft|closed, is_closed(bool)
  created_at, updated_at, deleted_at
  [UQ: warehouse_id WHERE status='draft']  — только 1 активная на склад
  [UQ: warehouse_id + revision_no]

inventory_entries
  id, session_id(FK), item_id(FK)
  quantity(float), version(int)  — optimistic locking
  updated_at, updated_by_user_id(FK)
  station_id(FK), counted_outside_zone(bool)
  counted_by_zone_id(FK→zones), outside_zone_note

inventory_entry_events
  id, session_id(FK), item_id(FK), actor_user_id(FK)
  action: add|set, reason, station_id, counted_outside_zone
  counted_by_zone_id, outside_zone_note, request_id(idempotency)
  before_quantity, after_quantity, created_at

inventory_session_events
  id, session_id(FK), actor_user_id(FK)
  action: SessionEventAction, request_id, reason, created_at

inventory_session_totals
  id, session_id(FK), item_id(FK), qty_final, unit
  [снапшот при закрытии сессии]

inventory_zone_progress
  сводная таблица прогресса по зонам

idempotency_keys
  id, key(unique), response_status, response_body, created_at, expires_at
  [защита от дубликатов POST при плохой сети]

audit_logs
  id, actor_id, action, entity_type, entity_id
  metadata(JSON), timestamp, prev_hash, hash
  [append-only, linked-hash chain]
```

### 5.2 Перечисления (`models/enums.py`)

```python
class SessionStatus:    draft | closed
class EntryAction:      add | set
class SessionEventAction: started | closed | reopened | deleted
class AuditAction:      user_created | user_updated | user_deleted
                        user_password_reset | ...
```

---

## 6. Аутентификация и авторизация

### 6.1 Схема токенов

```
POST /auth/login
  → access_token  (JWT, HS256, expire=30 мин, payload: {sub, role})
  → refresh_token (случайный UUID → bcrypt-hash хранится в refresh_tokens)

POST /auth/refresh  (тело: {refresh_token})
  → новая пара токенов, старый refresh-токен отзывается

POST /auth/logout   (тело: {refresh_token})
  → refresh_token.revoked_at = now()
```

Фронтенд хранит токены в **httpOnly cookies** (через Next.js Route Handlers `/api/auth/login`, `/api/auth/logout`), которые проксируют к бэкенду.

JWT передаётся в заголовке `Authorization: Bearer <access_token>` от Next.js-прокси к FastAPI.

### 6.2 Система ролей

| Роль | Инвентаризация | Каталог | Ревизии | Пользователи | Экспорт | Все склады |
|------|:---:|:---:|:---:|:---:|:---:|:---:|
| **cook** | ✅ (свой склад) | — | — | — | — | — |
| **souschef** | ✅ | ✅ | ✅ | — | ✅ | — |
| **chef** | ✅ | ✅ | ✅ | — | ✅ | — |
| **manager** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **admin** (legacy = chef) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

- **Управление пользователями:** только manager/admin
- **Управление каталогом:** souschef+
- **Запуск/закрытие ревизии:** souschef+
- **Аудит-лог:** souschef+
- **Бэкапы:** manager/admin
- **Кросс-складской доступ:** только manager/admin

---

## 7. Frontend — Next.js 14.2

### 7.1 Стек

```
Next.js 14.2 (App Router)   TypeScript 5
Tailwind CSS 3.4            shadcn/ui (Radix UI primitives)
TanStack Query v5           Lucide React
Playwright (e2e tests)
```

**Сборка:** standalone output → Docker-образ `node:20-alpine`.

### 7.2 Страницы (`app/`)

| Страница | Путь | Описание |
|----------|------|----------|
| Root | `/` | Редирект на `/inventory` |
| Login | `/login` | Форма входа |
| Dashboard | `/dashboard` | (заглушка / обзор) |
| **Inventory** | `/inventory` | Главная: ввод ревизии, управление, отчёты |
| **Items** | `/items` | Каталог товаров: просмотр, добавление, bulk-import |
| Reports | `/reports` | Отчёты по ревизиям |
| Users | `/users` | Управление пользователями (manager+) |
| Settings | `/settings` | Настройки аккаунта (имя, пароль, язык) |
| Backups | `/backups` | Резервные копии (manager+) |

**API Route Handlers** (`app/api/`):
- `/api/auth/login` — принимает credentials, проксирует к FastAPI, устанавливает httpOnly cookies
- `/api/auth/logout` — удаляет cookies, вызывает `/auth/logout` на бэкенде
- `/api/backend/[...path]` — универсальный прокси: все запросы к FastAPI, добавляет `Authorization` из cookie

### 7.3 Middleware (`middleware.ts`)

Перехватывает все защищённые маршруты (`/dashboard/*`, `/inventory/*`, `/items/*`, `/reports/*`, `/settings/*`, `/users/*`). При отсутствии cookie → редирект на `/login?next=...`. При наличии cookie на `/login` → редирект на `/inventory`.

### 7.4 Компоненты

#### Layout
| Компонент | Описание |
|-----------|----------|
| `layout/app-shell.tsx` | Оболочка: sidebar с логотипом (mark + wordmark), навигация, online-users, heartbeat, maintenance-banner |
| `layout/empty-state.tsx` | Заглушка пустого состояния |
| `layout/page-skeleton.tsx` | Скелетон при загрузке |
| `layout/page-stub.tsx` | Страница-заглушка |

#### Inventory (ключевой модуль)
| Компонент | Описание |
|-----------|----------|
| `inventory/fast-entry-container.tsx` | Контейнер ввода: поиск → qty → сохранение |
| `inventory/inventory-input-card.tsx` | Карточка ввода: поиск + qty-поле + hot-buttons |
| `inventory/inventory-search-dropdown.tsx` | Выпадающий список: каталог / recent / frequent / favorites |
| `inventory/recent-entries-card.tsx` | Журнал последних записей + undo |
| `inventory/progress-card.tsx` | Прогресс ревизии (по станциям) |
| `inventory/report-items-table.tsx` | Таблица итогов ревизии |
| `inventory/audit-log-tab.tsx` | Вкладка истории изменений |
| `inventory/sync-status-indicator.tsx` | Индикатор онлайн/оффлайн/syncing |
| `inventory/queue-repair-sheet.tsx` | UI управления оффлайн-очередью |
| `inventory/success-glow.tsx` | Анимация успешного сохранения |

#### UI (shadcn/ui)
`button`, `input`, `select`, `dialog`, `alert-dialog`, `dropdown-menu`, `sheet`, `badge`, `label`, `skeleton`, `ios-install-prompt`

#### Providers
- `providers/query-provider.tsx` — TanStack Query `QueryClient`
- `pwa/sw-registrar.tsx` — регистрация Service Worker

### 7.5 Хуки (`lib/hooks/`)

| Хук | Описание |
|-----|----------|
| `useCurrentUser` | GET `/users/me`, кэш в localStorage, сброс при 401 |
| `useHeartbeat` | POST `/users/heartbeat` каждые 30 с |
| `useOnlineUsers` | GET `/users/online` каждые 15 с |
| `useMaintenanceMode` | GET `/health/ready` каждые 30 с |
| `useSuccessGlow` | Анимация glow при сохранении |
| `useFastEntry` | Главный хук ввода (≈800 строк): поиск, qty, favorites, offline, draft, sync |
| `useAppReady` | Заглушка готовности приложения |

### 7.6 Оффлайн-архитектура

Система обеспечивает работу при отсутствии сети:

```
[User Input]
     │ online?
     ├── YES → POST /inventory/.../entries  (с Idempotency-Key)
     │              ↓ 200 OK → invalidate queries
     └── NO  → добавить в OfflineEntryQueue (IndexedDB / localStorage fallback)
                    ↓ при восстановлении сети
                syncOfflineQueue() → retry с backoff

IndexedDB stores:
  pending_entries          — offline queue (keyPath: idempotency_key)
  inventory_catalog        — кэш каталога (ETag-based, keyPath: warehouse_id)
  inventory_entries_snapshot — снапшот позиций сессии (keyPath: session_id)
```

**Deduplication:** каждый запрос несёт `Idempotency-Key` (UUID). Бэкенд хранит ключи в таблице `idempotency_keys`.

**Draft restore:** незавершённый ввод (search + qty) сохраняется в localStorage по ключу `username:warehouseId`, восстанавливается при следующем открытии вкладки (TTL 7 дней).

**Build-version healing:** при обнаружении смены build-ID (`NEXT_PUBLIC_BUILD_TS`) автоматически очищаются StateCache (IndexedDB catalog/snapshot, localStorage профиль и драфт), но **не** pending_entries.

### 7.7 Интернационализация

| Язык | Код | Файл |
|------|-----|------|
| Русский (default) | `ru` | `lib/i18n/dictionaries/ru.ts` |
| Казахский | `kk` | `lib/i18n/dictionaries/kk.ts` |

`LanguageProvider` + `useLanguage()` + `t(key)`. Язык хранится в `localStorage` (`app-language`). Казахский словарь частичный — недостающие ключи fallback к русскому. Всего ≈ 180 ключей.

---

## 8. Бизнес-логика — Ревизия (Inventory)

### 8.1 Жизненный цикл сессии

```
            start ─────────────────── close
                 ╲                  ╱
                  DRAFT ─────────► CLOSED
                    ╲              ╱
                     reopen ──────
```

- Один склад — максимум 1 активная (DRAFT) сессия (UNIQUE partial index).
- `revision_no` — монотонный счётчик по складу.
- При закрытии снапшотятся итоги в `inventory_session_totals`.

### 8.2 Ввод позиции

Режимы (EntryAction):
- **ADD** — добавить к текущему количеству
- **SET** — установить абсолютное значение

Optimistic locking: при SET клиент передаёт ожидаемый `version` через заголовок `If-Match`. Сервер сравнивает с текущим; при несовпадении — 409 `VERSION_CONFLICT`.

Валидация количества:
- Минимум: 0.01
- Для штучных единиц (pcs/шт): только целые значения
- Выравнивание по `step` (кроме kg/l)
- Soft-предупреждение при аномально большом значении

### 8.3 Прогресс

Прогресс ревизии отслеживается через:
- Общее число уникальных позиций, которые внёс текущий пользователь
- Разбивка по станциям / зонам (`inventory_zone_progress`)

---

## 9. Безопасность

| Механизм | Реализация |
|----------|----------|
| Пароли | bcrypt (passlib/bcrypt cost factor 12) |
| JWT | HS256, 30 мин, секрет из `JWT_SECRET` |
| Refresh-токены | Случайный UUID → bcrypt-хеш в БД, rotation при каждом use |
| CSRF | httpOnly cookies + SameSite, CORS ограничен |
| Rate limiting | Middleware in-memory sliding window |
| SQL-инъекции | SQLAlchemy ORM (параметризованные запросы) |
| Soft-delete | Пользователи и сессии помечаются `deleted_at`, не удаляются физически |
| Audit trail | Append-only таблица `audit_logs` с hash-chain |
| Idempotency | Таблица `idempotency_keys` (TTL-based cleanup) |

---

## 10. Тестирование

Backend (`tests/`, pytest):
- `test_auth_and_health.py` — вход, /health
- `test_inventory_flow.py` — полный сценарий ревизии
- `test_inventory_audit.py` — аудит-лог
- `test_inventory_optimistic_lock.py` — VERSION_CONFLICT
- `test_inventory_idempotency.py` — дублирующие запросы
- `test_inventory_negative.py` — граничные случаи
- `test_items_catalog_management.py`, `test_items_import_export.py`, etc.
- `test_postgres_contract.py` — контракт с PostgreSQL
- 21 файл тестов в общей сложности

Frontend (`tests/`, Playwright):
- E2E тесты через `playwright.config.ts`

---

## 11. Зависимости

### Backend (основные)
```
fastapi==0.129.2
SQLAlchemy==2.0.46
psycopg[binary]        # PostgreSQL driver (psycopg3)
alembic==1.18.4        # DB migrations
pydantic==2.12.1
pydantic-settings==2.13.1
PyJWT==2.10.1
bcrypt==4.0.1
passlib==1.7.4
gunicorn==23.0.0
uvicorn==0.41.0
boto3>=1.35.0          # S3 backup uploads
openpyxl==3.1.5        # XLSX import/export
python-multipart==0.0.22
```

### Frontend (основные)
```
next==14.2.35
react==18
typescript==5
tailwindcss==3.4.1
@tanstack/react-query==5.66.9
@tanstack/react-virtual==3.13.22   # виртуальный список
@radix-ui/*            # shadcn/ui primitives
lucide-react==0.575.0
clsx + tailwind-merge
@playwright/test==1.52.0
```

---

## 12. Известные ограничения и технический долг

| Тема | Описание |
|------|----------|
| `admin` role | legacy-alias для `chef`; в коде везде обрабатывается отдельно |
| `warehouse_id` vs `default_warehouse_id` | два FK на складе у пользователя; `warehouse_id` = текущий, `default_warehouse_id` = постоянный |
| Maintenance mode | флаг в памяти (middleware), не персистируется — сбрасывается при перезапуске |
| Rate limiter | хранится в памяти одного процесса; при WEB_CONCURRENCY > 1 не синхронизируется |
| Казахский перевод | частичный; fallback к русскому |
| `inventory_zone_progress` | модель заведена, но population-логика в роутере inventory |
| PWA / Service Worker | sw-registrar подключён, но полноценный `manifest.ts` только базовый |

---

## 13. Локальная разработка

```powershell
# Корень: inventory-app/
.\start-dev.ps1          # запускает docker compose dev + next dev
```

Backend dev:
```bash
cd backend
docker compose up -d     # PostgreSQL
uvicorn app.main:app --reload --port 8000
```

Frontend dev:
```bash
cd frontend
npm install
npm run dev              # http://localhost:3000
```

Тесты backend:
```bash
cd backend
pytest tests/ -v
```

---

## 14. Деплой — задачи на сервере

```bash
# SSH: root@89.23.96.231
cd ~/Resident\ Restaurant/inventory-app/backend
git pull
docker compose -f docker-compose.prod.yml build api    # применить Dockerfile-изменения
docker compose -f docker-compose.prod.yml up -d api
# Фронтенд пересобирается при изменении build-args:
docker compose -f docker-compose.prod.yml build frontend
docker compose -f docker-compose.prod.yml up -d frontend
```

---

*Документ сгенерирован автоматически на основе анализа исходного кода.*
