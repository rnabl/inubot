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
import { clearPending, createPending, getPending, updatePending } from "./pending.js";
import { signCeremonyToken } from "./ceremony-token.js";
import { executeSwap, remainingForUser, spentToday } from "./swap.js";
import { activeSession, ensureUser, getUserByTelegram } from "./users.js";

function ceremonyUrl(env: Env, telegramId: string): string {
  const token = signCeremonyToken(telegramId, env.CEREMONY_SECRET);
  const url = new URL(env.CEREMONY_URL);
  url.searchParams.set("t", token);
  return url.toString();
}

function helpText(): string {
  return [
    "InuBot — Robinhood Chain swaps via Route.",
    "",
    "/start — create wallet (Face ID in Safari, one time)",
    "/wallet — address, ETH, deposit QR",
    "/holdings — token balances",
    "/settings — slippage & preferences",
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
    ``,
    `Tap a setting to change it:`,
  ];

  const keyboard = new InlineKeyboard()
    .text("🎯 Slippage", "settings:slippage")
    .row()
    .text("🔙 Close", "close");

  const extra = { reply_markup: keyboard };
  if (edit && ctx.editMessageText) {
    await ctx.editMessageText(lines.join("\n"), extra);
    return;
  }
  await ctx.reply(lines.join("\n"), extra);
}
