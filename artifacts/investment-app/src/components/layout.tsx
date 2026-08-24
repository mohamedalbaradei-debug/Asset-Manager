import { Link, useLocation } from "wouter";
import {
  Activity,
  LayoutDashboard,
  TrendingUp,
  Layers,
  GitCompareArrows,
  Sigma,
  Globe,
  Landmark,
  Coins,
  Scale,
  Ship,
  Newspaper,
  Star,
  Calculator,
  ChartCandlestick,
  Search,
  Bitcoin,
  Wallet,
  CalendarDays,
  LogIn,
  type LucideIcon,
} from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { SidebarAuthBlock } from "@/components/auth-dialog";
import { useAuth } from "@/lib/auth-context";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  anonOnly?: boolean;
  premium?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    label: "Core",
    items: [
      { href: "/", label: "Terminal", icon: LayoutDashboard },
      { href: "/market", label: "Market Macro", icon: Activity },
      { href: "/planner", label: "Planner", icon: Calculator },
      { href: "/etfs", label: "ETF Explorer", icon: ChartCandlestick },
      { href: "/stocks/AAPL", label: "Stock Detail", icon: Search },
    ],
  },
  {
    label: "Equities",
    items: [
      { href: "/movers", label: "Market Movers", icon: TrendingUp },
      { href: "/sectors", label: "Sector Rotation", icon: Layers },
      { href: "/spyqqq", label: "SPY vs QQQ", icon: GitCompareArrows },
      { href: "/gex", label: "GEX & Options Flow", icon: Sigma, premium: true },
      { href: "/calendar", label: "Market Calendar", icon: CalendarDays },
      { href: "/crypto", label: "Crypto Options", icon: Bitcoin, premium: true },
    ],
  },
  {
    label: "Macro",
    items: [
      { href: "/macro", label: "US Macro", icon: Activity },
      { href: "/global", label: "Global Macro", icon: Globe },
      { href: "/fed", label: "Fed Dashboard", icon: Landmark },
      { href: "/fx", label: "FX Monitor", icon: Coins },
      { href: "/valuation", label: "Valuation", icon: Scale },
      { href: "/shipping", label: "Shipping", icon: Ship },
    ],
  },
    {
      label: "Info",
      items: [
        { href: "/news", label: "News & Pulse", icon: Newspaper },
        { href: "/watchlist", label: "Watchlist & Calendar", icon: Star, premium: true },
        { href: "/holdings", label: "My Holdings", icon: Wallet, premium: true },
        { href: "/login", label: "Sign In", icon: LogIn, anonOnly: true },
      ],
    },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user } = useAuth();

  return (
    <div className="flex min-h-screen w-full bg-background text-foreground flex-col md:flex-row">
      <aside className="w-full md:w-64 border-b md:border-b-0 md:border-r border-border bg-card flex flex-col">
        <div className="p-4 border-b border-border flex items-center gap-3">
          <div className="w-8 h-8 bg-primary flex items-center justify-center rounded-sm">
            <Activity className="w-5 h-5 text-primary-foreground" />
          </div>
          <div className="font-mono font-bold tracking-tight text-lg">
            AI_INVEST<span className="text-primary">.SYS</span>
          </div>
        </div>
        <nav className="flex-1 p-4 space-y-4 flex flex-row md:flex-col overflow-x-auto md:overflow-visible">
          {navGroups.map((group) => (
            <div key={group.label} className="flex flex-col md:flex-col gap-1 shrink-0">
              <div className="hidden md:block text-[10px] font-mono font-bold tracking-widest text-muted-foreground/60 uppercase px-3 mb-1">
                {group.label}
              </div>
               <div className="flex md:flex-col gap-1">
                {group.items.map((item) => {
                  if (item.anonOnly && user) return null;
                  if (item.premium && !user) return null;
                  const isActive = location === item.href;
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2 rounded-md transition-colors font-medium text-sm whitespace-nowrap",
                        isActive
                          ? "bg-primary/10 text-primary border border-primary/20"
                          : "text-muted-foreground hover:bg-secondary hover:text-foreground border border-transparent"
                      )}
                    >
                      <Icon className="w-4 h-4" />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className="p-4 border-t border-border flex flex-col gap-2">
          <SidebarAuthBlock />
          <div className="text-xs font-mono text-muted-foreground flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            SYS_ONLINE
          </div>
        </div>
      </aside>
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        <div className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}