# RESINT — Полный слепок архитектуры

> Документ для внешнего архитектора. Содержит полное описание системы для продолжения разработки.
> Сгенерирован: 2026-03-14 · Версия приложения: 0.3.0

---

## 1. Обзор системы

**RESINT** — система инвентаризации ресторана «Zere». Позволяет команде кухни и бара проводить ревизии товарных остатков через мобильные устройства с поддержкой offline-режима.

### Стек технологий

| Слой | Технологии |
|------|-----------|
| **Backend** | Python 3.14, FastAPI 0.129.2, SQLAlchemy 2.0.46, Pydantic 2.12.5, Alembic 1.18.4, PyJWT 2.10.1 |
| **Database** | PostgreSQL 16 (psycopg-binary) |
| **Frontend** | Next.js 14.2.35, React 18, TypeScript 5, TailwindCSS 3.4, shadcn/ui (Radix) |
| **State** | @tanstack/react-query 5.66 (серверный), React useState/useRef (клиентский) |
| **Auth** | JWT (PyJWT, HS256) + Refresh Tokens (bcrypt/passlib), HttpOnly cookies |
| **Offline** | IndexedDB (3 store), localStorage fallback |
| **i18n** | 2 языка (ru, kk), ~398 ключей перевода |
| **Testing** | pytest 112 тестов (backend), Playwright (frontend E2E) |
| **Deploy** | Docker, docker-compose, Gunicorn+Uvicorn, Nginx |

### Архитектурная схема

```
┌───────────────────────────────────────────────────────────┐
│                    Клиент (браузер / PWA)                  │
│  Next.js App (React 18, TailwindCSS, shadcn/ui)           │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐     │
│  │ IndexedDB    │  │ localStorage │  │ React Query   │     │
│  │ • pending    │  │ • draft      │  │ ~18 queries   │     │
│  │   entries    │  │ • user cache │  │ ~8 mutations   │     │
│  │ • catalog    │  │ • favorites  │  │ stale: 60s    │     │
│  │ • snapshot   │  │ • language   │  │               │     │
│  └─────────────┘  └──────────────┘  └───────────────┘     │
└──────────────────────────┬────────────────────────────────┘
                           │ HTTP (fetch)
                           ▼
┌───────────────────────────────────────────────────────────┐
│  Next.js API Routes (Server-side proxy)                   │
│  /api/auth/login  — логин, ставит HttpOnly cookies        │
│  /api/auth/logout — чистит cookies, ревокает refresh      │
│  /api/backend/[...path] — прозрачный прокси к FastAPI     │
│    • JWT из cookie → Authorization header                 │
│    • Автообновление токенов (transparent refresh)         │
│    • Таймаут 4.5с                                        │
│    • Прокидка: Idempotency-Key, If-Match, If-None-Match  │
│    • Фильтрация hop-by-hop (content-encoding, etc.)      │
└──────────────────────────┬────────────────────────────────┘
                           │ HTTP
                           ▼
┌───────────────────────────────────────────────────────────┐
│  FastAPI Backend (Gunicorn + Uvicorn workers)             │
│  ┌──────────────┐ ┌────────────┐ ┌─────────────────────┐ │
│  │ Middleware    │ │ Routers    │ │ Services            │ │
│  │ • GZip       │ │ • auth     │ │ • audit (hash-chain)│ │
│  │ • Logging    │ │ • users    │ │ • export (XLSX/CSV) │ │
│  │ • RateLimit  │ │ • items    │ │ • export_repository │ │
│  │ • Maintenance│ │ • inventory│ │                     │ │
│  │ • CORS       │ │ • stations │ │                     │ │
│  │              │ │ • zones    │ │                     │ │
│  │              │ │ • warehouses│                      │ │
│  │              │ │ • health   │ │                     │ │
│  │              │ │ • backups  │ │                     │ │
│  └──────────────┘ └────────────┘ └─────────────────────┘ │
└──────────────────────────┬────────────────────────────────┘
                           │ SQLAlchemy 2.0
                           ▼
┌───────────────────────────────────────────────────────────┐
│  PostgreSQL 16                                            │
│  18 таблиц, 38 Alembic миграций, HEAD: m2n3o4p5q6r7      │
└───────────────────────────────────────────────────────────┘
```

---

## 2. Структура проекта

```
inventory-app/
├── start-dev.ps1                # Запуск backend + frontend параллельно (PS1)
├── docs/
│   ├── ARCHITECTURE_SNAPSHOT.md # Этот файл
│   └── fast-entry-spec.md       # UX-спецификация быстрого ввода (20 acceptance criteria)
│
├── backend/                     # Python 3.14, FastAPI
│   ├── pyproject.toml           # name=resint-backend, v0.3.0, Ruff конфиг
│   ├── requirements.txt         # 36 зависимостей
│   ├── requirements-dev.txt     # pytest, httpx, coverage
│   ├── pytest.ini               # -q, markers: postgres
│   ├── alembic.ini
│   ├── Dockerfile               # python:3.12-slim (production image)
│   ├── docker-compose.yml       # dev: postgres:16 + backend
│   ├── docker-compose.prod.yml  # prod: postgres + backend (gunicorn) + nginx
│   │
│   ├── alembic/
│   │   ├── env.py               # Alembic env с online/offline
│   │   └── versions/            # 38 миграций, HEAD: m2n3o4p5q6r7
│   │
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py              # ~100 строк — FastAPI init, middleware stack, routers, exception handlers
│   │   ├── core/                # 12 файлов — config, security, deps, roles, errors, middleware, metrics, clock
│   │   ├── db/                  # engine, session (pool_pre_ping, 3s connect timeout), Base
│   │   ├── models/              # 18 файлов — 18 SQLAlchemy моделей + enums
│   │   ├── schemas/             # 5 файлов — Pydantic v2 схемы (~40 классов)
│   │   ├── routers/             # 9 файлов — ~4700 строк (inventory.py: 2900)
│   │   ├── services/            # 3 файла — audit, export, export_repository
│   │   └── templates/           # Excel шаблоны (accounting_v1.xlsx)
│   │
│   ├── scripts/                 # Утилиты: bulk_create_users, create_test_data, set_password
│   └── tests/                   # 24 файла, 112 тест-функций
│
└── frontend/                    # Next.js 14.2.35, React 18
    ├── package.json             # name=resint-frontend, v0.3.0
    ├── middleware.ts             # Auth guard — 42 строки
    ├── next.config.mjs          # Пустой конфиг
    ├── tailwind.config.ts
    ├── playwright.config.ts     # E2E: baseURL localhost:3000
    │
    ├── app/
    │   ├── layout.tsx           # Root: LanguageProvider → QueryProvider → AppShell
    │   ├── page.tsx             # redirect("/login")
    │   ├── error.tsx            # Error boundary
    │   ├── global-error.tsx     # Root error boundary
    │   ├── globals.css
    │   ├── (auth)/login/        # Страница логина (153 стр.)
    │   ├── inventory/           # Главная — ревизия (3520 стр.)
    │   ├── items/               # Каталог товаров (993 стр.)
    │   ├── users/               # Управление пользователями (894 стр.)
    │   ├── dashboard/           # Дашборд (87 стр.)
    │   ├── reports/             # Заглушка (5 стр.)
    │   ├── settings/            # Настройки профиля (300 стр.)
    │   ├── backups/             # Бэкапы БД (279 стр.)
    │   └── api/                 # Server-side proxy routes
    │       ├── auth/login/      # POST: логин → cookies
    │       ├── auth/logout/     # POST: logout → clear cookies
    │       └── backend/[...path]/ # Прозрачный прокси ко всем API
    │
    ├── components/              # 25 файлов
    │   ├── inventory/           # 9 компонентов ввода/отчётов ревизии
    │   ├── layout/              # AppShell (565 стр.), EmptyState, PageSkeleton, PageStub
    │   ├── providers/           # QueryProvider (TanStack)
    │   ├── pwa/                 # SW registrar
    │   └── ui/                  # 11 shadcn/ui компонентов (Radix)
    │
    └── lib/
        ├── api/                 # 12 файлов — types (304 стр.), request, http, inventory, items, users, auth, admin, client, error-mapper, warehouses, auth-cookie
        ├── hooks/               # 6 хуков — useCurrentUser, useHeartbeat, useOnlineUsers, useMaintenanceMode, useSuccessGlow, useAppReady
        ├── i18n/                # 4 файла — 2 языка (ru, kk), ~398 ключей, LanguageProvider
        ├── items/
        │   └── bulk-parser.ts   # Парсер 4 форматов массового импорта
        ├── format-quantity.ts   # Форматирование qty + unit
        ├── inventory-offline-cache.ts # Кэш каталога/snapshot в localStorage
        ├── offline-db.ts        # IndexedDB: 3 stores
        ├── offline-entry-queue.ts # Очередь offline записей (IndexedDB + LS)
        ├── permissions.ts       # Клиентская проверка ролей (зеркало backend)
        └── utils.ts             # cn() (Tailwind merge)
```

---

## 3. База данных — 18 таблиц

### 3.1 ER-диаграмма (ключевые связи)

```
zones ──1:N──> warehouses ──1:N──> items
                    │                  │
                    │                  ├──> item_categories (FK nullable)
                    │                  ├──> item_aliases (1:N)
                    │                  ├──> item_usage_stats (unique: warehouse+item)
                    │                  └──> stations (FK nullable)
                    │
                    └──1:N──> inventory_sessions ──1:N──> inventory_entries
                                   │                          │
                                   │                          ├──> inventory_entry_events (audit)
                                   │                          └──> users (updated_by_user_id)
                                   │
                                   ├──> inventory_session_events (audit)
                                   ├──> inventory_zone_progress (per zone)
                                   ├──> inventory_session_totals (snapshot on close)
                                   └──> users (created_by_user_id)

users ──> refresh_tokens (1:N)
      ──> idempotency_keys (1:N)
      ──> audit_log (actor_id)
```

### 3.2 Модели

#### `User` (`models/user.py`)
```python
id: int (PK)
username: str (unique, 50)
full_name: str | None (120)
password_hash: str (255)
role: str (30)       # "cook" | "souschef" | "chef" | "manager" | "admin"(legacy)
department: str | None  # ENUM "kitchen" | "bar" (через UserDepartment)
warehouse_id: int | None (FK → warehouses)
default_station_id: int | None (FK → stations)
default_warehouse_id: int | None (FK → warehouses)
is_active: bool (default True)
preferred_language: str | None (5)
deleted_at: datetime | None (tz)
last_seen_at: datetime | None (tz)
```

#### `Warehouse` (`models/warehouse.py`)
```python
id: int (PK)
name: str (unique, 100)
zone_id: int (FK → zones, NOT NULL)
is_active: bool (default True)
# Relationships: items[], zone
```

#### `Zone` (`models/zone.py`)
```python
id: int (PK)
name: str (unique, 120)
description: str | None (255)
# Relationships: warehouses[]
```

#### `Station` (`models/station.py`)
```python
id: int (PK)
name: str (100)
department: str  # ENUM "kitchen" | "bar" (StationDepartment)
is_active: bool (default True)
sort_order: int | None
```

#### `Item` (`models/item.py`)
```python
id: int (PK)
product_code: str | None (unique, 64)  # ^\d{5}$, nullable
name: str (200)
unit: str (20)             # "kg" | "l" | "pcs" | "pack" | "bottle"
step: float (default 1.0)
min_qty: float (default 0.0)
max_qty: float | None
is_favorite: bool (default False)
is_active: bool (default True)
updated_at: datetime (tz)
warehouse_id: int (FK → warehouses)
category_id: int | None (FK → item_categories)
station_id: int | None (FK → stations)
# Relationships: warehouse, category, station
```

#### `ItemCategory` (`models/item_category.py`)
```python
id: int (PK)
name: str (unique, 100)
# Relationships: items[]
```

#### `ItemAlias` (`models/item_alias.py`)
```python
id: int (PK)
item_id: int (FK → items)
alias_text: str (200)
# UC(item_id, alias_text)
```

#### `ItemUsageStat` (`models/item_usage_stat.py`)
```python
id: int (PK)
warehouse_id: int (FK → warehouses)
item_id: int (FK → items)
use_count: int (default 0)
last_used_at: datetime | None (tz)
# UC(warehouse_id, item_id)
```

#### `InventorySession` (`models/inventory_session.py`)
```python
id: int (PK)
warehouse_id: int (FK → warehouses)
created_by_user_id: int (FK → users)
revision_no: int
status: str (20)     # "draft" | "closed"
is_closed: bool (default False)
created_at: datetime (server_default=now)
updated_at: datetime (tz)
deleted_at: datetime | None (tz)
# UC(warehouse_id, revision_no)
# Partial unique: warehouse_id WHERE status='draft' (max 1 active per warehouse)
# Relationships: entries[]
```

#### `InventoryEntry` (`models/inventory_entry.py`)
```python
id: int (PK)
session_id: int (FK → inventory_sessions)
item_id: int (FK → items)
quantity: Numeric(12,3)
version: int (default 1)      # Optimistic locking
counted_outside_zone: bool (default False)
counted_by_zone_id: int | None (FK → zones)
station_id: int | None (FK → stations)
outside_zone_note: str | None (500)
updated_by_user_id: int | None (FK → users)
updated_at: datetime
# UC(session_id, item_id)
# Relationships: session, item, zone, station
```

#### `InventoryEntryEvent` — аудит записей (`models/inventory_entry_event.py`)
```python
id: int (PK)
session_id: int (FK)
item_id: int (FK)
actor_user_id: int (FK)
action: str (20)       # "add" | "set" | "reset_conflict" | "patch" | "correct_after_close"
reason: str | None (Text)
counted_outside_zone: bool | None
counted_by_zone_id: int | None (FK)
station_id: int | None (FK)
outside_zone_note: str | None (500)
request_id: str | None (100)
before_quantity: Numeric(12,3) | None
after_quantity: Numeric(12,3)
created_at: datetime (tz)
# Composite index: (session_id, item_id)
```

#### `InventorySessionEvent` — аудит сессий (`models/inventory_session_event.py`)
```python
id: int (PK)
session_id: int (FK)
actor_user_id: int (FK)
action: str (40)       # "create" | "close" | "reopen" | "soft_delete" | "zone_completed"
reason: str | None (Text)
request_id: str | None (100)
created_at: datetime (tz)
```

#### `InventorySessionTotal` — снимок при закрытии (`models/inventory_session_total.py`)
```python
id: int (PK)
session_id: int (FK)
item_id: int (FK)
qty_final: Numeric(12,3)
unit: str (20)
# UC(session_id, item_id)
```

#### `InventoryZoneProgress` (`models/inventory_zone_progress.py`)
```python
id: int (PK)
session_id: int (FK)
zone_id: int (FK)
warehouse_id: int (FK)
entered_items_count: int (default 0)
last_activity_at: datetime | None (tz)
is_completed: bool (default False)
completed_at: datetime | None (tz)
completed_by_user_id: int | None (FK)
created_at: datetime (tz)
updated_at: datetime (tz)
# UC(session_id, zone_id)
```

#### `IdempotencyKey` (`models/idempotency_key.py`)
```python
id: int (PK)
user_id: int (FK)
endpoint: str (200)
idempotency_key: str (200)
request_hash: str | None (64)   # SHA-256 хеш тела запроса
response_status: int
response_body: str (Text)
created_at: datetime (tz)
# UC(user_id, endpoint, idempotency_key)
# TTL: настраивается через idempotency_key_ttl_hours (default 48h)
```

#### `RefreshToken` (`models/refresh_token.py`)
```python
id: int (PK)
user_id: int (FK → users)
token_hash: str (unique, 128)   # SHA-256 хеш токена
expires_at: datetime (tz)
created_at: datetime (tz)
revoked_at: datetime | None (tz)
replaced_by_token_id: int | None (FK → refresh_tokens self-ref)
```

#### `AuditLog` — blockchain-style (`models/audit_log.py`)
```python
id: int (PK)
actor_id: int (FK → users)
action: str (60)
entity_type: str (40)
entity_id: int | None
warehouse_id: int | None (FK)
metadata_json: str | None (Text)   # JSON с деталями
created_at: datetime (tz)
previous_hash: str (64)            # SHA-256 хеш предыдущей записи
hash: str (64)                     # SHA-256(created_at|actor_id|action|entity_type|entity_id|metadata|previous_hash)
# Composite index: (entity_type, entity_id)
```

### 3.3 Enums (`models/enums.py`)

```python
class SessionStatus(str, Enum):
    DRAFT = "draft"
    CLOSED = "closed"

class EntryAction(str, Enum):
    ADD = "add"
    SET = "set"
    PATCH = "patch"
    CORRECT_AFTER_CLOSE = "correct_after_close"

class SessionEventAction(str, Enum):
    SESSION_CLOSED = "session_closed"
    REVISION_REOPENED = "revision_reopened"
    SESSION_DELETED = "session_deleted"
    ZONE_COMPLETED = "zone_completed"

class AuditAction(str, Enum):
    # 7 действий: session_create, session_close, session_reopen,
    #             session_delete, entry_add, entry_update, zone_complete
```

---

## 4. Аутентификация и авторизация

### 4.1 Auth Flow

```
1. Login: POST /api/auth/login
   Client → Next.js API Route → Backend /auth/login
   ← access_token + refresh_token
   Next.js ставит HttpOnly cookies:
     rr_access_token  (maxAge: 12h)
     rr_refresh_token (maxAge: 14 дней)

2. Authenticated request:
   Client → Next.js /api/backend/[...path]
   Next.js читает cookie → добавляет Authorization: Bearer <token>
   → Backend

3. Token refresh (transparent):
   Если backend вернул 401 → Next.js proxy автоматически:
     POST /auth/refresh { refresh_token }
     ← новые токены
     → обновляет cookies
     → повторяет исходный запрос

4. Logout: POST /api/auth/logout
   → ревокает refresh token на backend
   → чистит cookies
```

### 4.2 JWT Access Token
- Алгоритм: HS256 (PyJWT)
- Payload: `sub` (username), `role`, `exp`
- TTL: 30 минут (настраивается через `ACCESS_TOKEN_EXPIRE_MINUTES`)
- Secret: `JWT_SECRET_KEY` (env var)

### 4.3 Refresh Token
- Генерируется: `secrets.token_urlsafe(48)`
- В БД: хранится `SHA-256(token)`, не сам токен
- TTL: 14 дней
- Ротация: при обновлении старый ревокается, ставится ссылка на новый (`replaced_by_token_id`)
- Сравнение: HMAC-safe через `hmac.compare_digest`

### 4.4 RBAC — Ролевая модель

5 ролей с иерархией прав:

| Роль | Описание |
|------|----------|
| `cook` | Базовый пользователь. Только ввод данных ревизии |
| `souschef` | + управление ревизиями, каталогом, экспорт, аудит |
| `chef` | Аналогично souschef |
| `manager` | + управление пользователями, станциями, доступ ко всем складам, бэкапы |
| `admin` | Legacy, маппится на `chef` |

7 наборов разрешений (permission sets в `core/roles.py`):

| Разрешение | Роли |
|------------|------|
| `USER_MANAGE` | manager |
| `STATION_MANAGE` | manager |
| `REVISION_MANAGE` | souschef, chef, manager |
| `CATALOG_MANAGE` | souschef, chef, manager |
| `EXPORT` | souschef, chef, manager |
| `AUDIT_VIEW` | souschef, chef, manager |
| `ALL_WAREHOUSE` | manager |

Фронтенд зеркалирует в `lib/permissions.ts`: `canManageUsers()`, `canManageRevision()`, `canManageCatalog()`, `canExport()`, `canViewAudit()`, `canAccessAllWarehouses()`, `canManageBackups()`.

---

## 5. Backend API — Полная карта эндпоинтов (~60+)

### 5.1 Auth (`/auth`) — 104 строки

| Метод | Путь | Описание |
|-------|------|----------|
| POST | `/auth/login` | Логин → access + refresh токены |
| POST | `/auth/refresh` | Обновление токенов |
| POST | `/auth/logout` | Ревокация refresh token |
| GET | `/auth/me` | Текущий профиль пользователя |

### 5.2 Users (`/users`) — 392 строки

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/users/me` | Профиль текущего пользователя |
| PATCH | `/users/me` | Обновить свой профиль (full_name, language) |
| POST | `/users/me/password` | Смена своего пароля |
| GET | `/users` | Список пользователей (фильтры: search, role, warehouse_id) |
| POST | `/users` | Создать пользователя (manager only) |
| PATCH | `/users/{user_id}` | Редактировать пользователя (manager only) |
| POST | `/users/{user_id}/reset-password` | Сбросить пароль (manager only) |
| DELETE | `/users/{user_id}` | Soft-delete пользователя (manager only) |
| POST | `/users/heartbeat` | Heartbeat для отслеживания online статуса (30с) |
| GET | `/users/online` | Список онлайн-пользователей |

### 5.3 Items (`/items`) — 852 строки

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/items` | Список товаров (фильтры: warehouse_id, category_id, q) |
| POST | `/items` | Создать товар |
| PATCH | `/items/{item_id}` | Обновить товар |
| GET | `/items/units` | Список доступных единиц измерения |
| GET | `/items/recent` | Недавно использованные товары |
| GET | `/items/frequent` | Часто используемые товары |
| GET | `/items/search` | Поиск товаров (с алиасами; rate limit: 120/60s) |
| POST | `/items/import` | Импорт из CSV/XLSX |
| GET | `/items/export` | Экспорт каталога |
| POST | `/items/bulk-upsert` | Массовый upsert (dry_run поддержка) |
| GET | `/items/categories` | Список категорий |
| POST | `/items/categories` | Создать категорию |
| POST | `/items/{item_id}/aliases` | Добавить алиас |
| DELETE | `/items/{item_id}/aliases/{alias_id}` | Удалить алиас |

### 5.4 Inventory (`/inventory`) — 2900 строк, основной домен

#### Сессии (ревизии)

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/inventory/sessions` | Список ревизий (фильтры: warehouse_id, include_deleted, limit) |
| POST | `/inventory/sessions` | Создать новую ревизию |
| GET | `/inventory/sessions/{session_id}` | Детали ревизии |
| GET | `/inventory/sessions/active` | Найти/создать активную ревизию |
| POST | `/inventory/sessions/{session_id}/close` | Закрыть ревизию (создаёт snapshot) |
| POST | `/inventory/sessions/{session_id}/reopen` | Переоткрыть закрытую ревизию |
| DELETE | `/inventory/sessions/{session_id}` | Soft-delete ревизии (с reason) |

#### Записи (entries)

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/inventory/sessions/{session_id}/entries` | Все записи ревизии |
| POST | `/inventory/sessions/{session_id}/entries` | Добавить/обновить запись (idempotent, mode: add/set) |
| PATCH | `/inventory/sessions/{session_id}/entries/{item_id}` | Патч записи (optimistic lock через version) |

#### Каталог и снимки

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/inventory/sessions/{session_id}/catalog` | Каталог товаров + ETag/304 |
| GET | `/inventory/sessions/{session_id}/entries/snapshot` | Снимок текущих записей |

#### Прогресс

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/inventory/sessions/{session_id}/progress` | Прогресс сессии (total/my counts) |
| GET | `/inventory/progress` | Прогресс по зонам |
| POST | `/inventory/sessions/{session_id}/zone-complete` | Отметить зону завершённой |

#### Журнал

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/inventory/sessions/{session_id}/entries/recent` | Последние записи |
| GET | `/inventory/sessions/{session_id}/entries/recent-events` | Последние события с деталями |

#### Аудит

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/inventory/sessions/{session_id}/audit` | Аудит записей сессии |
| GET | `/inventory/sessions/{session_id}/audit-log` | Blockchain audit log сессии |
| GET | `/inventory/audit-log/verify` | Верификация hash-цепочки |
| GET | `/inventory/audit` | Глобальный аудит (все сессии) |
| GET | `/inventory/sessions/{session_id}/events` | Системные события сессии |

#### Отчёты

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/inventory/reports/session/{session_id}` | Отчёт по сессии |
| GET | `/inventory/sessions/{session_id}/items/{item_id}/contributors` | Кто вносил данные |
| GET | `/inventory/sessions/{session_id}/participants` | Сводка по участникам |
| GET | `/inventory/sessions/{session_id}/export` | Экспорт в XLSX (3 формата) |
| GET | `/inventory/reports/diff` | Сравнение двух ревизий |
| GET | `/inventory/reports/diff/today` | Сравнение утро vs вечер |

### 5.5 Warehouses, Zones, Stations

| Метод | Путь | Строки | Описание |
|-------|------|--------|----------|
| GET | `/warehouses` | 34 | Список складов |
| POST | `/warehouses` | | Создать склад |
| GET | `/zones` | 23 | Список зон |
| POST | `/zones` | | Создать зону |
| GET | `/stations` | 60 | Список станций (фильтр: department, is_active) |
| POST | `/stations` | | Создать станцию |
| PATCH | `/stations/{station_id}` | | Обновить станцию |

### 5.6 Health & Admin

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/health` | Health check |
| GET | `/health/live`, `/live` | Liveness probe |
| GET | `/health/ready`, `/ready` | Readiness (DB ping + migration) |
| GET | `/admin/system-status` | Системный статус |
| GET | `/metrics` | Prometheus-format метрики |
| GET | `/admin/backups` | Список бэкапов |
| GET | `/admin/backups/download/{filename}` | Скачать бэкап |
| GET | `/admin/backups/status` | Статус maintenance mode |
| POST | `/admin/backups/restore` | Восстановить из бэкапа |

---

## 6. Middleware стек (порядок в `main.py`)

```
Request →
  1. GZipMiddleware (minimum_size=500)
  →
  2. RequestLoggingMiddleware
     • UUID request_id (или из X-Request-Id header)
     • Замер duration_ms
     • Логирование: 5xx=error, 4xx=warning, rest=info
     • Slow request warning (>300ms)
  →
  3. RateLimitMiddleware (in-memory sliding window)
     • POST /auth/login: 5 fails / 5min per IP
     • GET /items/search: 120 req / 60s per user
     • Потокобезопасный (thread-safe locking)
  →
  4. MaintenanceMiddleware
     (блокирует write-запросы если is_maintenance_mode=true)
     Exempt: /health, /admin/backups
  →
  5. CORSMiddleware
     • allow_origins: из CORS_ALLOW_ORIGINS env (comma-separated)
     • allow_methods: ["*"]
     • allow_headers: Authorization, Content-Type, Idempotency-Key, If-Match, x-request-id
     • allow_credentials: true
  →
  Exception Handlers
     • HTTPException → structured JSON
     • RequestValidationError → code VALIDATION_ERROR
     • unhandled Exception → DB_ERROR / INTERNAL_ERROR
  →
  Router logic
```

---

## 7. Ключевые паттерны Backend

### 7.1 Идемпотентность (POST entries)

1. Клиент генерирует UUID `idempotency_key`
2. Backend проверяет `(user_id, endpoint, idempotency_key)` в таблице `idempotency_keys`
3. Если ключ найден и `request_hash` (SHA-256 тела) совпадает → replay (кэшированный ответ)
4. Если hash не совпадает → 409 Conflict
5. Если ключа нет → выполняет, сохраняет результат
6. TTL: 48 часов (настраивается через `idempotency_key_ttl_hours`)

### 7.2 Optimistic Locking

- Каждая `InventoryEntry` имеет `version`
- При PATCH: `expected_version` / `If-Match` header
- Несовпадение → 409 `VERSION_CONFLICT`
- При успехе `version++`

### 7.3 Audit Hash Chain (blockchain-style)

- Каждая запись `audit_log` содержит `previous_hash`
- Для первой записи: `previous_hash = GENESIS_HASH ("0" * 64)`
- `hash = SHA-256(created_at|actor_id|action|entity_type|entity_id|metadata|previous_hash)`
- Верификация: `GET /inventory/audit-log/verify` проходит цепочку от начала

### 7.4 Snapshot on Close

- При закрытии ревизии → `InventorySessionTotal` для каждой записи
- Фиксирует `qty_final` и `unit` на момент закрытия
- Экспорт закрытой ревизии использует snapshot, не текущие entries

### 7.5 Zone Progress

- `InventoryZoneProgress` — по зонам
- `entered_items_count` обновляется автоматически при добавлении записей
- `is_completed` — через endpoint `zone-complete`
- Автоматически откатывается при новых записях

### 7.6 Structured Error Responses

```json
{
  "error": {
    "code": "SESSION_CLOSED",
    "message": "Ревизия уже закрыта",
    "details": null
  }
}
```

Коды: `SESSION_CLOSED`, `SESSION_READ_ONLY`, `VERSION_CONFLICT`, `VALIDATION_STEP_MISMATCH`, `ITEM_INACTIVE`, `MAINTENANCE_MODE`, `SEARCH_RATE_LIMIT_EXCEEDED`, `AUTH_RATE_LIMIT_EXCEEDED`, `DB_CONNECTION_ERROR`, `INTERNAL_ERROR`, `IDEMPOTENCY_REPLAY`, `VALIDATION_ERROR`.

---

## 8. Frontend — Ключевые паттерны

### 8.1 Server-Side Proxy Pattern

```
Browser → /api/backend/items → Next.js server → http://backend:8000/items
```

- Токен не покидает сервер (HttpOnly cookies)
- Transparent token refresh (retry on 401)
- Таймаут 4.5с
- Прокидка заголовков: Idempotency-Key, If-Match, If-None-Match, X-Request-Id
- Фильтрация hop-by-hop headers (content-encoding, transfer-encoding, etc.)
- Обработка ошибок: timeout → 504, network error → 502

### 8.2 React Query Data Flow

Единый React Query хук для текущего пользователя `useCurrentUser()`:
- Query key: `["current-user"]` (экспортируется как `CURRENT_USER_QUERY_KEY`)
- staleTime: 60с, refetchOnWindowFocus: false
- Пишет `query.data` в localStorage (`rr_current_user`) при обновлении
- Seed из localStorage при mount (instant placeholder)
- Возвращает `{ user, isLoading, is401 }`
- Используется в AppShell, Settings, Users и везде где нужен текущий профиль

Мутации инвалидируют связанные query ключи:
- Save/edit/undo entry → invalidate 7-10 ключей + increment `snapshotRefetchCounter`
- Settings save → invalidate `["current-user"]` + обновление localStorage
- Admin user edit → условная инвалидация `["current-user"]` при редактировании себя

### 8.3 Offline-First для ввода ревизии

```
┌─────────── Online ────────────┐   ┌────── Offline ──────┐
│ saveInventoryEntry() ─────────│───│→ addOfflineQueue()   │
│          ↓                    │   │          ↓           │
│   Backend response (200)      │   │   IndexedDB + LS     │
│          ↓                    │   │          ↓           │
│   Invalidate React Query      │   │   UI: "В очереди"    │
│   + refetch snapshot          │   │          ↓           │
│                               │   │   Auto-sync on       │
│                               │   │   reconnect (~12s)   │
└───────────────────────────────┘   └─────────────────────┘
```

Три хранилища IndexedDB:
1. `pending_entries` — очередь записей для синхронизации
2. `inventory_catalog` — кэш каталога (с ETag)
3. `inventory_entries_snapshot` — кэш текущих записей

Fallback: если IndexedDB недоступен → localStorage.

### 8.4 Conditional Caching (ETag / 304)

- `fetchSessionCatalog(sessionId, {etag, lastModified})`
- Backend: `GET /inventory/sessions/{id}/catalog` с `ETag` + `Last-Modified`
- При 304 → используется кэш из IndexedDB

### 8.5 i18n (интернационализация)

- 2 языка: Русский (основной), Казахский (частичный)
- ~398 ключей перевода в каждом словаре
- `LanguageProvider` → React Context → `useLanguage()` → `t(key)`
- Язык сохраняется в localStorage + backend (`preferred_language`)
- Fallback: если ключ не найден в kk → ru
- Категории ключей: lang, nav, common, inventory, items, users, settings, backups, roles, errors, reports, dashboard, audit, progress, stations, categories, units, search, offline

### 8.6 Role-Based UI

```typescript
// lib/permissions.ts — зеркало backend roles.py
canManageUsers(role)          // manager, admin
canManageRevision(role)       // souschef, chef, manager, admin
canManageCatalog(role)        // souschef, chef, manager, admin
canExport(role)               // souschef, chef, manager, admin
canViewAudit(role)            // souschef, chef, manager, admin
canAccessAllWarehouses(role)  // manager, admin
canManageBackups(role)        // manager, admin
```

Используется для: скрытия навигации, кнопок, предупреждений о правах.

### 8.7 Layout Architecture

```
RootLayout
  └── LanguageProvider (i18n context, localStorage)
      └── QueryProvider (TanStack React Query)
          └── AppShell (565 стр.)
              ├── useCurrentUser() — единый хук профиля
              ├── [Desktop] Sidebar + Top Header
              ├── [Mobile] Bottom Tab Bar + Sheet Drawer
              ├── Auth gating (redirect to /login if no user)
              ├── Heartbeat (30s)
              ├── Online users polling (15s)
              ├── Maintenance mode polling (30s)
              ├── iOS PWA install prompt
              └── {children} ← Page content
```

### 8.8 Next.js Middleware (`middleware.ts`)

- Protected prefixes: `/dashboard`, `/inventory`, `/items`, `/reports`, `/settings`, `/users`
- Нет cookies (access/refresh) + protected route → redirect `/login?next={pathname}`
- Есть cookies + на `/login` → redirect `/inventory`

---

## 9. Страницы фронтенда — детальное описание

### 9.1 Inventory Page (`/inventory`) — 3520 строк

**Три режима работы (табы):**

1. **Ревизия** — основной ввод данных
   - Поиск товара (debounce 150ms, по каталогу с алиасами)
   - Быстрые чипы: Избранное ⭐, Частые, Недавние
   - Ввод количества с hot-buttons (+0.1, +0.5, +1, и т.д.)
   - Валидация: шаг, min/max, подтверждение больших значений
   - Журнал последних записей с undo/edit
   - Карточка прогресса
   - Offline sync indicator

2. **Управление** — для souschef+
   - Старт/закрытие/переоткрытие ревизии
   - Список последних ревизий (до 5)
   - Экспорт, удаление

3. **Отчёты** — аналитика по ревизиям
   - Выбор ревизии из списка
   - Позиции: таблица с фильтрацией, contributors, corrections
   - Люди: сводка по участникам
   - История: хронология событий
   - Аудит: blockchain audit log (souschef+)

**Ключевые механики:**
- ~50 useState хуков, ~18 React Query queries, ~8 mutations
- `snapshotRefetchCounter` — триггер перезагрузки entriesSnapshot после мутаций
- Optimistic updates для мгновенного отображения
- Idempotency-key для каждого сохранения
- Draft persistence (localStorage per user+warehouse)
- Touch-scroll guards для мобильных устройств
- ResizeObserver для синхронизации высоты панелей
- `warehouseOverrideRef` — предотвращает автовыбор склада при reopen (сбрасывается после reopen)

**React Query ключи:**
```
warehouses-manager-fallback, active-session-{whId},
search-items-{whId}-{term}, catalog-items-{whId},
recent-entries-{sId}, recent-events-{sId},
inventory-sessions-history-{whId},
session-entries-{sId}, session-audit-report-{sId},
session-item-contributors-{sId}-{itemId},
session-participants-{sId}, session-audit-log-{sId},
session-audit-{sId}, session-progress-{sId}
```

### 9.2 Items Page (`/items`) — 993 строки

- Фильтрация: зона (кухня/бар) → склад
- Поиск с модальным dropdown + прокрутка к найденному
- Создание одиночного товара (product_code, name, unit)
- Массовый импорт: textarea → `parseBulkLines()` → dry_run → upload (chunks по 100)
- Inline-редактирование: код, название, единица, is_active
- Автосохранение с debounce 400ms
- React Query ключи: `zones`, `warehouses-by-zone-{zone}`, `item-units`, `items-catalog-{whId}`

### 9.3 Users Page (`/users`) — 894 строки

- Список пользователей с фильтрами (search, role, warehouse)
- CRUD: создание, редактирование, сброс пароля, удаление
- Адаптивный: карточки (mobile) / таблица (desktop)
- Защита: нельзя заблокировать/удалить себя
- При редактировании себя → инвалидация `["current-user"]`
- React Query ключи: `warehouses`, `admin-users-{search}-{role}-{wh}`

### 9.4 Settings Page (`/settings`) — 300 строк

- Профиль: редактирование full_name → invalidate `["current-user"]` + localStorage
- Пароль: смена (текущий + новый + подтверждение)
- Язык: RU / KZ переключатель → invalidate `["current-user"]`

### 9.5 Backups Page (`/backups`) — 279 строк

- Список бэкапов (filename, size, date)
- Скачивание
- Восстановление (ввод "RESTORE" для подтверждения)

### 9.6 Dashboard — 87 строк

- Информация о пользователе
- Прогресс по зонам

### 9.7 Login — 153 строки

- Форма: username + password
- Ошибки инлайн
- Redirect → /inventory

---

## 10. Frontend Components — 25 файлов

### Inventory Components (9)

| Компонент | Строки | Назначение |
|-----------|--------|-----------|
| `audit-log-tab.tsx` | 419 | Таб блокчейн-аудита: hash chain, session/entry events |
| `inventory-header.tsx` | 97 | Шапка страницы: выбор склада, статус сессии |
| `inventory-input-card.tsx` | 292 | Карточка ввода: поиск товара + ввод количества |
| `progress-card.tsx` | 74 | Карточка прогресса по зонам |
| `queue-repair-sheet.tsx` | 162 | Sheet инспекции offline очереди |
| `recent-entries-card.tsx` | 177 | Карточка последних записей |
| `report-items-table.tsx` | 218 | Таблица позиций отчёта |
| `success-glow.tsx` | 87 | Анимация успешного сохранения |
| `sync-status-indicator.tsx` | 60 | Индикатор статуса синхронизации |

### Layout Components (4)

| Компонент | Строки | Назначение |
|-----------|--------|-----------|
| `app-shell.tsx` | 565 | Основной лейаут: sidebar, nav, user info, auth, heartbeat, online users |
| `empty-state.tsx` | 12 | Пустое состояние |
| `page-skeleton.tsx` | 10 | Скелетон загрузки |
| `page-stub.tsx` | 23 | Заглушка для нереализованных страниц |

### UI Components (11 — shadcn/ui Radix)

`alert-dialog`, `badge`, `button` (CVA variants), `dialog`, `dropdown-menu`, `input`, `ios-install-prompt`, `label`, `select`, `sheet`, `skeleton`

### Others

- `providers/query-provider.tsx` (29) — React Query wrapper
- `pwa/sw-registrar.tsx` (16) — Service Worker регистрация

---

## 11. Frontend lib/ — 22 файла

### API Layer (`lib/api/` — 12 файлов)

| Файл | Строки | Назначение |
|------|--------|-----------|
| `types.ts` | 304 | Все TypeScript типы (24+) |
| `request.ts` | 101 | `apiRequest<T>()`, `apiGetWithResponse()`, `ApiRequestError`, `toProxyUrl()` |
| `http.ts` | 86 | `getCurrentUser()`, `sendHeartbeat()`, `getOnlineUsers()`, `checkHealthReady()` |
| `inventory.ts` | 281 | Все inventory API: sessions, entries, close, reopen, export, reports, audit, progress |
| `items.ts` | 168 | Items: list, search, create, patch, import, export, bulk-upsert, categories, aliases |
| `users.ts` | 66 | Users: list, create, update, delete, reset-password |
| `admin.ts` | 40 | Admin: backups, restore, status, system-status |
| `warehouses.ts` | 30 | Warehouses, zones, stations fetch |
| `client.ts` | 92 | `API_BASE_URL`, `API_ROUTES` маппинг, `makeApiUrl()` |
| `error-mapper.ts` | 100 | Backend error codes → i18n сообщения на RU |
| `auth.ts` | 15 | `loginUser()`, `logoutUser()` |
| `auth-cookie.ts` | 2 | Cookie name constants |

### Hooks (`lib/hooks/` — 6 файлов)

| Хук | Строки | Query Key | Назначение |
|-----|--------|-----------|-----------|
| `use-current-user.ts` | 57 | `["current-user"]` | Профиль + localStorage sync + is401 |
| `use-heartbeat.ts` | 16 | — | POST heartbeat каждые 30с |
| `use-online-users.ts` | 21 | — | Polling GET /users/online 15с |
| `use-maintenance-mode.ts` | 21 | — | Polling /health/ready 30с |
| `use-success-glow.ts` | 29 | — | Анимация успеха |
| `use-app-ready.ts` | 3 | — | Stub → true |

### Остальное

| Файл | Строки | Назначение |
|------|--------|-----------|
| `format-quantity.ts` | 49 | Unit-aware форматирование (decimal precision per unit) |
| `inventory-offline-cache.ts` | 75 | Offline кэш каталога в localStorage |
| `offline-db.ts` | 34 | IndexedDB wrapper: 3 stores |
| `offline-entry-queue.ts` | 139 | Очередь offline записей + retry logic |
| `permissions.ts` | 34 | Клиентские проверки ролей |
| `items/bulk-parser.ts` | 162 | Парсер массового импорта (4 формата) |
| `utils.ts` | 5 | `cn()` — clsx + tailwind-merge |

---

## 12. API типы (Frontend `lib/api/types.ts` — 304 строки)

### Ключевые типы

```typescript
type Zone = { id: number; name: string; description: string | null }
type Warehouse = { id: number; name: string; zone_id: number; is_active: boolean; zone?: Zone }
type Station = { id: number; name: string; department: "kitchen" | "bar"; is_active: boolean; sort_order: number | null }

type CurrentUserProfile = {
  username: string; full_name: string | null;
  role: "cook" | "souschef" | "chef" | "manager" | "admin";
  role_label: string; department: "kitchen" | "bar" | null;
  warehouse_id: number | null; default_station_id: number | null;
  default_warehouse_id: number | null; preferred_language: string | null;
}

type InventorySession = {
  id: number; warehouse_id: number; revision_no: number;
  status: string; is_closed: boolean; updated_at: string | null;
}

type InventoryEntry = {
  id: number; session_id: number; item_id: number; item_name: string;
  unit: string; quantity: number; version: number; updated_at: string;
  station_id: number | null; station_name: string | null;
  counted_outside_zone: boolean; counted_by_zone_id: number | null;
  contributors_count?: number; contributors_preview?: string;
}

type InventoryCatalogItem = {
  id: number; product_code: string | null; name: string;
  unit: string; step: number; min_qty: number; max_qty: number | null;
  is_favorite: boolean; warehouse_id: number;
  aliases: string[]; updated_at: string; is_active: boolean;
}

type InventoryEntrySnapshotRow = {
  item_id: number; item_name: string; unit: string;
  quantity: number; updated_at: string;
  station_id: number | null; station_name: string | null;
}

type UserListItem = {
  id: number; username: string; full_name: string | null;
  role: string; role_label: string; is_active: boolean;
  department: string | null; warehouse_id: number | null;
  default_warehouse_id: number | null; last_seen_at: string | null;
}

type OnlineUser = {
  user_id: number; username: string; full_name: string | null;
  role: string; last_seen_at: string;
}

type AuditLogEntry = {
  id: number; actor_id: number; actor_username: string | null;
  action: string; entity_type: string; entity_id: number | null;
  warehouse_id: number | null; metadata_json: string | null;
  created_at: string; previous_hash: string; hash: string;
}

// + OfflineEntryQueueItem, ItemBulkUpsertRow/Result, InventoryRecentEvent,
//   InventorySessionEvent, InventoryItemContributor/Correction/Contributors,
//   InventoryParticipantsSummary, InventoryZoneProgress, InventorySessionProgress,
//   ItemSearchResult, ItemCatalog, BackupFile, RestoreResult, HealthReadyResponse
```

---

## 13. Backend Schemas (Pydantic v2) — 5 файлов, ~40 классов

### `schemas/inventory.py` (~300 стр., 26 классов)

`InventorySessionCreate`, `InventorySessionOut`, `InventorySessionListItemOut`, `InventorySessionEventOut`, `InventoryZoneProgressOut`, `InventorySessionProgressOut`, `InventoryCatalogItemOut`, `InventoryUserRefOut`, `InventoryEntrySnapshotOut`, `InventoryAddEntry` (mode: add|set, idempotency_key), `InventoryEntryOut`, `InventoryEntryPatch`, `ActiveSessionRequest`, `InventoryEntryEventOut`, `InventoryRecentEventOut`, `InventoryReportItemOut`, `InventorySessionReportOut`, `InventoryDiffItemOut`, `InventoryDiffTotalsOut`, `InventoryDiffReportOut`, `InventoryItemContributorOut`, `InventoryItemCorrectionOut`, `InventoryItemContributorsOut`, `InventoryParticipantSummaryItemOut`, `InventoryParticipantsSummaryOut`, `AuditLogOut`

### `schemas/item.py` (~200 стр., 10 классов)

`ItemCreate`, `ItemOut`, `ItemUnitOut`, `ItemPatch`, `ItemAliasCreate`, `ItemAliasOut`, `ItemCategoryCreate`, `ItemCategoryOut`, `ItemBulkUpsertRow`

Нормализация единиц через `UNIT_ALIASES`: кг→kg, л→l, шт→pcs, пачка→pack, бутылка→bottle

### `schemas/warehouse.py` (20 стр.)
`WarehouseCreate`, `WarehouseOut`

### `schemas/station.py` (35 стр.)
`StationCreate`, `StationPatch`, `StationOut` + `StationDepartment` enum

### `schemas/zone.py` (17 стр.)
`ZoneBase`, `ZoneCreate`, `ZoneOut`

---

## 14. Services (Backend)

### 14.1 Audit Service (`services/audit.py`, ~175 стр.)

Blockchain-style аудит:
- `log_audit(db, actor_id, action, entity_type, entity_id?, warehouse_id?, metadata?)` — записывает AuditLog с hash-цепочкой
- `verify_audit_chain(db, limit?)` → `{valid: bool, checked: int, broken_at_id?}`
- `compute_entry_hash(...)` — SHA-256 от pipe-delimited полей
- GENESIS_HASH: `"0" * 64`

### 14.2 Export Service (`services/export.py`, ~200+ стр.)

Три формата экспорта:
1. **CSV** — 15 колонок, UTF-8, единицы на русском
2. **XLSX (Entries)** — лист "Entries" (замороженные заголовки, авто-ширина) + лист "Summary" (мета, итоги по единицам и категориям)
3. **XLSX (Accounting template)** — подставляет данные в `accounting_v1.xlsx`, лист "Товары" с 8 строки

`build_export_filename()`, `ALMATY_TZ = UTC+6`

### 14.3 Export Repository (`services/export_repository.py`, ~200+ стр.)

- `fetch_session_export_rows(db, session_id)` — 10-table JOIN, для закрытых сессий → qty из `InventorySessionTotal`
- `fetch_session_catalog_export_rows(db, session_id)` — LEFT JOIN каталога + записей
- Dataclasses: `SessionExportMeta`, `SessionExportRow`, `SessionCatalogExportRow`

---

## 15. Конфигурация

### 15.1 Backend (`app/core/config.py`)

```python
class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg://..."
    jwt_secret_key: str = "changeme"
    jwt_alg: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 14
    cors_allow_origins: str = "http://localhost:3000"  # comma-separated
    idempotency_key_ttl_hours: int = 48
    expose_stacktrace: bool = False
    app_env: str = "production"    # development | staging | production
    service_version: str = ""
    build_sha: str = ""
    log_level: str = "INFO"
    backup_dir: str = "/backups"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
```

### 15.2 Frontend (env vars)

```
NEXT_PUBLIC_API_BASE_URL        # URL бэкенда (для браузерных запросов)
API_BASE_URL                    # URL бэкенда (для серверных запросов)
NEXT_PUBLIC_APP_ENV             # development | staging | production
NEXT_PUBLIC_BRAND_NAME          # Название бренда
NEXT_PUBLIC_BRAND_LOGO_SRC      # URL логотипа
NEXT_PUBLIC_BRAND_WORDMARK_SRC  # URL wordmark
```

### 15.3 Docker

**docker-compose.yml (dev):**
```yaml
services:
  db:
    image: postgres:16
    ports: 5433:5432
    environment: POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB
    volumes: postgres_data, init-db.sh
    healthcheck: pg_isready
  backend:
    build: .
    ports: 8000:8000
    depends_on: db (healthy)
    environment: DATABASE_URL, JWT_SECRET_KEY
    volumes: ./app:/app/app (hot-reload)
```

**docker-compose.prod.yml:**
```yaml
services:
  db:
    image: postgres:16
    volumes: postgres_data, backups, init-db.sh
    healthcheck: pg_isready
  backend:
    build: .
    entrypoint: /app/docker/entrypoint.sh
    # Gunicorn: 2 uvicorn workers, timeout 120s, keep-alive 5s
    environment: APP_ENV=production
    volumes: backups
  nginx:
    image: nginx:1.27-alpine
    ports: 80:80
    depends_on: backend
```

**Dockerfile:**
```dockerfile
FROM python:3.12-slim
WORKDIR /app
RUN pip install --no-cache-dir gunicorn uvicorn[standard]
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

---

## 16. Alembic Миграции (38 файлов)

HEAD: `m2n3o4p5q6r7` (make_product_code_nullable, 2026-03-11)

| # | Ревизия | Описание |
|---|---------|----------|
| 1 | `5b07aa0c1dc4` | Init schema |
| 2 | `9fb437361287` | User preferred_language |
| 3 | `a1b2c3d4e5f6` | Session updated_at |
| 4 | `a6b7c8d9e0f1` | Inventory entry events table |
| 5 | `a7b8c9d0e1f2` | Unique active session constraint |
| 6 | `a9b8c7d6e5f4` | Outside zone fields on entries/events |
| 7 | `b1c2d3e4f5a6` | Zone progress table |
| 8 | `b7c8d9e0f1a2` | Optimistic lock version |
| 9 | `b8c9d0e1f2a3` | Warehouse zone_id NOT NULL |
| 10 | `b9c0d1e2f3a4` | Item station_id |
| 11 | `c0ffee123456` | Session revision_no + deleted_at |
| 12 | `c1d2e3f4a5b6` | User full_name |
| 13 | `c3d4e5f6a7b8` | Item usage stats table |
| 14 | `c8d9e0f1a2b3` | Session closure snapshot (totals table) |
| 15 | `cb72f09089f1` | Merge heads |
| 16 | `d0e1f2a3b4c5` | User warehouse_id |
| 17 | `d2e3f4a5b6c7` | Item product_code |
| 18 | `d4e5f6a7b8c9` | Item aliases table |
| 19 | `d9e0f1a2b3c4` | Item is_favorite |
| 20 | `e0f1a2b3c4d5` | Item categories + category_id FK |
| 21 | `e1f2a3b4c5d6` | Stations table |
| 22 | `e5f6a7b8c9d0` | Item step/min_qty/max_qty |
| 23 | `e6f7a8b9c0d1` | Item updated_at |
| 24 | `e7f8a9b0c1d2` | Float → Numeric(12,3) |
| 25 | `f0a1b2c3d4e5` | Refresh tokens table |
| 26 | `f2a3b4c5d6e7` | Station FK on entries + users |
| 27 | `f3b4c5d6e7f8` | User department + default_warehouse_id |
| 28 | `f6a7b8c9d0e1` | Idempotency keys table |
| 29 | `f9c28fda7632` | UC(session_id, item_id) |
| 30 | `fdf7f9b2b1e3` | Zones table + zone_id FK |
| 31 | `g1h2i3j4k5l6` | User last_seen_at |
| 32 | `h1i2j3k4l5m6` | User soft-delete (deleted_at) |
| 33 | `i1j2k3l4m5n6` | Warehouse is_active |
| 34 | `j1k2l3m4n5o6` | Audit log table |
| 35 | `k2l3m4n5o6p7` | Audit log hash chain |
| 36 | `l1m2n3o4p5q6` | Performance indexes |
| 37 | `merge_a1b2c3_a7b8c9` | Merge heads |
| 38 | `m2n3o4p5q6r7` | Make product_code nullable (HEAD) |

---

## 17. Тестирование

### 17.1 Backend (pytest) — 24 файла, 112 тестов

| Файл | Тестов | Область |
|------|--------|---------|
| `test_auth_and_health.py` | 10 | Логин, JWT, refresh rotation, logout, rate limit, health/live/ready/metrics |
| `test_error_codes.py` | 5 | Структурированные ошибки: SESSION_CLOSED, ITEM_INACTIVE, VERSION_CONFLICT |
| `test_inventory_audit.py` | 5 | Audit events before/after/reason, idempotent replay, global filtering |
| `test_inventory_export.py` | 14 | CSV/XLSX экспорт, template, RBAC, sorting, precision, 500-row perf |
| `test_inventory_flow.py` | 4 | Полный цикл: создание → ввод → закрытие, коллаборативная работа |
| `test_inventory_idempotency.py` | 4 | Replay, конфликт payload, пустой ключ, TTL expiry |
| `test_inventory_negative.py` | 5 | Double session, invalid mode, closed rejection, cross-warehouse |
| `test_inventory_optimistic_lock.py` | 8 | If-Match PATCH, version conflict 409, fallback, backward compat |
| `test_inventory_progress.py` | 3 | Session progress, zone-complete + event, progress list |
| `test_inventory_reports.py` | 7 | Report snapshot, diff, today shortcut, tz handling |
| `test_inventory_session_close_snapshot.py` | 3 | Close → snapshot, post rejected, patch requires reason |
| `test_inventory_station_assignment.py` | 2 | Explicit station, user default fallback |
| `test_items_alias_search.py` | 3 | Search by alias, ranking: name-starts > alias-starts > contains |
| `test_items_catalog_management.py` | 3 | Admin patch, chef aliases, souschef forbidden |
| `test_items_import_export.py` | 5 | CSV dry run/apply, validation errors, export, souschef forbidden |
| `test_items_recent_frequent.py` | 4 | Recent/frequent order, invalid period, warehouse not found |
| `test_items_search.py` | 6 | Active only, ranking, unit normalization, rate limit, category filter |
| `test_item_categories.py` | 6 | Create/list, souschef forbidden, search, sorted by usage |
| `test_item_quantity_constraints.py` | 4 | Step+bounds, invalid bounds, alignment, enforcement |
| `test_item_units.py` | 2 | List units, auth required |
| `test_postgres_contract.py` | 2 | Partial unique index, blocks second active session |
| `test_stations.py` | 2 | List with filters, create requires chef |
| `test_warehouses.py` | 2 | Create assigns zone, rejects missing zone |

Fixtures (`conftest.py`, 204 стр.): client, db_session, headers для 4 ролей (admin, chef, souschef, cook), seed data.

### 17.2 Frontend (Playwright)

```typescript
// playwright.config.ts
export default defineConfig({
  testDir: './tests',
  baseURL: 'http://localhost:3000',
  timeout: 30000,
  use: { trace: 'on-first-retry' },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
});
```

---

## 18. Метрики и мониторинг

In-memory Prometheus-style метрики (`core/metrics.py`):

| Метрика | Тип | Лейблы |
|---------|-----|--------|
| `app_http_requests_total` | Counter | method, path, status |
| `app_http_errors_total` | Counter | method, path, status |
| `app_http_request_duration_ms_sum` | Sum | method, path |
| `app_http_request_duration_ms_count` | Counter | method, path |
| `idempotency_replay_total` | Counter | endpoint |
| `idempotency_conflict_total` | Counter | endpoint |
| `idempotency_cleanup_deleted_total` | Counter | endpoint |
| `app_build_info` | Gauge | service_version, build_sha |

Рендерится в Prometheus text format на `GET /metrics`.

---

## 19. Логирование

### JSON Logging (production) — `core/log_json.py`

```json
{
  "ts": "2026-03-14T12:00:00.000Z",
  "level": "INFO",
  "logger": "uvicorn.access",
  "message": "POST /inventory/sessions/1/entries 200",
  "event": "http_request",
  "request_id": "abc-123",
  "user_id": 5,
  "role": "cook",
  "path": "/inventory/sessions/1/entries",
  "method": "POST",
  "status": 200,
  "duration_ms": 45
}
```

Уровни:
- ERROR: 5xx, неперехваченные exceptions, DB ошибки
- WARNING: 4xx, медленные запросы (>300ms)
- INFO: все остальные

---

## 20. Бизнес-правила и инварианты

### 20.1 Ревизии

- Максимум 1 активная ревизия (status=draft) на склад (enforced: partial unique index)
- Номер ревизии (revision_no) — автоинкремент в рамках склада
- При закрытии → snapshot в `inventory_session_totals`
- Переоткрытие возможно (souschef+)
- Soft-delete с указанием причины

### 20.2 Записи

- Уникальность: 1 запись на (session_id, item_id)
- Два режима: `add` (+=количество), `set` (=количество)
- Optimistic locking через `version`
- Idempotency по UUID ключу (TTL 48h)
- Валидация: step alignment, min_qty, max_qty
- Patch после закрытия — требует reason (`correct_after_close`)

### 20.3 Единицы измерения

5 канонических: `kg`, `l`, `pcs`, `pack`, `bottle`

Алиасы (backend + frontend):
```
kg:     кг, килограмм, килограммы
l:      л, литр, литры
pcs:    шт, штука, штуки, pieces, piece
pack:   уп, упаковка, упаковки, пачка
bottle: бут, бутыль, бутылка, бутылки
```

### 20.4 Product Code

- Формат: `^\d{5}$` (5 цифр)
- Nullable (необязательное поле)
- Unique constraint в БД

### 20.5 Offline ввод (Fast Entry)

Полная спецификация в `docs/fast-entry-spec.md`. Ключевые инварианты:
1. Keyboard-first flow: поиск → выбор → qty → Enter → save → reset → фокус на поиск
2. При offline → запись в IndexedDB queue → UI сбрасывается как при успехе
3. Auto-sync при reconnect, retry с exponential backoff
4. 409/conflict → пометка записи, не бесконечный retry
5. Draft (search + qty) сохраняется в localStorage, восстанавливается при перезагрузке
6. Draft очищается ТОЛЬКО после успешного сохранения

---

## 21. Как запустить

### Development

```powershell
# В корне проекта:
.\start-dev.ps1
# Или вручную:

# Terminal 1 — Backend
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Terminal 2 — Frontend
cd frontend
npm install
npm run dev  # http://localhost:3000
```

### Docker

```bash
# Dev
cd backend && docker-compose up -d

# Prod
cd backend && docker-compose -f docker-compose.prod.yml up -d
# Nginx на порту 80
```

### Тесты

```bash
# Backend (112 тестов)
cd backend && pytest

# Frontend E2E
cd frontend && npx playwright test
```

---

## 22. Известные особенности и tech debt

1. **inventory.py — 2900 строк**: Самый большой роутер, содержит бизнес-логику. Кандидат на декомпозицию в service layer.
2. **inventory/page.tsx — 3520 строк**: Монолитная страница с ~50 useState. Кандидат на разбиение на кастомные хуки/подкомпоненты.
3. **Метрики in-memory**: При перезапуске теряются. Для production нужен persistent metrics backend.
4. **Rate limiter in-memory**: Не распределённый. Работает только с 1 worker (или нужен Redis).
5. **Нет WebSocket**: Все обновления через polling (15-30s).
6. **Reports stub**: `/reports` — заглушка. Вся отчётность внутри inventory page.
7. **Audit hash chain /verify**: Линейный O(N) по всей таблице. Может потребовать chunk-based verification.
8. **Frontend unit тесты**: Отсутствуют. Есть только E2E (Playwright) и backend-тесты.
9. **Docker image**: Dockerfile указывает python:3.12-slim, но runtime — Python 3.14 (dev).

---

## 23. Статистика

| Метрика | Значение |
|---------|----------|
| Backend model файлов | 18 |
| Таблиц в БД | 18 |
| Alembic миграций | 38 |
| Backend роутеров | 9 |
| API эндпоинтов | ~60+ |
| Backend тестов | 112 |
| Backend строк (роутеры) | ~4700 |
| Frontend страниц | 12 |
| Frontend компонентов | 25 |
| Frontend lib файлов | 22 |
| Frontend кастомных хуков | 6 |
| i18n языков / ключей | 2 / ~398 |
| Python зависимостей | 36 |
| NPM зависимостей | 16 + 10 dev |
| Крупнейший файл (frontend) | inventory/page.tsx (3520 строк) |
| Крупнейший роутер (backend) | inventory.py (2900 строк) |

---

## 24. Глоссарий

| Термин | Описание |
|--------|----------|
| Ревизия (Revision) | Сессия инвентаризации (count session) |
| Запись (Entry) | Одна позиция в ревизии (item + quantity) |
| Каталог (Catalog) | Справочник товаров |
| Зона (Zone) | Логическая группировка складов (кухня, бар) |
| Склад (Warehouse) | Физическое место хранения |
| Станция (Station) | Рабочее место (гриль, кондитер, бар) |
| Позиция (Item) | Товар в каталоге |
| Алиас (Alias) | Синоним названия товара для поиска |
| Draft | Черновик незавершённого ввода в localStorage |
| Snapshot | Фиксация данных при закрытии ревизии |
| Hash Chain | Blockchain-style цепочка аудит-логов |
| Idempotency Key | UUID для предотвращения дублей при повторных запросах |
| React Query | TanStack Query — серверное состояние |
| Optimistic Lock | Версионирование записей для предотвращения конфликтов |
