"use client";

import { Boxes, ClipboardList, Database, Menu, Package, Settings, Users } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useHeartbeat } from "@/lib/hooks/use-heartbeat";
import { useOnlineUsers } from "@/lib/hooks/use-online-users";
import { useMaintenanceMode } from "@/lib/hooks/use-maintenance-mode";
import { useCurrentUser, CURRENT_USER_CACHE_KEY } from "@/lib/hooks/use-current-user";
import { cn } from "@/lib/utils";
import { IosInstallPrompt } from "@/components/ui/ios-install-prompt";
import { canManageCatalog, canManageUsers, canManageBackups } from "@/lib/permissions";
import { useLanguage } from "@/lib/i18n/language-provider";
import { LANGUAGES, LANGUAGE_LABELS } from "@/lib/i18n";
import type { DictionaryKeys } from "@/lib/i18n";

type AppShellProps = {
  children: React.ReactNode;
};

// CURRENT_USER_CACHE_KEY is imported from use-current-user hook

const APP_ENV = process.env.NEXT_PUBLIC_APP_ENV ?? "production";
const ENV_BADGE_LABEL: Record<string, string> = { development: "DEV", staging: "STAGING" };
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";

const BRAND_NAME = process.env.NEXT_PUBLIC_BRAND_NAME ?? "Resident Restaurant";
const BRAND_LOGO_SRC = process.env.NEXT_PUBLIC_BRAND_LOGO_SRC ?? "/brand/logo-gold-mark.svg";
const BRAND_WORDMARK_SRC =
  process.env.NEXT_PUBLIC_BRAND_WORDMARK_SRC ?? "/brand/logo-gold-wordmark.svg";

const ROLE_LABEL_FALLBACK: Record<string, string> = {
  cook: "Повар",
  souschef: "Су-шеф",
  chef: "Шеф-повар",
  manager: "Управляющий",
  admin: "Шеф-повар",
};

const DISPLAY_NAME_FALLBACK: Record<string, string> = {
  ayan: "Аян",
  venera: "Венера",
  mahmud: "Махмуд",
  artur: "Артур",
  damir: "Дамир",
  zhansaya: "Жансая",
  aynura: "Айнура",
  nurken: "Нуркен",
  nurbek: "Нурбек",
  david: "Давид",
  yusuf: "Юсуф",
  vanya: "Ваня",
  ramil: "Рамиль",
};

type NavItem = {
  href: string;
  labelKey: DictionaryKeys;
  icon: React.ComponentType<{ className?: string }>;
  groupKey: DictionaryKeys;
  canView: (role: string) => boolean;
};

const navItems: NavItem[] = [
  {
    href: "/inventory",
    labelKey: "nav.revision",
    icon: ClipboardList,
    groupKey: "nav.group.inventory",
    canView: () => true,
  },
  {
    href: "/items",
    labelKey: "nav.items",
    icon: Boxes,
    groupKey: "nav.group.control",
    canView: canManageCatalog,
  },
  {
    href: "/users",
    labelKey: "nav.users",
    icon: Users,
    groupKey: "nav.group.system",
    canView: canManageUsers,
  },
  {
    href: "/backups",
    labelKey: "nav.backups",
    icon: Database,
    groupKey: "nav.group.system",
    canView: canManageBackups,
  },
  {
    href: "/settings",
    labelKey: "nav.settings",
    icon: Settings,
    groupKey: "nav.group.system",
    canView: () => true,
  },
];

const navGroupOrder: DictionaryKeys[] = [
  "nav.group.overview",
  "nav.group.inventory",
  "nav.group.control",
  "nav.group.system",
];

function NavList({
  mobile = false,
  items,
  onNavigate,
}: {
  mobile?: boolean;
  items: NavItem[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const { t } = useLanguage();

  if (mobile) {
    return (
      <nav className="mt-4 grid gap-1">
        {items.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => onNavigate?.()}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-all",
                active
                  ? "border-primary/40 bg-primary text-primary-foreground shadow-sm"
                  : "border-transparent text-muted-foreground hover:border-border/70 hover:bg-muted/70 hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              <span>{t(item.labelKey)}</span>
            </Link>
          );
        })}
      </nav>
    );
  }

  const grouped = navGroupOrder
    .map((groupKey) => ({
      groupKey,
      items: items.filter((item) => item.groupKey === groupKey),
    }))
    .filter((entry) => entry.items.length > 0);

  return (
    <nav className="grid gap-4">
      {grouped.map((entry) => (
        <div key={entry.groupKey} className="grid gap-1">
          <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/75">
            {t(entry.groupKey)}
          </p>
          {entry.items.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => onNavigate?.()}
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px] font-medium transition-all",
                  active
                    ? "border-primary/40 bg-primary text-primary-foreground shadow-sm"
                    : "border-transparent text-muted-foreground hover:border-border/70 hover:bg-muted/70 hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                <span>{t(item.labelKey)}</span>
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function BrandIdentity() {
  const [logoLoadFailed, setLogoLoadFailed] = useState(false);
  const [wordmarkLoadFailed, setWordmarkLoadFailed] = useState(false);

  return (
    <div className="flex w-full items-center gap-2">
      {logoLoadFailed ? (
        <Package className="h-10 w-10 shrink-0" />
      ) : (
        <img
          src={BRAND_LOGO_SRC}
          alt={BRAND_NAME}
          className="h-12 w-12 shrink-0 object-contain"
          onError={() => setLogoLoadFailed(true)}
        />
      )}

      {wordmarkLoadFailed ? null : (
        <img
          src={BRAND_WORDMARK_SRC}
          alt={`${BRAND_NAME} wordmark`}
          className="ml-1 h-8 w-auto max-w-[172px] object-contain"
          onError={() => setWordmarkLoadFailed(true)}
        />
      )}
    </div>
  );
}

function HeaderWordmark() {
  return (
    <div className="flex select-none items-center gap-6 leading-none">
      <div className="flex flex-col items-center">
        <p className="-mr-[0.26em] text-[42px] font-light uppercase tracking-[0.26em] text-foreground md:text-[52px]">
          ZERE
        </p>
        <p className="-mt-1 text-[18px] font-normal tracking-wide text-foreground/90 md:text-[20px]">
          restaurant
        </p>
      </div>
      <div className="h-10 w-px bg-border/60" />
      <div className="flex flex-col items-start">
        <p className="text-[13px] font-semibold uppercase tracking-[0.18em] text-foreground/70">
          Resint
        </p>
        <p className="-mt-0.5 text-[10px] font-normal tracking-wide text-muted-foreground">
          restaurant system
        </p>
      </div>
    </div>
  );
}

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { t, language, setLanguage } = useLanguage();
  const isLoginPage = pathname === "/login";
  const { user: currentUser, isLoading: userIsLoading, is401 } = useCurrentUser();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [forceAuthMode, setForceAuthMode] = useState(false);
  const [authTimedOut, setAuthTimedOut] = useState(false);

  // Safety timeout: if auth check hasn't completed in 10s, treat as unauthenticated
  // to prevent infinite "Проверяем аккаунт..." on mobile with flaky networks.
  useEffect(() => {
    if (!userIsLoading) {
      setAuthTimedOut(false);
      return;
    }
    const id = setTimeout(() => setAuthTimedOut(true), 10_000);
    return () => clearTimeout(id);
  }, [userIsLoading]);

  const profileLoaded = !userIsLoading || authTimedOut;
  const pollingEnabled = profileLoaded && !!currentUser && !isLoginPage;
  useHeartbeat(pollingEnabled);
  const onlineUsers = useOnlineUsers(pollingEnabled);
  const maintenanceMode = useMaintenanceMode(pollingEnabled);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  // Handle 401 — clear localStorage and redirect
  useEffect(() => {
    if (isLoginPage || isLoggingOut) return;
    if (is401) {
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(CURRENT_USER_CACHE_KEY);
      }
    }
  }, [is401, isLoginPage, isLoggingOut]);

  useEffect(() => {
    if (isLoginPage) {
      return;
    }
    if (!profileLoaded || currentUser) {
      return;
    }
    router.replace("/login");
  }, [currentUser, isLoginPage, profileLoaded, router]);

  const visibleNavItems = useMemo(() => {
    const role = currentUser?.role;
    if (!role) {
      return navItems.filter((item) => ["/inventory"].includes(item.href));
    }
    return navItems.filter((item) => item.canView(role));
  }, [currentUser?.role]);

  const currentUserRoleLabel =
    currentUser?.role_label ||
    (currentUser?.role ? ROLE_LABEL_FALLBACK[currentUser.role] ?? currentUser.role : null);
  const currentUserDisplayName =
    currentUser?.full_name?.trim() ||
    (currentUser?.username ? DISPLAY_NAME_FALLBACK[currentUser.username.toLowerCase()] : null) ||
    currentUser?.username ||
    t("common.user");
  const currentUserInitials = useMemo(() => {
    const parts = currentUserDisplayName.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) {
      return "U";
    }
    if (parts.length === 1) {
      return parts[0].slice(0, 1).toUpperCase();
    }
    return `${parts[0].slice(0, 1)}${parts[1].slice(0, 1)}`.toUpperCase();
  }, [currentUserDisplayName]);

  async function onLogout() {
    if (isLoggingOut) {
      return;
    }

    setIsLoggingOut(true);
    setForceAuthMode(true);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(CURRENT_USER_CACHE_KEY);
    }

    // Wait for cookie clearing before navigating — otherwise the middleware
    // sees stale httpOnly cookies and redirects back to a protected route,
    // causing a 1-2s broken partial render before the real redirect.
    try {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 1500);
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        signal: controller.signal,
      });
      window.clearTimeout(timeoutId);
    } catch {
      // Timeout or network error — navigate anyway
    }

    window.location.replace("/login");
  }

  if (isLoginPage || forceAuthMode || (profileLoaded && !currentUser)) {
    return (
      <div className="min-h-[100dvh] bg-muted/35 p-4 md:p-8">
        <div
          className="pointer-events-none fixed inset-0 bg-[radial-gradient(1200px_500px_at_50%_-50%,hsl(var(--primary)/0.12),transparent)]"
          aria-hidden="true"
        />
        <div className="relative">{isLoggingOut ? null : children}</div>
      </div>
    );
  }

  if (!profileLoaded) {
    return (
      <div className="min-h-[100dvh] bg-muted/35 p-4 md:p-8">
        <div
          className="pointer-events-none fixed inset-0 bg-[radial-gradient(1200px_500px_at_50%_-50%,hsl(var(--primary)/0.12),transparent)]"
          aria-hidden="true"
        />
        <div className="relative mx-auto mt-20 max-w-md rounded-2xl border border-border/70 bg-card/95 p-6 text-center text-sm text-muted-foreground shadow-sm">
          {t("common.checking_account")}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] overflow-x-hidden bg-muted/35 md:h-[100dvh] md:overflow-hidden">
      <div
        className="pointer-events-none fixed inset-0 bg-[radial-gradient(1200px_520px_at_50%_-50%,hsl(var(--primary)/0.1),transparent)]"
        aria-hidden="true"
      />
      <div className="flex w-full min-w-0 md:h-full">
        <aside className="hidden h-[100dvh] w-64 shrink-0 border-r border-border/70 bg-card/90 backdrop-blur md:sticky md:top-0 md:flex md:flex-col">
          <div className="flex h-20 items-center gap-2 border-b border-border/70 px-6">
            <BrandIdentity />
          </div>
          <div className="flex flex-1 flex-col">
            <div className="border-b border-border/40 px-6 py-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-foreground/50">
                RESINT
              </p>
              <p className="-mt-0.5 text-[10px] font-normal tracking-wide text-muted-foreground/70">
                restaurant system
              </p>
            </div>
            <div className="px-4 py-4">
              <NavList items={visibleNavItems} />
            </div>
            <div className="mt-auto border-t border-border/40 px-6 py-3">
              <div className="flex items-center gap-2">
                <p className="text-[10px] font-medium tracking-wide text-muted-foreground/50">
                  Resint v{APP_VERSION}
                </p>
                {ENV_BADGE_LABEL[APP_ENV] && (
                  <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                    {ENV_BADGE_LABEL[APP_ENV]}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-[9px] tracking-wide text-muted-foreground/40">
                {t("app.copyright").replace("{year}", String(new Date().getFullYear()))}
              </p>
            </div>
          </div>
        </aside>

        <div className="min-w-0 w-full flex-1 md:flex md:flex-col md:min-h-0">
          <header className="shrink-0 sticky top-0 z-30 border-b border-border/70 bg-background/85 backdrop-blur-xl">
            <div className="relative flex h-16 items-center px-4 md:h-24 md:px-6">
              <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
                <SheetTrigger asChild>
                  <Button variant="outline" size="icon" className="relative z-10 md:hidden">
                    <Menu className="h-4 w-4" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="flex w-72 flex-col p-0">
                  <div className="flex h-20 items-center gap-2 border-b px-5">
                    <BrandIdentity />
                  </div>
                  <div className="border-b border-border/40 px-5 py-2.5">
                    <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-foreground/50">
                      RESINT
                    </p>
                    <p className="-mt-0.5 text-[10px] font-normal tracking-wide text-muted-foreground/70">
                      restaurant system
                    </p>
                  </div>
                  <div className="flex-1 px-4">
                    <NavList
                      mobile
                      items={visibleNavItems}
                      onNavigate={() => setMobileNavOpen(false)}
                    />
                  </div>
                  <div className="border-t border-border/40 px-5 py-2.5">
                    <div className="flex items-center gap-2">
                      <p className="text-[10px] font-medium tracking-wide text-muted-foreground/50">
                        Resint v{APP_VERSION}
                      </p>
                      {ENV_BADGE_LABEL[APP_ENV] && (
                        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                          {ENV_BADGE_LABEL[APP_ENV]}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[9px] tracking-wide text-muted-foreground/40">
                      {t("app.copyright").replace("{year}", String(new Date().getFullYear()))}
                    </p>
                  </div>
                </SheetContent>
              </Sheet>

              <div className="pointer-events-none absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 md:block">
                <HeaderWordmark />
              </div>

              <div className="relative z-10 ml-auto flex min-w-0 items-center gap-2 sm:gap-3">
                <div className="flex shrink-0 items-center rounded-lg border border-border/70 bg-background/85 p-0.5 shadow-sm">
                  {LANGUAGES.map((lang) => (
                    <button
                      key={lang}
                      type="button"
                      onClick={() => setLanguage(lang)}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-xs font-semibold transition-all duration-150",
                        language === lang
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {LANGUAGE_LABELS[lang]}
                    </button>
                  ))}
                </div>
                {onlineUsers.length > 0 ? (
                  <div className="group relative">
                    <div className="flex items-center gap-1.5 rounded-lg border border-border/70 bg-background/85 px-2.5 py-1.5 text-xs font-medium text-muted-foreground shadow-sm">
                      <Users className="h-3.5 w-3.5" />
                      <span>{onlineUsers.length}</span>
                      <span className="hidden sm:inline">{t("common.online_count")}</span>
                    </div>
                    <div className="pointer-events-none absolute right-0 top-full z-50 pt-1.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
                      <div className="w-56 rounded-xl border border-border/70 bg-card p-3 shadow-lg">
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          {t("common.online_title")}
                        </p>
                        <div className="space-y-1.5">
                          {onlineUsers.map((u) => (
                            <div key={u.id} className="flex items-center justify-between gap-2">
                              <p className="truncate text-sm font-medium">
                                {u.full_name || u.username}
                              </p>
                              <p className="shrink-0 text-xs text-muted-foreground">
                                {u.role_label}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="flex min-w-0 items-center gap-2.5 rounded-xl border border-border/70 bg-background/85 px-3 py-1.5 shadow-sm transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <div className="hidden text-right sm:block">
                        <p className="max-w-[160px] truncate text-sm font-medium leading-tight">
                          {currentUserDisplayName}
                        </p>
                        {currentUserRoleLabel ? (
                          <p className="max-w-[160px] truncate text-xs leading-tight text-muted-foreground">
                            {currentUserRoleLabel}
                          </p>
                        ) : null}
                      </div>
                      <p className="min-w-0 max-w-[80px] truncate text-sm font-medium sm:hidden sm:max-w-[120px]">
                        {currentUserDisplayName}
                      </p>
                      <div className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/12 text-xs font-semibold text-primary ring-1 ring-primary/20">
                        {currentUserInitials}
                      </div>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44 p-1">
                    <DropdownMenuItem
                      className="rounded-md"
                      onSelect={() => {
                        router.push("/settings");
                      }}
                    >
                      {t("nav.settings")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="rounded-md"
                      disabled={isLoggingOut}
                      onSelect={() => {
                        void onLogout();
                      }}
                    >
                      {isLoggingOut ? t("common.logging_out") : t("common.logout")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </header>

          {maintenanceMode && (
            <div className="shrink-0 border-b border-amber-300/50 bg-amber-50 px-4 py-2.5 text-center text-sm font-medium text-amber-800 dark:border-amber-700/50 dark:bg-amber-950/40 dark:text-amber-200">
              {t("maintenance.banner")}
            </div>
          )}

          <main className="relative mx-auto w-full max-w-7xl overflow-x-hidden px-3 pt-4 sm:px-4 sm:pt-6 md:flex md:flex-1 md:flex-col md:min-h-0 md:overflow-y-auto md:px-6 md:pb-8 pb-[calc(6rem+env(safe-area-inset-bottom))]">
            {children}
          </main>
        </div>
      </div>

      <nav
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden",
          pathname === "/inventory" && "hidden",
        )}
      >
        <div
          className="grid"
          style={{
            gridTemplateColumns: `repeat(${Math.max(visibleNavItems.length, 1)}, minmax(0, 1fr))`,
          }}
        >
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 px-2 py-2.5 text-[11px] min-h-[44px]",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                <span>{t(item.labelKey)}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      <IosInstallPrompt />
    </div>
  );
}
