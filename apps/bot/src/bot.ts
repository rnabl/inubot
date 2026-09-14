import { Bot, InlineKeyboard, InputFile } from "grammy";
import QRCode from "qrcode";
import { formatEther, parseEther } from "viem";
import { RouteClient, type RouteAsset } from "@inubot/route";
import { prisma } from "@inubot/db";
import {
  ADDRESS_RE,
  BUY_PRESETS_ETH,
  SELL_PRESETS_BPS,
} from "@inubot/shared";
import { createRobinhoodPublicClient } from "@inubot/wallet";
import { computeMinOut, reviewedAmountOut } from "@inubot/route";
import type { Env } from "./env.js";
import { explorerAddress, explorerTx, feeLine, formatTokenAmount, shortAddress } from "./format.js";
import { clearPending, createPending, getPending, updatePending, createPendingWithdraw, getPendingWithdraw, getAnyPendingWithdraw, clearPendingWithdraw } from "./pending.js";
import { signCeremonyToken } from "./ceremony-token.js";
import { executeSwap, remainingForUser, spentToday } from "./swap.js";
import { activeSession, ensureUser, getUserByTelegram } from "./users.js";

function ceremonyUrl(env: Env, telegramId: string, mode: "setup" | "withdraw" = "setup"): string {
  const token = signCeremonyToken(telegramId, env.CEREMONY_SECRET);
  const url = new URL(env.CEREMONY_URL);
  url.searchParams.set("t", token);
  if (mode === "withdraw") {
    url.searchParams.set("mode", "withdraw");
  }
  return url.toString();
}

function helpText(): string {
  return [
    "InuBot — Robinhood Chain swaps via Route.",
    "",
    "/start — create wallet (Face ID in Safari, one time)",
    "/reset — clear wallet record & re-link fresh session",
    "/wallet — address, ETH, deposit QR",
    "/holdings — token balances",
    "/settings — slippage & default withdraw address",
    "/withdraw — send ETH or tokens (requires Face ID)",
    "Paste a contract address to buy or sell",
    "/help — this list",
    "",
    "The bot holds a scoped session key only. Withdrawals and raising the daily cap need Face ID again. Lose the device without a second passkey and the account is gone.",
  ].join("\n");
}

export function createBot(env: Env) {
  const bot = new Bot(env.TELEGRAM_BOT_TOKEN);
  const route = new RouteClient({ baseUrl: env.ROUTE_API_BASE });
  const publicClient = createRobinhoodPublicClient(env.RPC_URL || undefined);

  bot.command("help", async (ctx) => {
    await ctx.reply(helpText());
  });

  bot.command("settings", async (ctx) => {
    await sendSettings(ctx, env);
  });

  bot.command("withdraw", async (ctx) => {
    const telegramId = String(ctx.from?.id ?? "");
    const user = await getUserByTelegram(telegramId);
    if (!user?.wallet) {
      await ctx.reply("No wallet yet. Use /start.");
      return;
    }

    const balance = await publicClient.getBalance({ address: user.wallet.address as `0x${string}` });
    const ethBalance = formatEther(balance);

    const keyboard = new InlineKeyboard();
    
    if (user.defaultWithdrawAddress) {
      keyboard.text(`Quick Withdraw to ${shortAddress(user.defaultWithdrawAddress)}`, "withdraw:quick").row();
    }
    keyboard.text("Withdraw to Custom Address", "withdraw:custom");

    await ctx.reply(
      [
        `💰 Withdraw ETH`,
        ``,
        `Balance: ${ethBalance} ETH`,
        ``,
        user.defaultWithdrawAddress 
          ? `Default address: \`${user.defaultWithdrawAddress}\`` 
          : `No default address set. Use /settings to add one.`,
      ].join("\n"),
      { reply_markup: keyboard, parse_mode: "Markdown" }
    );
  });

  bot.command("start", async (ctx) => {
    const telegramId = String(ctx.from?.id ?? "");
    if (!telegramId) return;
    const user = await ensureUser(telegramId, env.DEFAULT_SLIPPAGE_BPS);
    const session = activeSession(user);

    if (user.wallet && session) {
      await ctx.reply(
        [
          "Wallet ready.",
          `\`${user.wallet.address}\``,
          "",
          helpText(),
        ].join("\n"),
        { parse_mode: "Markdown" },
      );
      return;
    }

    const url = ceremonyUrl(env, telegramId);
    await ctx.reply(
      [
        "Create your InuBot wallet.",
        "",
        "This opens Safari for one Face ID / passkey. Telegram cannot create a real passkey inside chat.",
        `Default daily trading cap: ${env.DEFAULT_DAILY_CAP_ETH} ETH (session lasts 30 days).`,
        "Losing this device without a recovery passkey means losing the account.",
      ].join("\n"),
      {
        reply_markup: new InlineKeyboard().url("Create wallet (Face ID)", url),
      },
    );
  });

  bot.command("reset", async (ctx) => {
    const telegramId = String(ctx.from?.id ?? "");
    if (!telegramId) return;
    const user = await getUserByTelegram(telegramId);
    
    if (!user?.wallet) {
      await ctx.reply("No wallet to reset. Use /start to create one.");
      return;
    }

    const address = user.wallet.address;
    
    // Delete wallet record (cascades to session keys, daily spends, txs)
    await prisma.wallet.delete({
      where: { id: user.wallet.id },
    });

    await ctx.reply(
      [
        "✅ Wallet record cleared from bot.",
        "",
        `Your smart account still exists on-chain:`,
        `\`${address}\``,
        "",
        "Use /start to re-link with Face ID and get a fresh session key.",
      ].join("\n"),
      { parse_mode: "Markdown" }
    );
  });

  bot.command("wallet", async (ctx) => {
    const telegramId = String(ctx.from?.id ?? "");
    const user = await getUserByTelegram(telegramId);
    if (!user?.wallet) {
      await ctx.reply("No wallet yet. Use /start.");
      return;
    }
    const balance = await publicClient.getBalance({ address: user.wallet.address as `0x${string}` });
    const session = activeSession(user);
    const spent = await spentToday(user.wallet.id);
    const remaining = session ? remainingForUser(session, spent) : 0n;
    const png = await QRCode.toBuffer(user.wallet.address, { width: 360, margin: 2 });
    await ctx.replyWithPhoto(new InputFile(png, "deposit.png"), {
      caption: [
        `Address: \`${user.wallet.address}\``,
        `[Explorer](${explorerAddress(user.wallet.address)})`,
        `ETH: ${formatTokenAmount(balance, 18)}`,
        env.ALCHEMY_GAS_POLICY_ID ? "Gas: sponsored (Alchemy paymaster)" : "Gas: you pay ETH",
        session
          ? `Session cap left today: ${formatTokenAmount(remaining, 18)} ETH`
          : "Session expired — /start to renew with Face ID.",
      ].join("\n"),
      parse_mode: "Markdown",
    });
  });

  bot.command("holdings", async (ctx) => {
    await sendHoldings(ctx, env, route, publicClient);
  });

  bot.on("message:text", async (ctx, next) => {
    const text = ctx.message.text.trim();
    const telegramId = String(ctx.from.id);
    
    // Check for pending withdraw
    const pendingW = getAnyPendingWithdraw(telegramId);
    if (pendingW) {
      if (pendingW.type === "set_address") {
        // Setting default withdraw address
        if (text.toLowerCase() === "clear") {
          await prisma.user.update({
            where: { telegramId },
            data: { defaultWithdrawAddress: null },
          });
          clearPendingWithdraw(telegramId, pendingW.id);
          await ctx.reply("Default withdraw address cleared.");
          return;
        }
        if (!ADDRESS_RE.test(text)) {
          await ctx.reply("Invalid ETH address. Please send a valid 0x address.");
          return;
        }
        await prisma.user.update({
          where: { telegramId },
          data: { defaultWithdrawAddress: text },
        });
        clearPendingWithdraw(telegramId, pendingW.id);
        await ctx.reply(`Default withdraw address set to:\n\`${text}\``, { parse_mode: "Markdown" });
        return;
      }
      
      if (pendingW.type === "quick") {
        // Quick withdraw - need amount
        const amount = parseFloat(text);
        if (isNaN(amount) || amount <= 0) {
          await ctx.reply("Invalid amount. Please send a valid number (e.g., 0.1)");
          return;
        }
        pendingW.amount = text;
        updatePendingWithdraw(pendingW);
        
        // Create withdrawal URL and show confirmation
        const url = ceremonyUrl(env, telegramId, "withdraw");
        await ctx.reply(
          [
            `💸 Withdraw ${amount} ETH`,
            `To: \`${pendingW.recipient}\``,
            ``,
            `Tap below to confirm with Face ID:`,
          ].join("\n"),
          {
            parse_mode: "Markdown",
            reply_markup: new InlineKeyboard().url("Confirm Withdrawal (Face ID)", url),
          }
        );
        return;
      }
      
      if (pendingW.type === "custom") {
        // Custom withdraw - need address and amount
        const parts = text.split(/\s+/);
        if (parts.length !== 2) {
          await ctx.reply("Please send address and amount separated by space:\n0x123...abc 0.1");
          return;
        }
        const [addr, amtStr] = parts;
        if (!ADDRESS_RE.test(addr)) {
          await ctx.reply("Invalid ETH address.");
          return;
        }
        const amount = parseFloat(amtStr);
        if (isNaN(amount) || amount <= 0) {
          await ctx.reply("Invalid amount.");
          return;
        }
        pendingW.recipient = addr;
        pendingW.amount = amtStr;
        updatePendingWithdraw(pendingW);
        
        // Create withdrawal URL and show confirmation
        const url = ceremonyUrl(env, telegramId, "withdraw");
        await ctx.reply(
          [
            `💸 Withdraw ${amount} ETH`,
            `To: \`${addr}\``,
            ``,
            `Tap below to confirm with Face ID:`,
          ].join("\n"),
          {
            parse_mode: "Markdown",
            reply_markup: new InlineKeyboard().url("Confirm Withdrawal (Face ID)", url),
          }
        );
        return;
      }
    }
    
    // Normal flow - check for contract address
    if (text.startsWith("/")) return next();
    if (!ADDRESS_RE.test(text)) return next();
    await sendTokenCard(ctx, route, text);
  });

  bot.callbackQuery(/^buy:(\d+):(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const preset = Number(ctx.match[2]);
    const telegramId = String(ctx.from.id);
    const pending = getPending(telegramId, id);
    if (!pending) {
      await ctx.answerCallbackQuery({ text: "Expired — paste the token again" });
      return;
    }
    const amount = BUY_PRESETS_ETH[preset];
    if (!amount) {
      await ctx.answerCallbackQuery({ text: "Unknown amount" });
      return;
    }
    pending.side = "buy";
    pending.amountIn = parseEther(amount).toString();
    updatePending(pending);
    await showQuote(ctx, env, route, pending);
  });

  bot.callbackQuery(/^sell:(\d+):(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const preset = Number(ctx.match[2]);
    const telegramId = String(ctx.from.id);
    const pending = getPending(telegramId, id);
    if (!pending) {
      await ctx.answerCallbackQuery({ text: "Expired — paste the token again" });
      return;
    }
    const user = await getUserByTelegram(telegramId);
    if (!user?.wallet) {
      await ctx.answerCallbackQuery({ text: "Create a wallet first" });
      return;
    }
    const bps = SELL_PRESETS_BPS[preset];
    if (bps === undefined) {
      await ctx.answerCallbackQuery({ text: "Unknown percent" });
      return;
    }
    const listed = await route.getTokens({
      address: pending.token.address,
      wallet: user.wallet.address,
    });
    const held = listed.tokens.find(
      (t) => t.address.toLowerCase() === pending.token.address.toLowerCase(),
    );
    const balance = BigInt(held?.balance ?? "0");
    if (balance <= 0n) {
      await ctx.answerCallbackQuery({ text: "No balance to sell" });
      return;
    }
    pending.side = "sell";
    pending.amountIn = ((balance * BigInt(bps)) / 10_000n).toString();
    updatePending(pending);
    await showQuote(ctx, env, route, pending);
  });

  bot.callbackQuery(/^go:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const telegramId = String(ctx.from.id);
    const pending = getPending(telegramId, id);
    if (!pending) {
      await ctx.answerCallbackQuery({ text: "Expired — start again" });
      return;
    }
    await ctx.answerCallbackQuery({ text: "Swapping…" });
    await ctx.editMessageText("Submitting swap…");
    try {
      const tokenIn = pending.side === "buy" ? "ETH" : pending.token.address;
      const tokenOut = pending.side === "buy" ? pending.token.address : "ETH";
      const result = await executeSwap({
        env,
        telegramId,
        tokenIn,
        tokenOut,
        amountIn: BigInt(pending.amountIn),
      });
      clearPending(telegramId, id);
      const hashLine = result.txHash
        ? `[${shortAddress(result.txHash)}](${explorerTx(result.txHash)})`
        : `Call ${result.callId}`;
      await ctx.editMessageText(
        [
          "Swap submitted.",
          hashLine,
          `Expected out: ${result.prepared.amountOut}`,
          feeLine(result.prepared.protocolFeeBps),
        ].join("\n"),
        { parse_mode: "Markdown" },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.editMessageText(`Swap failed: ${message}`);
    }
  });

  bot.callbackQuery(/^no:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    clearPending(String(ctx.from.id), id);
    await ctx.answerCallbackQuery({ text: "Cancelled" });
    await ctx.editMessageText("Cancelled.");
  });

  bot.callbackQuery("rfh", async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendHoldings(ctx, env, route, publicClient, true);
  });

  bot.callbackQuery("settings", async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendSettings(ctx, env, true);
  });

  bot.callbackQuery("settings:slippage", async (ctx) => {
    await ctx.answerCallbackQuery();
    const user = await getUserByTelegram(String(ctx.from.id));
    const current = user?.slippageBps ?? env.DEFAULT_SLIPPAGE_BPS;
    await ctx.editMessageText(
      `⚙️ Slippage Tolerance\n\nCurrent: ${current / 100}%\n\nChoose your max slippage for swaps:`,
      {
        reply_markup: new InlineKeyboard()
          .text(current === 50 ? "✓ 0.5%" : "0.5%", "slip:50")
          .text(current === 100 ? "✓ 1%" : "1%", "slip:100")
          .row()
          .text(current === 200 ? "✓ 2%" : "2%", "slip:200")
          .text(current === 500 ? "✓ 5%" : "5%", "slip:500")
          .row()
          .text("« Back", "settings"),
      }
    );
  });

  bot.callbackQuery(/^slip:(\d+)$/, async (ctx) => {
    const bps = Number(ctx.match[1]);
    await prisma.user.update({
      where: { telegramId: String(ctx.from.id) },
      data: { slippageBps: bps },
    });
    await ctx.answerCallbackQuery({ text: `Slippage set to ${bps / 100}%` });
    await sendSettings(ctx, env, true);
  });

  bot.callbackQuery("settings:withdraw", async (ctx) => {
    await ctx.answerCallbackQuery();
    const telegramId = String(ctx.from.id);
    const pending = createPendingWithdraw({ telegramId, type: "set_address" });
    await ctx.editMessageText(
      [
        `📤 Default Withdraw Address`,
        ``,
        `Send me an ETH address to set as your default withdraw destination.`,
        ``,
        `This allows quick withdrawals with one tap.`,
        `Send "clear" to remove the current default.`,
      ].join("\n"),
      { reply_markup: new InlineKeyboard().text("🔙 Cancel", `cancel_withdraw:${pending.id}`) }
    );
  });

  bot.callbackQuery("withdraw:quick", async (ctx) => {
    await ctx.answerCallbackQuery();
    const telegramId = String(ctx.from.id);
    const user = await getUserByTelegram(telegramId);
    if (!user?.defaultWithdrawAddress) {
      await ctx.answerCallbackQuery({ text: "No default address set!", show_alert: true });
      return;
    }
    const pending = createPendingWithdraw({ 
      telegramId, 
      type: "quick",
      recipient: user.defaultWithdrawAddress 
    });
    await ctx.editMessageText(
      [
        `💸 Quick Withdraw`,
        ``,
        `To: \`${user.defaultWithdrawAddress}\``,
        ``,
        `Send the amount to withdraw (e.g., "0.1" for 0.1 ETH)`,
      ].join("\n"),
      { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("🔙 Cancel", `cancel_withdraw:${pending.id}`) }
    );
  });

  bot.callbackQuery("withdraw:custom", async (ctx) => {
    await ctx.answerCallbackQuery();
    const telegramId = String(ctx.from.id);
    const pending = createPendingWithdraw({ telegramId, type: "custom" });
    await ctx.editMessageText(
      [
        `💸 Custom Withdraw`,
        ``,
        `Send the recipient address and amount in this format:`,
        `0x123...abc 0.1`,
        ``,
        `(address followed by amount in ETH)`,
      ].join("\n"),
      { reply_markup: new InlineKeyboard().text("🔙 Cancel", `cancel_withdraw:${pending.id}`) }
    );
  });

  bot.callbackQuery(/^cancel_withdraw:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    clearPendingWithdraw(String(ctx.from.id), id);
    await ctx.answerCallbackQuery({ text: "Cancelled" });
    await ctx.deleteMessage();
  });

  bot.callbackQuery("close", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.deleteMessage();
  });

  bot.catch((err) => {
    console.error("Bot error", err);
  });

  return bot;
}

async function sendTokenCard(
  ctx: { reply: (text: string, extra?: object) => Promise<unknown>; from?: { id: number } },
  route: RouteClient,
  address: string,
) {
  const telegramId = String(ctx.from?.id ?? "");
  const lookup = await route.getTokens({ address });
  const token = lookup.tokens[0];
  if (!token) {
    await ctx.reply("Token not found on Route.");
    return;
  }
  let priceLine = "";
  try {
    const quote = await route.getQuote({
      tokenIn: "ETH",
      tokenOut: token.address,
      amountIn: parseEther("0.01").toString(),
    });
    priceLine = `0.01 ETH ≈ ${formatTokenAmount(quote.amountOut, token.decimals)} ${token.symbol} (${feeLine(quote.protocolFeeBps)})`;
  } catch {
    priceLine = "No live quote right now.";
  }

  const pending = createPending({
    telegramId,
    side: "buy",
    token,
    amountIn: parseEther("0.01").toString(),
  });

  const keyboard = new InlineKeyboard();
  BUY_PRESETS_ETH.forEach((amount, i) => {
    keyboard.text(`Buy ${amount} ETH`, `buy:${pending.id}:${i}`);
  });
  keyboard.row();
  SELL_PRESETS_BPS.forEach((bps, i) => {
    keyboard.text(`Sell ${bps / 100}%`, `sell:${pending.id}:${i}`);
  });

  const unverified = token.verified ? "" : "\nUnverified import — not an audit.";
  await ctx.reply(
    [`${token.name} (${token.symbol})`, token.address, priceLine, unverified].filter(Boolean).join("\n"),
    { reply_markup: keyboard },
  );
}

async function showQuote(
  ctx: {
    answerCallbackQuery: (opts?: object) => Promise<true>;
    editMessageText: (text: string, extra?: object) => Promise<unknown>;
    from: { id: number };
  },
  env: Env,
  route: RouteClient,
  pending: { id: number; side: "buy" | "sell"; token: RouteAsset; amountIn: string },
) {
  const user = await getUserByTelegram(String(ctx.from.id));
  const slippage = user?.slippageBps ?? env.DEFAULT_SLIPPAGE_BPS;
  const tokenIn = pending.side === "buy" ? "ETH" : pending.token.address;
  const tokenOut = pending.side === "buy" ? pending.token.address : "ETH";
  try {
    const quote = await route.getQuote({
      tokenIn,
      tokenOut,
      amountIn: pending.amountIn,
    });
    const minOut = computeMinOut(reviewedAmountOut(quote), slippage);
    const inDecimals = pending.side === "buy" ? 18 : pending.token.decimals;
    const outDecimals = pending.side === "buy" ? pending.token.decimals : 18;
    const inLabel = pending.side === "buy" ? "ETH" : pending.token.symbol;
    const outLabel = pending.side === "buy" ? pending.token.symbol : "ETH";
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      [
        pending.side === "buy" ? `Buy ${pending.token.symbol}` : `Sell ${pending.token.symbol}`,
        `In: ${formatTokenAmount(pending.amountIn, inDecimals)} ${inLabel}`,
        `Out ≈ ${formatTokenAmount(quote.amountOut, outDecimals)} ${outLabel}`,
        `Min out (${slippage / 100}% slip): ${formatTokenAmount(minOut, outDecimals)}`,
        feeLine(quote.protocolFeeBps),
        "Tap confirm to re-quote and submit.",
      ].join("\n"),
      {
        reply_markup: new InlineKeyboard()
          .text("Confirm", `go:${pending.id}`)
          .text("Cancel", `no:${pending.id}`),
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await ctx.answerCallbackQuery({ text: message.slice(0, 180) });
  }
}

async function sendHoldings(
  ctx: {
    from?: { id: number };
    reply: (text: string, extra?: object) => Promise<unknown>;
    editMessageText?: (text: string, extra?: object) => Promise<unknown>;
  },
  env: Env,
  route: RouteClient,
  publicClient: ReturnType<typeof createRobinhoodPublicClient>,
  edit = false,
) {
  const telegramId = String(ctx.from?.id ?? "");
  const user = await getUserByTelegram(telegramId);
  if (!user?.wallet) {
    await ctx.reply("No wallet yet. Use /start.");
    return;
  }
  const [eth, listed] = await Promise.all([
    publicClient.getBalance({ address: user.wallet.address as `0x${string}` }),
    route.getTokens({ wallet: user.wallet.address }),
  ]);
  const lines = [
    `💰 Holdings · ${shortAddress(user.wallet.address)}`,
    ``,
    `ETH  ${formatEther(eth)}`,
    ...listed.tokens
      .filter((t) => BigInt(t.balance ?? "0") > 0n)
      .map((t) => `${t.symbol}  ${formatTokenAmount(t.balance ?? "0", t.decimals)}`),
  ];
  if (listed.failed && listed.failed > 0) {
    lines.push(`\n⚠️ ${listed.failed} token read(s) failed. Showing listed assets only.`);
  }
  const extra = { reply_markup: new InlineKeyboard().text("🔄 Refresh", "rfh") };
  if (edit && ctx.editMessageText) {
    await ctx.editMessageText(lines.join("\n"), extra);
    return;
  }
  await ctx.reply(lines.join("\n"), extra);
}

async function sendSettings(
  ctx: {
    from?: { id: number };
    reply: (text: string, extra?: object) => Promise<unknown>;
    editMessageText?: (text: string, extra?: object) => Promise<unknown>;
  },
  env: Env,
  edit = false,
) {
  const telegramId = String(ctx.from?.id ?? "");
  const user = await getUserByTelegram(telegramId);
  if (!user) {
    await ctx.reply("No account yet. Use /start.");
    return;
  }

  const session = activeSession(user);
  const spent = user.wallet ? await spentToday(user.wallet.id) : 0n;
  const remaining = session ? remainingForUser(session, spent) : 0n;

  const lines = [
    `⚙️ Settings`,
    ``,
    `🎯 Slippage: ${user.slippageBps / 100}%`,
    session ? `💸 Daily cap left: ${formatTokenAmount(remaining.toString(), 18)} ETH` : `⚠️ No active session`,
    user.defaultWithdrawAddress 
      ? `📤 Default withdraw: ${shortAddress(user.defaultWithdrawAddress)}`
      : `📤 Default withdraw: Not set`,
    ``,
    `Tap a setting to change it:`,
  ];

  const keyboard = new InlineKeyboard()
    .text("🎯 Slippage", "settings:slippage")
    .row()
    .text("📤 Default Withdraw Address", "settings:withdraw")
    .row()
    .text("🔙 Close", "close");

  const extra = { reply_markup: keyboard };
  if (edit && ctx.editMessageText) {
    await ctx.editMessageText(lines.join("\n"), extra);
    return;
  }
  await ctx.reply(lines.join("\n"), extra);
}
