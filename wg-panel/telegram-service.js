require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const { User, Request } = require('./models');
const wgApi = require('./wg-api');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

// Store pending auth requests temporarily
const pendingAuths = new Map();

class TelegramService {
  constructor() {
    this.bot = null;
    if (TELEGRAM_BOT_TOKEN) {
      this.bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
      this.setupHandlers();
      console.log('Telegram bot initialized');
    } else {
      console.warn('TELEGRAM_BOT_TOKEN not set, Telegram auth disabled');
    }
  }

  setupHandlers() {
    // Handle /start command
    this.bot.onText(/\/start/, async (msg) => {
      const chatId = msg.chat.id;
      const user = msg.from;

      try {
        // Check if user exists in database
        let dbUser = await User.findOne({ where: { telegramId: chatId.toString() } });

        if (dbUser) {
          // User exists
          if (dbUser.role === 'admin') {
            await this.sendAdminMenu(chatId);
          } else if (dbUser.role === 'client') {
            await this.sendClientMenu(chatId, dbUser);
          } else {
            await this.bot.sendMessage(chatId, 'Ваша заявка находится на рассмотрении. Ожидайте подтверждения от администратора.');
          }
        } else {
          // New user - offer to create request
          const keyboard = {
            reply_markup: {
              inline_keyboard: [[
                { text: '📝 Создать заявку', callback_data: 'create_request' }
              ]]
            }
          };
          await this.bot.sendMessage(
            chatId,
            `Привет, ${user.first_name}! Вы новый пользователь. Нажмите кнопку ниже, чтобы создать заявку на получение доступа.`,
            keyboard
          );
        }
      } catch (error) {
        console.error('Error handling /start:', error);
        await this.bot.sendMessage(chatId, 'Произошла ошибка. Попробуйте позже.');
      }
    });

    // Handle callback queries
    this.bot.on('callback_query', async (query) => {
      const chatId = query.message.chat.id;
      const data = query.data;

      try {
        if (data === 'create_request') {
          await this.handleCreateRequest(chatId);
        } else if (data.startsWith('approve_request_')) {
          const requestId = data.replace('approve_request_', '');
          await this.handleApproveRequest(chatId, requestId);
        } else if (data.startsWith('reject_request_')) {
          const requestId = data.replace('reject_request_', '');
          await this.handleRejectRequest(chatId, requestId);
        } else if (data === 'show_clients') {
          await this.showClientsList(chatId);
        } else if (data.startsWith('delete_client_')) {
          const clientId = data.replace('delete_client_', '');
          await this.handleDeleteClient(chatId, parseInt(clientId));
        } else if (data === 'my_config') {
          await this.sendMyConfig(chatId, query.from.id);
        } else if (data === 'refresh_status') {
          await this.sendClientMenu(chatId, query.from.id);
        }
      } catch (error) {
        console.error('Error handling callback:', error);
        await this.bot.sendMessage(chatId, 'Произошла ошибка. Попробуйте позже.');
      }

      await this.bot.answerCallbackQuery(query.id);
    });
  }

  async handleCreateRequest(chatId) {
    const user = await this.bot.getChat(chatId);
    
    const keyboard = {
      reply_markup: {
        force_reply: true,
        input_field_placeholder: 'Введите желаемое имя для конфига'
      }
    };
    
    const sentMsg = await this.bot.sendMessage(
      chatId,
      'Введите желаемое имя для вашего WireGuard конфига (например: iphone, laptop):',
      keyboard
    );

    // Store pending state
    pendingAuths.set(chatId, { type: 'request_name', messageId: sentMsg.message_id });

    // Handle reply
    const replyHandler = async (reply) => {
      if (reply.chat.id !== chatId || !reply.reply_to_message || reply.reply_to_message.message_id !== sentMsg.message_id) {
        return;
      }

      const clientName = reply.text.trim();
      
      // Create request in database
      await Request.create({
        telegramId: chatId.toString(),
        username: user.username || 'unknown',
        requestedClientName: clientName,
        status: 'pending'
      });

      // Also create/update user record
      await User.findOrCreate({
        where: { telegramId: chatId.toString() },
        defaults: {
          telegramId: chatId.toString(),
          username: user.username,
          firstName: user.first_name,
          lastName: user.last_name,
          role: 'pending'
        }
      });

      pendingAuths.delete(chatId);
      this.bot.removeListener('message', replyHandler);

      // Notify admin
      await this.notifyAdminNewRequest(chatId, user, clientName);

      await this.bot.sendMessage(
        chatId,
        '✅ Ваша заявка создана и отправлена администратору. Вы получите уведомление после рассмотрения.'
      );
    };

    this.bot.on('message', replyHandler);
  }

  async notifyAdminNewRequest(chatId, user, clientName) {
    if (!TELEGRAM_ADMIN_ID) return;

    const message = `🔔 Новая заявка на доступ\n\n` +
      `Пользователь: ${user.first_name} ${user.last_name || ''}\n` +
      `Username: @${user.username || 'нет'}\n` +
      `Telegram ID: ${chatId}\n` +
      `Запрошенное имя конфига: ${clientName}`;

    const keyboard = {
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Одобрить', callback_data: `approve_request_${chatId}` },
          { text: '❌ Отклонить', callback_data: `reject_request_${chatId}` }
        ]]
      }
    };

    await this.bot.sendMessage(TELEGRAM_ADMIN_ID, message, keyboard);
  }

  async handleApproveRequest(adminChatId, requesterId) {
    const requesterIdStr = requesterId.toString();
    
    // Get the request
    const request = await Request.findOne({
      where: { telegramId: requesterIdStr, status: 'pending' },
      order: [['createdAt', 'DESC']]
    });

    if (!request) {
      await this.bot.sendMessage(adminChatId, 'Заявка не найдена или уже обработана.');
      return;
    }

    // Create client in wg-easy
    try {
      const clientData = await wgApi.createClient(request.requestedClientName || `user_${requesterId}`);
      const clientId = clientData.id;

      // Update user record
      await User.update(
        { 
          role: 'client',
          clientName: request.requestedClientName,
          clientId: clientId
        },
        { where: { telegramId: requesterIdStr } }
      );

      // Update request status
      await request.update({ status: 'approved' });

      // Notify requester
      await this.bot.sendMessage(
        requesterIdStr,
        '✅ Ваша заявка одобрена! Теперь вы можете пользоваться VPN.\n\n' +
        'Нажмите /start для доступа к личному кабинету.'
      );

      await this.bot.sendMessage(adminChatId, `✅ Заявка одобрена. Клиент "${request.requestedClientName}" создан.`);
    } catch (error) {
      console.error('Error approving request:', error);
      await this.bot.sendMessage(adminChatId, '❌ Ошибка при создании клиента в wg-easy: ' + error.message);
    }
  }

  async handleRejectRequest(adminChatId, requesterId) {
    const requesterIdStr = requesterId.toString();
    
    await Request.update(
      { status: 'rejected' },
      { where: { telegramId: requesterIdStr, status: 'pending' } }
    );

    await this.bot.sendMessage(
      requesterIdStr,
      '❌ Ваша заявка была отклонена администратором.'
    );

    await this.bot.sendMessage(adminChatId, '❌ Заявка отклонена.');
  }

  async sendAdminMenu(chatId) {
    const keyboard = {
      reply_markup: {
        inline_keyboard: [
          [{ text: '👥 Все клиенты', callback_data: 'show_clients' }],
          [{ text: '🔄 Обновить статус', callback_data: 'refresh_status' }]
        ]
      }
    };

    await this.bot.sendMessage(
      chatId,
      '👨‍💼 Панель Администратора\n\nВыберите действие:',
      keyboard
    );
  }

  async sendClientMenu(chatId, userOrId) {
    let user;
    if (typeof userOrId === 'number') {
      user = await User.findOne({ where: { telegramId: userOrId.toString() } });
    } else {
      user = userOrId;
    }

    if (!user || !user.clientId) {
      await this.bot.sendMessage(chatId, 'Конфигурация не найдена. Обратитесь к администратору.');
      return;
    }

    try {
      // Get client info from wg-easy
      const clients = await wgApi.getClients();
      const client = clients.find(c => c.id === user.clientId);

      if (!client) {
        await this.bot.sendMessage(chatId, 'Клиент не найден в wg-easy. Обратитесь к администратору.');
        return;
      }

      const status = client.enabled ? '🟢 Активен' : '🔴 Отключен';
      
      const message = `👤 Личный кабинет\n\n` +
        `Имя конфига: ${client.name}\n` +
        `Статус: ${status}\n` +
        `Создан: ${new Date(client.createdAt).toLocaleDateString('ru-RU')}\n` +
        `Последнее подключение: ${client.latestHandshakeAt ? new Date(client.latestHandshakeAt).toLocaleString('ru-RU') : 'Не подключался'}`;

      const keyboard = {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📄 Скачать конфиг', callback_data: 'download_config' }],
            [{ text: '📱 QR-код', callback_data: 'show_qr' }],
            [{ text: '🔄 Обновить', callback_data: 'refresh_status' }]
          ]
        }
      };

      await this.bot.sendMessage(chatId, message, keyboard);
    } catch (error) {
      console.error('Error sending client menu:', error);
      await this.bot.sendMessage(chatId, 'Ошибка получения данных. Проверьте соединение с wg-easy.');
    }
  }

  async showClientsList(chatId) {
    try {
      const clients = await wgApi.getClients();
      
      let message = '👥 Список всех клиентов:\n\n';
      const keyboardRows = [];

      clients.forEach(client => {
        const status = client.enabled ? '🟢' : '🔴';
        message += `${status} ${client.name} (ID: ${client.id})\n`;
        keyboardRows.push([{ 
          text: `🗑️ Удалить ${client.name}`, 
          callback_data: `delete_client_${client.id}` 
        }]);
      });

      const keyboard = {
        reply_markup: {
          inline_keyboard: keyboardRows
        }
      };

      await this.bot.sendMessage(chatId, message, keyboard);
    } catch (error) {
      console.error('Error showing clients:', error);
      await this.bot.sendMessage(chatId, 'Ошибка получения списка клиентов.');
    }
  }

  async handleDeleteClient(chatId, clientId) {
    try {
      await wgApi.deleteClient(clientId);
      
      // Update user record if exists
      await User.update(
        { role: 'pending', clientName: null, clientId: null },
        { where: { clientId: clientId } }
      );

      await this.bot.sendMessage(chatId, `✅ Клиент удален.`);
      await this.showClientsList(chatId);
    } catch (error) {
      console.error('Error deleting client:', error);
      await this.bot.sendMessage(chatId, '❌ Ошибка при удалении клиента: ' + error.message);
    }
  }

  async sendMyConfig(chatId, telegramId) {
    const user = await User.findOne({ where: { telegramId: telegramId.toString() } });
    
    if (!user || !user.clientId) {
      await this.bot.sendMessage(chatId, 'Конфигурация не найдена.');
      return;
    }

    try {
      const config = await wgApi.getClientConfig(user.clientId);
      
      // Send as file
      await this.bot.sendDocument(
        chatId,
        Buffer.from(config),
        { filename: `${user.clientName || 'wireguard'}.conf` }
      );
    } catch (error) {
      console.error('Error sending config:', error);
      await this.bot.sendMessage(chatId, 'Ошибка получения конфигурации.');
    }
  }

  // Verify user and return role
  async verifyUser(telegramId) {
    const user = await User.findOne({ where: { telegramId: telegramId.toString() } });
    
    if (!user) {
      return { found: false, role: null };
    }

    if (telegramId.toString() === TELEGRAM_ADMIN_ID) {
      await User.update({ role: 'admin' }, { where: { telegramId: telegramId.toString() } });
      return { found: true, role: 'admin', user };
    }

    return { found: true, role: user.role, user };
  }
}

module.exports = new TelegramService();
