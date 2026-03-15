"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, KeyRound, ShieldBan, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  adminCreateUser,
  adminDeleteUser,
  adminPatchUser,
  adminResetPassword,
  getWarehouses,
  listUsers,
  type UserListItem,
  type Warehouse,
} from "@/lib/api/http";
import { useLanguage } from "@/lib/i18n/language-provider";
import { useCurrentUser, CURRENT_USER_QUERY_KEY } from "@/lib/hooks/use-current-user";
import type { DictionaryKeys } from "@/lib/i18n";
import { canManageUsers } from "@/lib/permissions";

const ROLES = ["cook", "souschef", "chef", "manager"] as const;

const ROLE_LABEL_KEYS: Record<string, string> = {
  cook: "users.role_cook",
  souschef: "users.role_souschef",
  chef: "users.role_chef",
  manager: "users.role_manager",
  admin: "users.role_chef",
};

function formatLastSeen(iso: string | null, locale: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return locale === "kk" ? "Қазір" : "Только что";
  if (diffMin < 60) return `${diffMin} ${locale === "kk" ? "мин" : "мин"} назад`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH} ${locale === "kk" ? "сағ" : "ч"} назад`;
  return d.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function warehouseName(wId: number | null, warehouses: Warehouse[], t: (k: DictionaryKeys) => string) {
  if (wId == null) return t("users.no_warehouse");
  const w = warehouses.find((wh) => wh.id === wId);
  if (!w) return `#${wId}`;
  const n = w.name.toLowerCase();
  if (n.includes("kitchen") || n.includes("main")) return "Кухня";
  if (n.includes("bar")) return "Бар";
  return w.name;
}

// ─────────────────────────────────────────────────────

export default function UsersPage() {
  const { t, language } = useLanguage();

  // ── auth gate ──
  const { user: currentUser } = useCurrentUser();
  const hasAccess = currentUser ? canManageUsers(currentUser.role) : false;

  useEffect(() => {
    document.title = `RESINT — ${t("users.title")}`;
  }, [t]);

  // ── filters ──
  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState<string>("__all__");
  const [filterWarehouse, setFilterWarehouse] = useState<string>("__all__");

  // ── data ──
  const warehousesQuery = useQuery({
    queryKey: ["warehouses"],
    queryFn: () => getWarehouses(),
    staleTime: 120_000,
    enabled: hasAccess,
  });
  const warehouses: Warehouse[] = warehousesQuery.data ?? [];

  const usersQuery = useQuery({
    queryKey: ["admin-users", search, filterRole, filterWarehouse],
    queryFn: () =>
      listUsers({
        search: search || undefined,
        role: filterRole !== "__all__" ? filterRole : undefined,
        warehouse_id: filterWarehouse !== "__all__" ? Number(filterWarehouse) : undefined,
      }),
    staleTime: 15_000,
    enabled: hasAccess,
  });
  const users: UserListItem[] = usersQuery.data ?? [];

  // ── dialogs ──
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<UserListItem | null>(null);
  const [passwordUser, setPasswordUser] = useState<UserListItem | null>(null);
  const [deleteUser, setDeleteUser] = useState<UserListItem | null>(null);

  // ── toast ──
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  useEffect(() => {
    if (!toastMessage) return;
    const id = setTimeout(() => setToastMessage(null), 2500);
    return () => clearTimeout(id);
  }, [toastMessage]);

  // ── guard ──
  if (!currentUser) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="text-muted-foreground">{t("common.loading")}</p>
      </div>
    );
  }
  if (!hasAccess) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="text-muted-foreground">403 — нет доступа</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold">{t("users.title")}</h1>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" />
          {t("users.add")}
        </Button>
      </div>

      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="h-9 w-60"
          placeholder={t("users.search_placeholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select value={filterRole} onValueChange={setFilterRole}>
          <SelectTrigger className="h-9 w-40">
            <SelectValue placeholder={t("users.filter_role")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">{t("users.filter_all")}</SelectItem>
            {ROLES.map((r) => (
              <SelectItem key={r} value={r}>
                {t(ROLE_LABEL_KEYS[r] as never)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterWarehouse} onValueChange={setFilterWarehouse}>
          <SelectTrigger className="h-9 w-40">
            <SelectValue placeholder={t("users.filter_warehouse")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">{t("users.filter_all")}</SelectItem>
            {warehouses.map((w) => (
              <SelectItem key={w.id} value={String(w.id)}>
                {warehouseName(w.id, warehouses, t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* ── User list ── */}
      {usersQuery.isLoading ? (
        <p className="py-8 text-center text-muted-foreground">{t("users.loading")}</p>
      ) : usersQuery.isError ? (
        <p className="py-8 text-center text-destructive">{t("users.error_load")}</p>
      ) : users.length === 0 ? (
        <p className="py-8 text-center text-muted-foreground">{t("users.no_users")}</p>
      ) : (
        <>
          {/* ── Mobile cards ── */}
          <div className="space-y-3 md:hidden">
            {users.map((u) => (
              <div key={u.id} className="rounded-lg border bg-card p-4 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{u.full_name || "—"}</p>
                    <p className="text-sm text-muted-foreground">{u.username}</p>
                  </div>
                  {u.is_active ? (
                    <Badge variant="outline" className="shrink-0 text-emerald-600 border-emerald-300">
                      {t("users.status_active")}
                    </Badge>
                  ) : (
                    <Badge variant="destructive" className="shrink-0">{t("users.status_blocked")}</Badge>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  <span>{t(ROLE_LABEL_KEYS[u.role] as never) ?? u.role_label}</span>
                  <span>{warehouseName(u.warehouse_id, warehouses, t)}</span>
                </div>
                <div className="mt-3 flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8"
                    onClick={() => setEditUser(u)}
                  >
                    <Pencil className="mr-1.5 h-3.5 w-3.5" />
                    {t("common.edit")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8"
                    onClick={() => setPasswordUser(u)}
                  >
                    <KeyRound className="mr-1.5 h-3.5 w-3.5" />
                  </Button>
                  {currentUser && u.username !== currentUser.username && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-destructive border-destructive/30 hover:bg-destructive/10"
                      onClick={() => setDeleteUser(u)}
                    >
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                      {t("users.delete")}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* ── Desktop table ── */}
          <div className="hidden md:block overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-xs font-medium text-muted-foreground">
                  <th className="px-3 py-2">{t("users.col_name")}</th>
                  <th className="px-3 py-2">{t("users.col_login")}</th>
                  <th className="px-3 py-2">{t("users.col_role")}</th>
                  <th className="px-3 py-2">{t("users.col_warehouse")}</th>
                  <th className="px-3 py-2">{t("users.col_status")}</th>
                  <th className="px-3 py-2">{t("users.col_last_seen")}</th>
                  <th className="px-3 py-2 text-right">{t("users.col_actions")}</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b last:border-0 odd:bg-muted/30">
                    <td className="px-3 py-2 font-medium">{u.full_name || "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{u.username}</td>
                    <td className="px-3 py-2">{t(ROLE_LABEL_KEYS[u.role] as never) ?? u.role_label}</td>
                    <td className="px-3 py-2">{warehouseName(u.warehouse_id, warehouses, t)}</td>
                    <td className="px-3 py-2">
                      {u.is_active ? (
                        <Badge variant="outline" className="text-emerald-600 border-emerald-300">
                          {t("users.status_active")}
                        </Badge>
                      ) : (
                        <Badge variant="destructive">{t("users.status_blocked")}</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {formatLastSeen(u.last_seen_at, language)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title={t("common.edit")}
                          onClick={() => setEditUser(u)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title={t("users.change_password")}
                          onClick={() => setPasswordUser(u)}
                        >
                          <KeyRound className="h-3.5 w-3.5" />
                        </Button>
                        <ToggleActiveButton
                          user={u}
                          currentUserId={currentUser?.username}
                        />
                        {currentUser && u.username !== currentUser.username && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive"
                            title={t("users.delete")}
                            onClick={() => setDeleteUser(u)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── Dialogs ── */}
      <CreateUserDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        warehouses={warehouses}
        onCreated={() => setToastMessage(t("users.created"))}
      />
      {editUser && (
        <EditUserDialog
          open={!!editUser}
          onOpenChange={(open) => !open && setEditUser(null)}
          user={editUser}
          warehouses={warehouses}
          onSaved={() => setToastMessage(t("users.saved"))}
          currentUserId={currentUser?.username}
        />
      )}
      {passwordUser && (
        <PasswordDialog
          open={!!passwordUser}
          onOpenChange={(open) => !open && setPasswordUser(null)}
          user={passwordUser}
          onChanged={() => setToastMessage(t("users.password_changed"))}
        />
      )}
      <DeleteUserDialog
        open={!!deleteUser}
        onOpenChange={(open) => !open && setDeleteUser(null)}
        user={deleteUser}
        onDeleted={() => setToastMessage(t("users.deleted"))}
      />

      {/* ── Toast ── */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 rounded-md bg-foreground px-4 py-2 text-sm text-background shadow-lg">
          {toastMessage}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Toggle active/blocked inline button
// ─────────────────────────────────────────────────────

function ToggleActiveButton({
  user,
  currentUserId,
}: {
  user: UserListItem;
  currentUserId?: string;
}) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => adminPatchUser(user.id, { is_active: !user.is_active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      void queryClient.invalidateQueries({ queryKey: CURRENT_USER_QUERY_KEY });
    },
  });

  const isSelf = user.username === currentUserId;

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7"
      disabled={mutation.isPending || isSelf}
      title={user.is_active ? t("users.block") : t("users.unblock")}
      onClick={() => mutation.mutate()}
    >
      {user.is_active ? (
        <ShieldBan className="h-3.5 w-3.5 text-destructive" />
      ) : (
        <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
      )}
    </Button>
  );
}

// ─────────────────────────────────────────────────────
// Create user dialog
// ─────────────────────────────────────────────────────

function CreateUserDialog({
  open,
  onOpenChange,
  warehouses,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  warehouses: Warehouse[];
  onCreated: () => void;
}) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<string>("cook");
  const [warehouseId, setWarehouseId] = useState<string>("__none__");
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      adminCreateUser({
        username: username.trim(),
        password,
        full_name: fullName.trim() || undefined,
        role,
        warehouse_id: warehouseId !== "__none__" ? Number(warehouseId) : null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      onOpenChange(false);
      resetForm();
      onCreated();
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : t("users.error_create"));
    },
  });

  function resetForm() {
    setUsername("");
    setPassword("");
    setPasswordConfirm("");
    setFullName("");
    setRole("cook");
    setWarehouseId("__none__");
    setError("");
  }

  const passwordTooShort = password.length > 0 && password.length < 8;
  const passwordsMismatch = passwordConfirm.length > 0 && password !== passwordConfirm;
  const needsWarehouse = role !== "manager";
  const warehouseMissing = needsWarehouse && warehouseId === "__none__";
  const canSubmit =
    username.trim().length >= 2 &&
    password.length >= 8 &&
    password === passwordConfirm &&
    !warehouseMissing &&
    !mutation.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) resetForm();
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("users.create_title")}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("users.create_title")}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSubmit) return;
            mutation.mutate();
          }}
        >
          <div className="space-y-2">
            <Label>{t("users.field_name")}</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>{t("users.field_login")}</Label>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
              required
              minLength={2}
            />
          </div>
          <div className="space-y-2">
            <Label>{t("users.field_password")}</Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
              minLength={8}
            />
            {passwordTooShort && (
              <p className="text-xs text-destructive">{t("users.error_password_too_short")}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label>{t("users.field_password_confirm")}</Label>
            <Input
              type="password"
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              autoComplete="new-password"
              required
              minLength={8}
            />
            {passwordsMismatch && (
              <p className="text-xs text-destructive">{t("users.error_passwords_mismatch")}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label>{t("users.field_role")}</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {t(ROLE_LABEL_KEYS[r] as never)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t("users.field_warehouse")}</Label>
            <Select value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {!needsWarehouse && (
                  <SelectItem value="__none__">{t("users.no_warehouse")}</SelectItem>
                )}
                {warehouses.map((w) => (
                  <SelectItem key={w.id} value={String(w.id)}>
                    {warehouseName(w.id, warehouses, t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {warehouseMissing && (
              <p className="text-xs text-destructive">{t("users.error_warehouse_required")}</p>
            )}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {mutation.isPending ? t("common.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────
// Edit user dialog
// ─────────────────────────────────────────────────────

function EditUserDialog({
  open,
  onOpenChange,
  user,
  warehouses,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  user: UserListItem;
  warehouses: Warehouse[];
  onSaved: () => void;
  currentUserId?: string;
}) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  const [fullName, setFullName] = useState(user.full_name ?? "");
  const [role, setRole] = useState(user.role);
  const [warehouseId, setWarehouseId] = useState<string>(
    user.warehouse_id != null ? String(user.warehouse_id) : "__none__",
  );
  const [isActive, setIsActive] = useState(user.is_active);
  const [error, setError] = useState("");

  // Reset when user changes
  useEffect(() => {
    setFullName(user.full_name ?? "");
    setRole(user.role);
    setWarehouseId(user.warehouse_id != null ? String(user.warehouse_id) : "__none__");
    setIsActive(user.is_active);
    setError("");
  }, [user]);

  const needsWarehouse = role !== "manager";
  const warehouseMissing = needsWarehouse && warehouseId === "__none__";

  const mutation = useMutation({
    mutationFn: () =>
      adminPatchUser(user.id, {
        full_name: fullName.trim() || null,
        role,
        warehouse_id: warehouseId !== "__none__" ? Number(warehouseId) : null,
        is_active: isActive,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      void queryClient.invalidateQueries({ queryKey: CURRENT_USER_QUERY_KEY });
      onOpenChange(false);
      onSaved();
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("last manager")) {
        setError(t("users.error_last_manager"));
      } else {
        setError(msg || t("users.error_save"));
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("users.edit_title")}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("users.edit_title")}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (warehouseMissing) return;
            mutation.mutate();
          }}
        >
          <div className="space-y-2">
            <Label>{t("users.field_name")}</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>{t("users.field_login")}</Label>
            <Input value={user.username} disabled className="opacity-60" />
          </div>
          <div className="space-y-2">
            <Label>{t("users.field_role")}</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {t(ROLE_LABEL_KEYS[r] as never)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t("users.field_warehouse")}</Label>
            <Select value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {!needsWarehouse && (
                  <SelectItem value="__none__">{t("users.no_warehouse")}</SelectItem>
                )}
                {warehouses.map((w) => (
                  <SelectItem key={w.id} value={String(w.id)}>
                    {warehouseName(w.id, warehouses, t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {warehouseMissing && (
              <p className="text-xs text-destructive">{t("users.error_warehouse_required")}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label>{t("users.field_status")}</Label>
            <Select
              value={isActive ? "active" : "blocked"}
              onValueChange={(v) => setIsActive(v === "active")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">{t("users.status_active")}</SelectItem>
                <SelectItem value="blocked">{t("users.status_blocked")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={warehouseMissing || mutation.isPending}>
              {mutation.isPending ? t("common.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────
// Password reset dialog
// ─────────────────────────────────────────────────────

function PasswordDialog({
  open,
  onOpenChange,
  user,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  user: UserListItem;
  onChanged: () => void;
}) {
  const { t } = useLanguage();
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: () => adminResetPassword(user.id, password),
    onSuccess: () => {
      onOpenChange(false);
      setPassword("");
      setPasswordConfirm("");
      setError("");
      onChanged();
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : t("users.error_password"));
    },
  });

  const passwordTooShort = password.length > 0 && password.length < 8;
  const passwordsMismatch = passwordConfirm.length > 0 && password !== passwordConfirm;
  const canSubmit = password.length >= 8 && password === passwordConfirm && !mutation.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setPassword("");
          setPasswordConfirm("");
          setError("");
        }
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("users.password_title")}</DialogTitle>
          <DialogDescription>
            {user.full_name || user.username}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSubmit) return;
            mutation.mutate();
          }}
        >
          <div className="space-y-2">
            <Label>{t("users.new_password")}</Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
              minLength={8}
            />
            {passwordTooShort && (
              <p className="text-xs text-destructive">{t("users.error_password_too_short")}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label>{t("users.field_password_confirm")}</Label>
            <Input
              type="password"
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              autoComplete="new-password"
              required
              minLength={8}
            />
            {passwordsMismatch && (
              <p className="text-xs text-destructive">{t("users.error_passwords_mismatch")}</p>
            )}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {mutation.isPending ? t("common.saving") : t("users.change_password")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────
// Delete user confirmation dialog
// ─────────────────────────────────────────────────────

function DeleteUserDialog({
  open,
  onOpenChange,
  user,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  user: UserListItem | null;
  onDeleted: () => void;
}) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => adminDeleteUser(user!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      onOpenChange(false);
      onDeleted();
    },
  });

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("users.delete_title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("users.delete_description")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={mutation.isPending}
            onClick={(e) => {
              e.preventDefault();
              mutation.mutate();
            }}
          >
            {mutation.isPending ? t("common.saving") : t("users.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
