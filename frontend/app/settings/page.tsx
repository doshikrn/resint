"use client";

import { useCallback, useEffect, useState } from "react";
import { Settings, Eye, EyeOff } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ApiRequestError,
  getCurrentUser,
  getWarehouses,
  updateMyProfile,
  changeMyPassword,
  type CurrentUserProfile,
  type Warehouse,
} from "@/lib/api/http";
import { CURRENT_USER_QUERY_KEY, CURRENT_USER_CACHE_KEY } from "@/lib/hooks/use-current-user";
import { useLanguage } from "@/lib/i18n/language-provider";
import { LANGUAGES } from "@/lib/i18n";
import type { Language } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export default function SettingsPage() {
  const { t, language, setLanguage } = useLanguage();
  const queryClient = useQueryClient();

  const [user, setUser] = useState<CurrentUserProfile | null>(null);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Profile ──
  const [fullName, setFullName] = useState("");
  const [savingName, setSavingName] = useState(false);

  // ── Password ──
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);

  // ── Language ──
  const [savingLanguage, setSavingLanguage] = useState(false);

  // ── Toast ──
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastError, setToastError] = useState(false);

  useEffect(() => {
    if (!toastMessage) return;
    const id = setTimeout(() => {
      setToastMessage(null);
      setToastError(false);
    }, 3000);
    return () => clearTimeout(id);
  }, [toastMessage]);

  const showToast = useCallback((msg: string, isError = false) => {
    setToastMessage(msg);
    setToastError(isError);
  }, []);

  // ── Load data ──
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [u, wh] = await Promise.all([getCurrentUser(), getWarehouses()]);
        if (!active) return;
        setUser(u);
        setWarehouses(wh);
        setFullName(u.full_name ?? "");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  // ── Handlers ──
  async function handleSaveName() {
    if (!user) return;
    const trimmed = fullName.trim();
    if (trimmed === (user.full_name ?? "")) return;
    setSavingName(true);
    try {
      const updated = await updateMyProfile({ full_name: trimmed || undefined });
      setUser(updated);
      setFullName(updated.full_name ?? "");
      if (typeof window !== "undefined") {
        window.localStorage.setItem(CURRENT_USER_CACHE_KEY, JSON.stringify(updated));
      }
      void queryClient.invalidateQueries({ queryKey: CURRENT_USER_QUERY_KEY });
      showToast(t("settings.name_updated"));
    } catch {
      showToast(t("settings.error_update_name"), true);
    } finally {
      setSavingName(false);
    }
  }

  async function handleChangePassword() {
    if (newPassword.length < 8) {
      showToast(t("settings.error_password_too_short"), true);
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast(t("settings.error_passwords_mismatch"), true);
      return;
    }
    setSavingPassword(true);
    try {
      await changeMyPassword({ current_password: currentPassword, new_password: newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      showToast(t("settings.password_changed"));
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 400) {
        showToast(t("settings.error_wrong_current"), true);
      } else {
        showToast(t("settings.error_change_password"), true);
      }
    } finally {
      setSavingPassword(false);
    }
  }

  async function handleChangeLanguage(lang: Language) {
    if (lang === language) return;
    setSavingLanguage(true);
    try {
      const updated = await updateMyProfile({ preferred_language: lang });
      setLanguage(lang);
      if (typeof window !== "undefined" && updated) {
        window.localStorage.setItem(CURRENT_USER_CACHE_KEY, JSON.stringify(updated));
      }
      void queryClient.invalidateQueries({ queryKey: CURRENT_USER_QUERY_KEY });
      showToast(t("settings.language_saved"));
    } catch {
      showToast(t("settings.error_save_language"), true);
    } finally {
      setSavingLanguage(false);
    }
  }

  const warehouseName =
    user?.warehouse_id != null
      ? warehouses.find((w) => w.id === user.warehouse_id)?.name ?? `#${user.warehouse_id}`
      : "\u2014";

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t("settings.title")}</h1>
        <div className="h-64 animate-pulse rounded-2xl border border-border/60 bg-card/95" />
      </div>
    );
  }

  if (!user) return null;

  const nameChanged = fullName.trim() !== (user.full_name ?? "");
  const passwordFormValid =
    currentPassword.length > 0 && newPassword.length >= 8 && confirmPassword.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Settings className="h-6 w-6 text-muted-foreground" />
        <h1 className="text-2xl font-semibold tracking-tight">{t("settings.title")}</h1>
      </div>

      {/* ── Profile card ── */}
      <section className="space-y-4 rounded-2xl border border-border/60 bg-card/95 p-6 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold">{t("settings.profile")}</h2>
          <p className="text-sm text-muted-foreground">{t("settings.profile_desc")}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{t("settings.field_name")}</Label>
            <Input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              maxLength={100}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-muted-foreground">{t("settings.field_login")}</Label>
            <Input value={user.username} readOnly className="bg-muted/50" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-muted-foreground">{t("settings.field_role")}</Label>
            <Input value={user.role_label} readOnly className="bg-muted/50" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-muted-foreground">{t("settings.field_warehouse")}</Label>
            <Input value={warehouseName} readOnly className="bg-muted/50" />
          </div>
        </div>
        <div className="flex justify-end">
          <Button
            onClick={handleSaveName}
            disabled={!nameChanged || savingName}
            size="sm"
          >
            {savingName ? t("common.saving") : t("common.save")}
          </Button>
        </div>
      </section>

      {/* ── Password card ── */}
      <section className="space-y-4 rounded-2xl border border-border/60 bg-card/95 p-6 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold">{t("settings.password")}</h2>
          <p className="text-sm text-muted-foreground">{t("settings.password_desc")}</p>
        </div>
        <div className="grid gap-4 sm:max-w-sm">
          <div className="space-y-1.5">
            <Label>{t("settings.current_password")}</Label>
            <div className="relative">
              <Input
                type={showCurrentPassword ? "text" : "password"}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowCurrentPassword((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showCurrentPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{t("settings.new_password")}</Label>
            <div className="relative">
              <Input
                type={showNewPassword ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowNewPassword((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{t("settings.confirm_password")}</Label>
            <Input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button
            onClick={handleChangePassword}
            disabled={!passwordFormValid || savingPassword}
            size="sm"
          >
            {savingPassword ? t("common.saving") : t("settings.change_password")}
          </Button>
        </div>
      </section>

      {/* ── Language card ── */}
      <section className="space-y-4 rounded-2xl border border-border/60 bg-card/95 p-6 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold">{t("settings.language")}</h2>
          <p className="text-sm text-muted-foreground">{t("settings.language_desc")}</p>
        </div>
        <div className="flex gap-2">
          {LANGUAGES.map((lang) => (
            <button
              key={lang}
              type="button"
              disabled={savingLanguage}
              onClick={() => handleChangeLanguage(lang)}
              className={cn(
                "rounded-lg border px-4 py-2 text-sm font-medium transition-all",
                language === lang
                  ? "border-primary/40 bg-primary text-primary-foreground shadow-sm"
                  : "border-border/60 bg-background text-muted-foreground hover:border-border hover:bg-muted/60 hover:text-foreground",
              )}
            >
              {lang === "ru" ? t("settings.language_ru") : t("settings.language_kk")}
            </button>
          ))}
        </div>
      </section>

      {/* ── Toast ── */}
      {toastMessage && (
        <div
          className={cn(
            "fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] inset-x-4 sm:inset-x-auto sm:right-6 sm:left-auto max-w-sm mx-auto sm:mx-0 z-50 rounded-xl px-4 py-2.5 text-sm shadow-lg",
            toastError
              ? "bg-destructive text-destructive-foreground"
              : "bg-foreground text-background",
          )}
        >
          {toastMessage}
        </div>
      )}
    </div>
  );
}
