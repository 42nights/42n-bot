export default function Settings() {
  return (
    <div className="max-w-2xl mx-auto px-8 py-10">
      <h1 className="font-serif text-3xl tracking-tight">Settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Configuration is file-based. Edit <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">bot.config.ts</code> and restart the coordinator.
      </p>
      <ul className="mt-8 space-y-3 text-sm">
        <li>
          <strong>Webhook URL:</strong> <code className="font-mono text-xs">/api/github/webhook</code>
          {" "}— register with GitHub using the shared secret in <code className="font-mono text-xs">GITHUB_WEBHOOK_SECRET</code>.
        </li>
        <li>
          <strong>Polling fallback:</strong> 60s. Runs alongside the webhook so the bot survives webhook outages.
        </li>
        <li>
          <strong>Claude Code binary:</strong> set <code className="font-mono text-xs">CLAUDE_CODE_PATH</code> if the binary isn't on PATH as <code className="font-mono text-xs">claude</code>.
        </li>
        <li>
          <strong>Workspaces:</strong> bot-created worktrees live under <code className="font-mono text-xs">~/.42n-bot/worktrees</code>. Override with <code className="font-mono text-xs">WORKTREE_ROOT</code>.
        </li>
      </ul>
    </div>
  );
}
