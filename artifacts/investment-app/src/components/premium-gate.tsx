import React from "react";
import { useAuth } from "@/lib/auth-context";
import { AuthDialog } from "@/components/auth-dialog";
import { LoadingState } from "@/components/panels";

export function PremiumGate({ children, feature }: { children: React.ReactNode; feature?: string }) {
  const { user, ready } = useAuth();
  if (!ready) return <LoadingState />;
  if (user) return <>{children}</>;
  return (
    <div className="max-w-2xl mx-auto py-20 text-center space-y-4">
      <div className="text-5xl">🔒</div>
      <h1 className="text-2xl font-bold tracking-tight">
        {feature ? `${feature} is a Premium feature` : "This is a Premium feature"}
      </h1>
      <p className="text-muted-foreground font-mono text-sm max-w-md mx-auto leading-relaxed">
        Sign in (or create a free account) to unlock it.
      </p>
      <div className="flex justify-center">
        <AuthDialog>
          <button className="bg-primary text-primary-foreground font-mono font-bold rounded-md px-5 py-2.5 text-sm hover:bg-primary/90 transition-colors">
            SIGN IN TO UNLOCK
          </button>
        </AuthDialog>
      </div>
    </div>
  );
}
