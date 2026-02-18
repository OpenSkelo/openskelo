import { Command } from "commander";
import chalk from "chalk";
import { text, isCancel, spinner } from "@clack/prompts";
import open from "open";
import { existsSync } from "node:fs";
import { getAuthPath, loadAuthStore, saveAuthStore } from "../core/auth.js";
import { loginOpenAIOAuth } from "../core/oauth.js";

export function authCommands(parent: Command): void {
  const auth = parent
    .command("auth")
    .description("Manage provider authentication (stored in ~/.skelo/auth.json)");

  auth
    .command("status")
    .description("Show connected provider auth status")
    .action(() => {
      const path = getAuthPath();
      if (!existsSync(path)) {
        console.log(chalk.dim("No auth store found. Run 'skelo onboard' to connect a provider."));
        return;
      }

      let store;
      try {
        store = loadAuthStore();
      } catch (err) {
        console.error(chalk.red(`✗ Failed to read auth store: ${String((err as Error).message ?? err)}`));
        process.exit(1);
      }

      if (!store || Object.keys(store.providers).length === 0) {
        console.log(chalk.dim("No providers connected."));
        return;
      }

      console.log(chalk.bold("Provider Auth Status"));
      console.log(chalk.dim(path));
      for (const [name, entry] of Object.entries(store.providers)) {
        if (entry.type === "oauth") {
          const exp = entry.expires_at ? new Date(entry.expires_at) : null;
          const active = exp && Number.isFinite(exp.getTime()) && exp.getTime() > Date.now();
          console.log(`${name.padEnd(14)} OAuth    ${active ? chalk.green("✓ active") : chalk.yellow("⚠ expired")} ${entry.account_id ? `(${entry.account_id})` : ""}`);
        } else {
          console.log(`${name.padEnd(14)} API key  ${chalk.green("✓ active")}`);
        }
      }
    });

  auth
    .command("login <provider>")
    .description("Login a provider (currently supports: openai)")
    .action(async (provider: string) => {
      if (provider !== "openai") {
        console.error(chalk.red(`✗ Unsupported provider '${provider}'. Use: openai`));
        process.exit(1);
      }

      const spin = spinner();
      spin.start("Starting OpenAI OAuth login...");
      try {
        const tokens = await loginOpenAIOAuth({
          onAuthUrl: async (url) => {
            spin.update("Opening browser for OpenAI sign-in...");
            await open(url);
            console.log(chalk.dim(`If browser did not open, visit:\n${url}`));
          },
          onProgress: (message) => spin.update(message),
          onPrompt: async (message) => {
            const input = await text({ message, placeholder: "http://127.0.0.1:1455/auth/callback?code=...&state=..." });
            if (isCancel(input)) throw new Error("OAuth login cancelled");
            return String(input);
          },
        });

        const store = loadAuthStore() ?? { version: 1 as const, providers: {} };
        store.providers.openai = {
          type: "oauth",
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          token_type: tokens.token_type,
          expires_at: tokens.expires_at,
          account_id: tokens.account_id,
          created_at: new Date().toISOString(),
        };
        saveAuthStore(store);

        spin.stop("OpenAI OAuth complete");
        console.log(chalk.green(`✓ Connected to OpenAI${tokens.account_id ? ` (${tokens.account_id})` : ""}`));
      } catch (err) {
        spin.stop("OpenAI OAuth failed");
        console.error(chalk.red(`✗ ${String((err as Error).message ?? err)}`));
        process.exit(2);
      }
    });

  auth
    .command("logout [provider]")
    .description("Remove auth for one provider, or all providers when omitted")
    .option("-y, --yes", "Skip confirmation", false)
    .action((provider: string | undefined, opts: { yes?: boolean }) => {
      const store = loadAuthStore();
      if (!store) {
        console.log(chalk.dim("No auth store found."));
        return;
      }

      if (provider) {
        if (!store.providers[provider]) {
          console.log(chalk.yellow(`No auth entry for provider '${provider}'.`));
          return;
        }
        delete store.providers[provider];
        saveAuthStore(store);
        console.log(chalk.green(`✓ Logged out '${provider}'.`));
        return;
      }

      if (!opts.yes) {
        console.log(chalk.yellow("Refusing to remove all providers without --yes."));
        console.log(chalk.dim("Run: skelo auth logout --yes"));
        process.exit(1);
      }

      saveAuthStore({ version: 1, providers: {} });
      console.log(chalk.green("✓ Logged out all providers."));
    });
}
