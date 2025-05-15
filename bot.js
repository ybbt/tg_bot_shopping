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
let pendingEditMessages = {};


function loadData() {
  if (fs.existsSync(DATA_FILE)) {
    shoppingList = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  }
}

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(shoppingList, null, 2));
}

function escapeMarkdown(text) {
  return text.replace(/([\\_*[\]()~`>#+=|{}.!-])/g, '\\$1');
}

function formatDateTime(iso) {
  const d = new Date(iso);
  return `${d.toLocaleDateString('uk-UA')} ${d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}`;
}

function generateId() {
  return Math.random().toString(36).substring(2, 10);
}

function getItemKeyboard(id) {
  const item = shoppingList[id];
  if (!item) return Markup.inlineKeyboard([]);
  const buttons = [[
    Markup.button.callback(item.bought ? '✅ Куплено' : '🛒 Купити', `buy_${id}`)
  ]];
  if (!item.bought) {
    buttons.push([Markup.button.callback('💬 Коментар', `comment_${id}`)]);
    buttons.push([
      Markup.button.callback('✏️ Редагувати', `edit_${id}`),
      Markup.button.callback('🗑 Видалити', `delete_${id}`),
      Markup.button.callback('❌ Коментар', `delcom_${id}`)
    ]);
  }
  return Markup.inlineKeyboard(buttons);
}

async function sendFullList(ctx) {
  if (Object.keys(shoppingList).length === 0) {
    await ctx.reply('📝 Список порожній.');
    return;
  }
  for (const [id, item] of Object.entries(shoppingList)) {
    const comment = item.comment ? `\n💬 _${escapeMarkdown(item.comment)}_` : '';
    const meta = `\n_👤 ${item.author_name}  🕓 ${escapeMarkdown(formatDateTime(item.created_at))}_`;
    const msg = `${item.bought ? '✅' : '⬜️'} *${escapeMarkdown(item.name)}*${comment}${meta}`;
    try {
      const sent = await ctx.replyWithMarkdownV2(msg, getItemKeyboard(id));
      item.message_id = sent.message_id;
      saveData();
    } catch (err) {
      console.error('Помилка при надсиланні:', err);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  const sumMsg = await ctx.reply('⚙️ Дія зі списком', Markup.inlineKeyboard([
    Markup.button.callback('📋 Підбити підсумок', 'summary')
  ]));
  summaryMessageId = sumMsg.message_id;
}

bot.start((ctx) => {
  ctx.reply('Привіт! Надсилай назву продукту, я додам до списку.');
  sendFullList(ctx);
});

bot.on('text', async (ctx) => {
  const text = ctx.message.text.trim();
  const userId = ctx.from.id;

  if (pendingComments[userId]) {
    const id = pendingComments[userId];
    shoppingList[id].comment = text;
    delete pendingComments[userId];
    saveData();

    const item = shoppingList[id];
    const comment = `\n💬 _${escapeMarkdown(text)}_`;
    const meta = `\n_👤 ${item.author_name}  🕓 ${escapeMarkdown(formatDateTime(item.created_at))}_`;
    const msg = `${item.bought ? '✅' : '⬜️'} *${escapeMarkdown(item.name)}*${comment}${meta}`;
    ctx.telegram.editMessageText(ctx.chat.id, item.message_id, null, msg, {
      parse_mode: 'MarkdownV2',
      ...getItemKeyboard(id)
    });

    ctx.deleteMessage(ctx.message.message_id).catch(() => {});
    
    if (pendingCommentMessages[userId]) {
      ctx.deleteMessage(pendingCommentMessages[userId]).catch(() => {});
      delete pendingCommentMessages[userId];
    }
    return;
  }

  if (pendingEdits[userId]) {
    const id = pendingEdits[userId];
    shoppingList[id].name = text;
    delete pendingEdits[userId];
    saveData();

    const item = shoppingList[id];
    const comment = item.comment ? `\n💬 _${escapeMarkdown(item.comment)}_` : '';
    const meta = `\n_👤 ${item.author_name}  🕓 ${escapeMarkdown(formatDateTime(item.created_at))}_`;
    const msg = `${item.bought ? '✅' : '⬜️'} *${escapeMarkdown(text)}*${comment}${meta}`;
    ctx.telegram.editMessageText(ctx.chat.id, item.message_id, null, msg, {
      parse_mode: 'MarkdownV2',
      ...getItemKeyboard(id)
    });
    ctx.deleteMessage(ctx.message.message_id).catch(() => {});

    if (pendingEditMessages[userId]) {
        ctx.deleteMessage(pendingEditMessages[userId]).catch(() => {});
        delete pendingEditMessages[userId];
    }

    return;
  }

  const duplicate = Object.values(shoppingList).find(p => p.name === text);
  if (duplicate) {
    const dupId = Object.keys(shoppingList).find(k => shoppingList[k].name === text);
    return ctx.reply(`"${text}" вже є у списку.`, getItemKeyboard(dupId));
  }

  const id = generateId();
  shoppingList[id] = {
    name: text,
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
  const item = shoppingList[id];
  const comment = '';
  const meta = `\n_👤 ${item.author_name}  🕓 ${escapeMarkdown(formatDateTime(item.created_at))}_`;
  const msg = `⬜️ *${escapeMarkdown(text)}*${comment}${meta}`;
  const sent = await ctx.replyWithMarkdownV2(msg, getItemKeyboard(id));
  item.message_id = sent.message_id;
  saveData();

  const sumMsg = await ctx.reply('⚙️ Дія зі списком', Markup.inlineKeyboard([
    Markup.button.callback('📋 Підбити підсумок', 'summary')
  ]));
  summaryMessageId = sumMsg.message_id;
});

bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data;
  const userId = ctx.from.id;

  if (data === 'summary') {
    for (const item of Object.values(shoppingList)) {
      if (item.message_id) ctx.telegram.deleteMessage(ctx.chat.id, item.message_id).catch(() => {});
      item.message_id = null;
    }
    if (summaryMessageId) ctx.telegram.deleteMessage(ctx.chat.id, summaryMessageId).catch(() => {});
    summaryMessageId = null;

    const summaryText = Object.values(shoppingList).map(i => {
      const c = i.comment ? ` (${i.comment})` : '';
      return `${i.bought ? '✅' : '⬜️'} ${i.name}${c}`;
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

  const [cmd, id] = data.split('_');
  const item = shoppingList[id];
  if (!item) return ctx.answerCbQuery('Продукт не знайдено');

  if (cmd === 'buy') {
    if (!item.bought) {
      item.bought = true;
      item.marked_by = userId;
    } else {
      if (item.marked_by !== userId)
        return ctx.answerCbQuery('🔒 Лише той, хто позначив, може зняти мітку', { show_alert: true });
      item.bought = false;
      item.marked_by = null;
    }
    saveData();

    const comment = item.comment ? `\n💬 _${escapeMarkdown(item.comment)}_` : '';
    const meta = `\n_👤 ${item.author_name}  🕓 ${escapeMarkdown(formatDateTime(item.created_at))}_`;
    const msg = `${item.bought ? '✅' : '⬜️'} *${escapeMarkdown(item.name)}*${comment}${meta}`;
    ctx.telegram.editMessageText(ctx.chat.id, item.message_id, null, msg, {
      parse_mode: 'MarkdownV2',
      ...getItemKeyboard(id)
    });

    return ctx.answerCbQuery(item.bought ? 'Позначено як куплено' : 'Позначку знято');
  }

  if (cmd === 'comment') {
    if (ctx.from.id !== item.author_id)
      return ctx.answerCbQuery('🔒 Лише автор може додати коментар', { show_alert: true });

    pendingComments[userId] = id;
    const msg = await ctx.reply(`✏️ Напиши коментар до "${item.name}":`);
    pendingCommentMessages[userId] = msg.message_id;
    return ctx.answerCbQuery();
  }

  if (cmd === 'delcom') {
    if (ctx.from.id !== item.author_id)
      return ctx.answerCbQuery('🔒 Лише автор може видалити коментар', { show_alert: true });

    item.comment = '';
    saveData();

    const meta = `\n_👤 ${item.author_name}  🕓 ${escapeMarkdown(formatDateTime(item.created_at))}_`;
    const msg = `${item.bought ? '✅' : '⬜️'} *${escapeMarkdown(item.name)}*${meta}`;
    ctx.telegram.editMessageText(ctx.chat.id, item.message_id, null, msg, {
      parse_mode: 'MarkdownV2',
      ...getItemKeyboard(id)
    });
    return ctx.answerCbQuery('Коментар видалено');
  }

  if (cmd === 'delete') {
    if (ctx.from.id !== item.author_id)
      return ctx.answerCbQuery('🔒 Лише автор може видалити товар', { show_alert: true });

    ctx.telegram.deleteMessage(ctx.chat.id, item.message_id).catch(() => {});
    delete shoppingList[id];
    saveData();
    return ctx.answerCbQuery('Продукт видалено');
  }

  if (cmd === 'edit') {
    if (ctx.from.id !== item.author_id)
      return ctx.answerCbQuery('🔒 Лише автор може редагувати', { show_alert: true });

    pendingEdits[userId] = id;
    const prompt = await ctx.reply(`✏️ Введи нову назву для "${item.name}":`);
    pendingEditMessages[userId] = prompt.message_id;

    return ctx.answerCbQuery();
  }
});

loadData();
bot.launch();
console.log('✅ Бот запущено');
