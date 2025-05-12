const { Telegraf, Markup } = require('telegraf');
const fs = require('fs');
require('dotenv').config();

const bot = new Telegraf(process.env.BOT_TOKEN);
const DATA_FILE = 'products.json';

let shoppingList = {};
let summaryMessageId = null;
let pendingComments = {};
let pendingEdits = {};
let pendingCommentMessages = {};

function loadData() {
  if (fs.existsSync(DATA_FILE)) {
    shoppingList = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  }
}

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(shoppingList, null, 2));
}

function escapeMarkdown(text) {
  if (!text) return '';
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

function formatDateTime(iso) {
  const date = new Date(iso);
  const d = date.toLocaleDateString('uk-UA');
  const t = date.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
  return `${d} ${t}`;
}

function getItemKeyboard(item) {
  if (!shoppingList[item]) return Markup.inlineKeyboard([]);
  const isBought = shoppingList[item].bought;
  const buttons = [[Markup.button.callback(isBought ? '✅ Куплено' : '🛒 Купити', `buy_${item}`)]];
  if (!isBought) {
    buttons.push([Markup.button.callback('💬 Коментар', `comment_${item}`)]);
    buttons.push([
      Markup.button.callback('✏️ Редагувати', `edit_${item}`),
      Markup.button.callback('🗑 Видалити', `delete_${item}`),
      Markup.button.callback('❌ Коментар', `delcom_${item}`)
    ]);
  }
  return Markup.inlineKeyboard(buttons);
}

async function sendFullList(ctx) {
  if (Object.keys(shoppingList).length === 0) {
    await ctx.reply('📝 Список порожній.');
    return;
  }
  for (const [item, data] of Object.entries(shoppingList)) {
    const status = data.bought ? '✅' : '⬜️';
    const comment = data.comment ? `\n💬 _${escapeMarkdown(data.comment)}_` : '';
    const meta = `\n_👤 ${data.author_name}  🕓 ${escapeMarkdown(formatDateTime(data.created_at))}_`;
    const message = `${status} *${escapeMarkdown(item)}*${comment}${meta}`;
    try {
      const sent = await ctx.replyWithMarkdownV2(message, getItemKeyboard(item));
      shoppingList[item].message_id = sent.message_id;
      saveData();
    } catch (err) {
      console.error('Помилка при надсиланні:', err);
    }
    await new Promise(res => setTimeout(res, 500));
  }
  const msg = await ctx.reply('⚙️ Дія зі списком', Markup.inlineKeyboard([
    Markup.button.callback('📋 Підбити підсумок', 'summary')
  ]));
  summaryMessageId = msg.message_id;
}

bot.start((ctx) => {
  ctx.reply('Привіт! Надсилай назву продукту, я додам до списку.');
  sendFullList(ctx);
});

bot.on('text', async (ctx) => {
  const text = ctx.message.text.trim();
  const userId = ctx.from.id;

  if (pendingComments[userId]) {
    const item = pendingComments[userId];
    shoppingList[item].comment = text;
    delete pendingComments[userId];
    saveData();

    const data = shoppingList[item];
    const status = data.bought ? '✅' : '⬜️';
    const comment = `\n💬 _${escapeMarkdown(text)}_`;
    const meta = `\n_👤 ${data.author_name}  🕓 ${escapeMarkdown(formatDateTime(data.created_at))}_`;
    const msgId = data.message_id;

    await ctx.telegram.editMessageText(ctx.chat.id, msgId, null,
      `${status} *${escapeMarkdown(item)}*${comment}${meta}`, {
      parse_mode: 'MarkdownV2',
      ...getItemKeyboard(item)
    });

    ctx.deleteMessage(ctx.message.message_id).catch(() => {});
    if (pendingCommentMessages[userId]) {
      ctx.deleteMessage(pendingCommentMessages[userId]).catch(() => {});
      delete pendingCommentMessages[userId];
    }
    return;
  }

  if (pendingEdits[userId]) {
    const oldItem = pendingEdits[userId];
    const newItem = text;
    const data = shoppingList[oldItem];
    delete shoppingList[oldItem];
    shoppingList[newItem] = { ...data };
    delete pendingEdits[userId];
    saveData();

    const status = data.bought ? '✅' : '⬜️';
    const comment = data.comment ? `\n💬 _${escapeMarkdown(data.comment)}_` : '';
    const meta = `\n_👤 ${data.author_name}  🕓 ${escapeMarkdown(formatDateTime(data.created_at))}_`;
    const msgId = data.message_id;

    await ctx.telegram.editMessageText(ctx.chat.id, msgId, null,
      `${status} *${escapeMarkdown(newItem)}*${comment}${meta}`, {
      parse_mode: 'MarkdownV2',
      ...getItemKeyboard(newItem)
    });

    ctx.deleteMessage(ctx.message.message_id).catch(() => {});
    return;
  }

  if (!shoppingList[text]) {
    shoppingList[text] = {
      bought: false,
      comment: '',
      marked_by: null,
      message_id: null,
      author_id: userId,
      author_name: escapeMarkdown(ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name || 'Користувач'),
      created_at: new Date().toISOString()
    };
    saveData();

    if (summaryMessageId) {
      ctx.telegram.deleteMessage(ctx.chat.id, summaryMessageId).catch(() => {});
      summaryMessageId = null;
    }

    ctx.deleteMessage(ctx.message.message_id).catch(() => {});
    const meta = `\n_👤 ${shoppingList[text].author_name}  🕓 ${escapeMarkdown(formatDateTime(shoppingList[text].created_at))}_`;
    const msg = await ctx.replyWithMarkdownV2(`⬜️ *${escapeMarkdown(text)}*${meta}`, getItemKeyboard(text));
    shoppingList[text].message_id = msg.message_id;
    saveData();

    const sumMsg = await ctx.reply('⚙️ Дія зі списком', Markup.inlineKeyboard([
      Markup.button.callback('📋 Підбити підсумок', 'summary')
    ]));
    summaryMessageId = sumMsg.message_id;
  } else {
    ctx.reply(`"${text}" вже є у списку.`, getItemKeyboard(text));
  }
});

bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data;
  const item = data.split('_')[1];
  const userId = ctx.from.id;

  if (data === 'summary') {
    for (const [item, val] of Object.entries(shoppingList)) {
      if (val.message_id) ctx.telegram.deleteMessage(ctx.chat.id, val.message_id).catch(() => {});
      val.message_id = null;
    }

    if (summaryMessageId) {
      ctx.telegram.deleteMessage(ctx.chat.id, summaryMessageId).catch(() => {});
      summaryMessageId = null;
    }

    const summaryText = Object.entries(shoppingList).map(([item, data]) => {
      const comment = data.comment ? ` (${data.comment})` : '';
      return `${data.bought ? '✅' : '⬜️'} ${item}${comment}`;
    }).join('\n');

    await ctx.reply(`📦 Поточний список:\n\n${summaryText}`, Markup.inlineKeyboard([
      [Markup.button.callback('🔁 Перенести не куплені', 'preserve')],
      [Markup.button.callback('🗑 Очистити повністю', 'clear_all')]
    ]));

    return;
  }

  if (data === 'preserve') {
    for (const key in shoppingList) {
      if (shoppingList[key].bought) {
        delete shoppingList[key];
      } else {
        shoppingList[key].bought = false;
        shoppingList[key].marked_by = null;
        shoppingList[key].message_id = null;
      }
    }
    saveData();
    await ctx.reply('🔄 Не куплені продукти перенесено до нового списку:');
    await sendFullList(ctx);
    return;
  }

  if (data === 'clear_all') {
    shoppingList = {};
    saveData();
    if (summaryMessageId) {
      ctx.telegram.deleteMessage(ctx.chat.id, summaryMessageId).catch(() => {});
      summaryMessageId = null;
    }
    await ctx.reply('🗑 Список очищено повністю.');
    return;
  }

  if (!shoppingList[item]) return ctx.answerCbQuery('Продукт не знайдено');

  const prod = shoppingList[item];

  if (data.startsWith('buy_')) {
    if (!prod.bought) {
      prod.bought = true;
      prod.marked_by = userId;
    } else {
      if (prod.marked_by !== userId)
        return ctx.answerCbQuery('🔒 Лише той, хто позначив, може зняти мітку', { show_alert: true });
      prod.bought = false;
      prod.marked_by = null;
    }

    const status = prod.bought ? '✅' : '⬜️';
    const comment = prod.comment ? `\n💬 _${escapeMarkdown(prod.comment)}_` : '';
    const meta = `\n_👤 ${prod.author_name}  🕓 ${escapeMarkdown(formatDateTime(prod.created_at))}_`;

    ctx.telegram.editMessageText(ctx.chat.id, prod.message_id, null,
      `${status} *${escapeMarkdown(item)}*${comment}${meta}`, {
      parse_mode: 'MarkdownV2',
      ...getItemKeyboard(item)
    }).catch(console.error);
    saveData();
    return ctx.answerCbQuery(prod.bought ? 'Позначено як куплено' : 'Позначку знято');
  }

  if (data.startsWith('comment_')) {
    if (ctx.from.id !== prod.author_id)
      return ctx.answerCbQuery('🔒 Лише автор може додати коментар', { show_alert: true });
    pendingComments[userId] = item;
    const msg = await ctx.reply(`✏️ Напиши коментар до "${item}":`);
    pendingCommentMessages[userId] = msg.message_id;
    return ctx.answerCbQuery();
  }

  if (data.startsWith('delcom_')) {
    if (ctx.from.id !== prod.author_id)
      return ctx.answerCbQuery('🔒 Лише автор може видалити коментар', { show_alert: true });
    prod.comment = '';
    saveData();

    const status = prod.bought ? '✅' : '⬜️';
    const meta = `\n_👤 ${prod.author_name}  🕓 ${escapeMarkdown(formatDateTime(prod.created_at))}_`;

    ctx.telegram.editMessageText(ctx.chat.id, prod.message_id, null,
      `${status} *${escapeMarkdown(item)}*${meta}`, {
      parse_mode: 'MarkdownV2',
      ...getItemKeyboard(item)
    }).catch(console.error);
    return ctx.answerCbQuery('Коментар видалено');
  }

  if (data.startsWith('delete_')) {
    if (ctx.from.id !== prod.author_id)
      return ctx.answerCbQuery('🔒 Лише автор може видалити товар', { show_alert: true });

    ctx.telegram.deleteMessage(ctx.chat.id, prod.message_id).catch(() => {});
    delete shoppingList[item];
    saveData();
    return ctx.answerCbQuery('Продукт видалено');
  }

  if (data.startsWith('edit_')) {
    if (ctx.from.id !== prod.author_id)
      return ctx.answerCbQuery('🔒 Лише автор може редагувати', { show_alert: true });

    pendingEdits[userId] = item;
    ctx.reply(`✏️ Введи нову назву для "${item}":`);
    return ctx.answerCbQuery();
  }
});

loadData();
bot.launch();
console.log('✅ Бот запущено');
