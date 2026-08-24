import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import HubPage from '@/pages/hub';
import MarketPage from '@/pages/market';
import MoversPage from '@/pages/movers';
import SectorRotationPage from '@/pages/sector-rotation';
import SpyQqqPage from '@/pages/spyqqq';
import GexPage from '@/pages/gex';
import { CalendarPage } from '@/pages/calendar';
import CryptoOptionsPage from '@/pages/crypto-options';
import MacroFullPage from '@/pages/macro-full';
import GlobalMacroPage from '@/pages/global-macro';
import FedPage from '@/pages/fed';
import FxPage from '@/pages/fx';
import ValuationPage from '@/pages/valuation';
import ShippingPage from '@/pages/shipping';
import NewsPage from '@/pages/news';
import WatchlistPage from '@/pages/watchlist';
import HoldingsPage from '@/pages/holdings';
import PlannerPage from '@/pages/planner';
import EtfTrackerPage from '@/pages/etf-tracker';
import StockDetailPage from '@/pages/stock-detail';
import LoginPage from '@/pages/login';
import { Layout } from '@/components/layout';
import { AuthProvider } from '@/lib/auth-context';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000,
    },
  },
});

function Router() {
  return (
    <AuthProvider>
      <Layout>
        <Switch>
          <Route path="/" component={HubPage} />
          <Route path="/market" component={MarketPage} />
          <Route path="/movers" component={MoversPage} />
          <Route path="/sectors" component={SectorRotationPage} />
          <Route path="/spyqqq" component={SpyQqqPage} />
          <Route path="/gex" component={GexPage} />
          <Route path="/calendar" component={CalendarPage} />
          <Route path="/crypto" component={CryptoOptionsPage} />
          <Route path="/macro" component={MacroFullPage} />
          <Route path="/global" component={GlobalMacroPage} />
          <Route path="/fed" component={FedPage} />
          <Route path="/fx" component={FxPage} />
          <Route path="/valuation" component={ValuationPage} />
          <Route path="/shipping" component={ShippingPage} />
          <Route path="/news" component={NewsPage} />
          <Route path="/watchlist" component={WatchlistPage} />
          <Route path="/holdings" component={HoldingsPage} />
          <Route path="/planner" component={PlannerPage} />
          <Route path="/etfs" component={EtfTrackerPage} />
          <Route path="/stocks/:symbol" component={StockDetailPage} />
          <Route path="/login" component={LoginPage} />
          <Route component={NotFound} />
        </Switch>
      </Layout>
    </AuthProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;