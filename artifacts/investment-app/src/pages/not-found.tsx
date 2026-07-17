import { Link } from "wouter";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-6">
      <div className="space-y-2">
        <h1 className="text-6xl font-mono font-bold text-destructive">404</h1>
        <h2 className="text-xl font-mono text-muted-foreground">ERR_ENDPOINT_NOT_FOUND</h2>
      </div>
      <p className="text-muted-foreground max-w-md">
        The requested system endpoint could not be located. Connection terminated.
      </p>
      <Link
        href="/"
        className="px-6 py-2 bg-secondary text-secondary-foreground hover:bg-secondary/80 font-mono text-sm rounded-md border border-border transition-colors"
      >
        [ RETURN TO HUB ]
      </Link>
    </div>
  );
}
