import { LOCALES, type Locale } from "@farmhand/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useMatches, useNavigate } from "@tanstack/react-router";
import {
  AppWindowIcon,
  HistoryIcon,
  LanguagesIcon,
  LayoutDashboardIcon,
  type LucideIcon,
  MenuIcon,
  MonitorIcon,
  MoonIcon,
  PrinterIcon,
  RadarIcon,
  SettingsIcon,
  SunIcon,
  UserIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetClose, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { setLocale } from "@/i18n";
import { fetchJson } from "@/lib/api";
import { type LiveStatus, startLive, useLiveStatus } from "@/lib/live";
import { q } from "@/lib/queries";
import type { SessionUser } from "@/lib/types";
import { useErrorText } from "./QueryState";
import { StatusBadge, type Tone } from "./StatusBadge";

const NAV: { to: string; key: string; icon: LucideIcon; exact?: boolean }[] = [
  { to: "/", key: "nav.overview", icon: LayoutDashboardIcon, exact: true },
  { to: "/printers", key: "nav.printers", icon: PrinterIcon },
  { to: "/discover", key: "nav.discover", icon: RadarIcon },
  { to: "/apps", key: "nav.apps", icon: AppWindowIcon },
  { to: "/maintenance", key: "nav.maintenance", icon: WrenchIcon },
  { to: "/settings", key: "nav.settings", icon: SettingsIcon },
];

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation();
  const linkClass =
    "flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground data-[status=active]:bg-muted data-[status=active]:text-foreground";
  return (
    <nav aria-label={t("nav.label")} className="flex flex-1 flex-col gap-1 p-3">
      {NAV.map(({ to, key, icon: Icon, exact }) => (
        <Link key={to} to={to} activeOptions={{ exact }} className={linkClass} onClick={onNavigate}>
          <Icon aria-hidden className="size-4" />
          {t(key)}
        </Link>
      ))}
      <div className="mt-auto border-t pt-2">
        <Link to="/operations" className={linkClass} onClick={onNavigate}>
          <HistoryIcon aria-hidden className="size-4" />
          {t("nav.operations")}
        </Link>
      </div>
    </nav>
  );
}

const LIVE_TONE: Record<LiveStatus, Tone> = { live: "ok", reconnecting: "warn", offline: "bad" };

function LiveIndicator() {
  const { t } = useTranslation();
  const status = useLiveStatus();
  return (
    <span role="status" aria-label={t("live.aria", { status: t(`live.${status}`) })}>
      <StatusBadge tone={LIVE_TONE[status]} label={t(`live.${status}`)} />
    </span>
  );
}

export function ThemeMenu() {
  const { t } = useTranslation();
  const { theme = "system", setTheme } = useTheme();
  const Icon = theme === "dark" ? MoonIcon : theme === "light" ? SunIcon : MonitorIcon;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={t("theme.label")} />}>
        <Icon aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("theme.label")}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(String(v))}>
            {(["system", "light", "dark"] as const).map((v) => (
              <DropdownMenuRadioItem key={v} value={v}>
                {t(`theme.${v}`)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function LanguageMenu() {
  const { t, i18n } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={t("language.label")} />}>
        <LanguagesIcon aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("language.label")}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={i18n.language} onValueChange={(v) => setLocale(v as Locale)}>
            {LOCALES.map((l) => (
              <DropdownMenuRadioItem key={l} value={l}>
                {t(`language.${l}`)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu({ user }: { user: SessionUser }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const errorText = useErrorText();
  const open = useQuery(q.session).data?.open === true;

  const signOut = async () => {
    try {
      await fetchJson("/auth/sign-out", { method: "POST", json: {} });
      qc.clear();
      await navigate({ to: "/login" });
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={t("user.menu")} />}>
        <UserIcon aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <span className="block truncate text-sm text-foreground">{user.name}</span>
            <span className="block truncate">{user.email}</span>
            <span className="block">{t(`roles.${user.role}`)}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link to="/operations" />}>{t("nav.operations")}</DropdownMenuItem>
        {open ? null : <DropdownMenuItem onClick={signOut}>{t("user.signOut")}</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    titleKey?: string;
  }
}

export function AppShell({ user, children }: { user: SessionUser; children: ReactNode }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [drawer, setDrawer] = useState(false);
  const titleKey = useMatches({
    select: (ms) => ms.findLast((m) => m.staticData?.titleKey)?.staticData.titleKey,
  });

  useEffect(() => startLive(qc), [qc]);

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r bg-sidebar lg:flex">
        <div className="flex h-14 items-center border-b px-5 font-semibold">{t("app.name")}</div>
        <Nav />
      </aside>

      <Sheet open={drawer} onOpenChange={setDrawer}>
        <SheetContent side="left" showCloseButton={false} className="w-72 gap-0 p-0">
          <div className="flex h-14 items-center justify-between border-b pr-1 pl-5">
            <SheetTitle className="font-semibold">{t("app.name")}</SheetTitle>
            <SheetClose render={<Button variant="ghost" size="icon" aria-label={t("nav.close")} />}>
              <XIcon aria-hidden />
            </SheetClose>
          </div>
          <Nav onNavigate={() => setDrawer(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-1 border-b bg-background/95 px-2 backdrop-blur sm:gap-2 sm:px-4">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label={t("nav.open")}
            onClick={() => setDrawer(true)}
          >
            <MenuIcon aria-hidden />
          </Button>
          <p className="min-w-0 flex-1 truncate font-medium">{titleKey ? t(titleKey) : t("app.name")}</p>
          <LiveIndicator />
          <ThemeMenu />
          <LanguageMenu />
          <UserMenu user={user} />
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 space-y-6 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
