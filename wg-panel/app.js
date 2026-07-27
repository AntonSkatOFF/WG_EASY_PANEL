require('dotenv').config();
const express = require('express');
const session = require('express-session');
const SequelizeStore = require('connect-session-sequelize')(session.Store);
const path = require('path');

const { sequelize, Session: SessionModel, User, Request } = require('./models');
const wgApi = require('./wg-api');
const telegramService = require('./telegram-service');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-this-secret';

// Initialize session store
const sessionStore = new SequelizeStore({
  db: sequelize,
  tableName: 'Sessions'
});

// Middleware
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Sync session store
sessionStore.sync();

// Auth middleware
const requireAuth = (req, res, next) => {
  if (!req.session.telegramId) {
    return res.redirect('/login');
  }
  next();
};

const requireAdmin = async (req, res, next) => {
  if (!req.session.telegramId) {
    return res.redirect('/login');
  }
  
  const user = await User.findOne({ where: { telegramId: req.session.telegramId.toString() } });
  if (!user || user.role !== 'admin') {
    return res.status(403).send('Доступ запрещен');
  }
  next();
};

// Routes

// Home - redirect to login or dashboard
app.get('/', async (req, res) => {
  if (req.session.telegramId) {
    const user = await User.findOne({ where: { telegramId: req.session.telegramId.toString() } });
    if (user) {
      if (user.role === 'admin') {
        return res.redirect('/admin/dashboard');
      } else if (user.role === 'client') {
        return res.redirect('/client/dashboard');
      }
    }
    return res.redirect('/pending');
  }
  res.redirect('/login');
});

// Login page with Telegram widget
app.get('/login', (req, res) => {
  res.render('login', { 
    botUsername: process.env.TELEGRAM_BOT_USERNAME || '',
    error: null 
  });
});

// Telegram auth callback
app.post('/auth/telegram', async (req, res) => {
  const { id, username, first_name, last_name, hash } = req.body;
  
  if (!id || !hash) {
    return res.render('login', { error: 'Неверные данные аутентификации' });
  }
  
  try {
    // Find or create user
    let [user, created] = await User.findOrCreate({
      where: { telegramId: id.toString() },
      defaults: {
        telegramId: id.toString(),
        username,
        firstName: first_name,
        lastName: last_name,
        role: 'pending'
      }
    });
    
    if (!created) {
      // Update user info
      await user.update({ username, firstName: first_name, lastName: last_name });
    }
    
    // Check if admin
    if (id.toString() === process.env.TELEGRAM_ADMIN_ID) {
      await user.update({ role: 'admin' });
    }
    
    // Set session
    req.session.telegramId = id.toString();
    req.session.username = username;
    
    // Redirect based on role
    if (user.role === 'admin') {
      return res.redirect('/admin/dashboard');
    } else if (user.role === 'client') {
      return res.redirect('/client/dashboard');
    } else {
      return res.redirect('/pending');
    }
  } catch (error) {
    console.error('Auth error:', error);
    res.render('login', { error: 'Ошибка аутентификации' });
  }
});

// Pending page for users waiting approval
app.get('/pending', requireAuth, async (req, res) => {
  const request = await Request.findOne({
    where: { telegramId: req.session.telegramId, status: 'pending' },
    order: [['createdAt', 'DESC']]
  });
  
  res.render('pending', { existingRequest: !!request });
});

// Create request
app.post('/request', requireAuth, async (req, res) => {
  const { clientName } = req.body;
  
  try {
    await Request.create({
      telegramId: req.session.telegramId,
      username: req.session.username,
      requestedClientName: clientName,
      status: 'pending'
    });
    
    // Update user role to pending
    await User.update({ role: 'pending' }, { where: { telegramId: req.session.telegramId } });
    
    res.redirect('/pending');
  } catch (error) {
    res.render('pending', { error: 'Ошибка создания заявки', existingRequest: true });
  }
});

// Admin Dashboard
app.get('/admin/dashboard', requireAdmin, async (req, res) => {
  try {
    const clients = await wgApi.getClients();
    const pendingRequests = await Request.findAll({
      where: { status: 'pending' },
      include: [{ model: User }]
    });
    
    const stats = {
      totalClients: clients.length,
      activeClients: clients.filter(c => c.enabled).length,
      pendingRequests: pendingRequests.length
    };
    
    res.render('admin/dashboard', { clients, pendingRequests, stats });
  } catch (error) {
    res.render('admin/dashboard', { 
      clients: [], 
      pendingRequests: [], 
      stats: { totalClients: 0, activeClients: 0, pendingRequests: 0 },
      error: 'Ошибка подключения к wg-easy' 
    });
  }
});

// Admin - Approve request
app.post('/admin/approve/:telegramId', requireAdmin, async (req, res) => {
  const { telegramId } = req.params;
  const { clientName } = req.body;
  
  try {
    // Create client in wg-easy
    const clientData = await wgApi.createClient(clientName || `user_${telegramId}`);
    
    // Update user
    await User.update(
      { role: 'client', clientName, clientId: clientData.id },
      { where: { telegramId } }
    );
    
    // Update request
    await Request.update(
      { status: 'approved' },
      { where: { telegramId, status: 'pending' } }
    );
    
    res.redirect('/admin/dashboard');
  } catch (error) {
    res.redirect('/admin/dashboard?error=' + encodeURIComponent(error.message));
  }
});

// Admin - Reject request
app.post('/admin/reject/:telegramId', requireAdmin, async (req, res) => {
  const { telegramId } = req.params;
  
  await Request.update(
    { status: 'rejected' },
    { where: { telegramId, status: 'pending' } }
  );
  
  res.redirect('/admin/dashboard');
});

// Admin - Delete client
app.post('/admin/delete/:clientId', requireAdmin, async (req, res) => {
  const { clientId } = req.params;
  
  try {
    await wgApi.deleteClient(parseInt(clientId));
    await User.update(
      { role: 'pending', clientName: null, clientId: null },
      { where: { clientId: parseInt(clientId) } }
    );
    res.redirect('/admin/dashboard');
  } catch (error) {
    res.redirect('/admin/dashboard?error=' + encodeURIComponent(error.message));
  }
});

// Admin - Toggle client enabled
app.post('/admin/toggle/:clientId', requireAdmin, async (req, res) => {
  const { clientId } = req.params;
  
  try {
    const client = await wgApi.getClient(parseInt(clientId));
    if (client.enabled) {
      await wgApi.disableClient(parseInt(clientId));
    } else {
      await wgApi.enableClient(parseInt(clientId));
    }
    res.redirect('/admin/dashboard');
  } catch (error) {
    res.redirect('/admin/dashboard?error=' + encodeURIComponent(error.message));
  }
});

// Client Dashboard
app.get('/client/dashboard', requireAuth, async (req, res) => {
  const user = await User.findOne({ where: { telegramId: req.session.telegramId } });
  
  if (!user || !user.clientId) {
    return res.redirect('/pending');
  }
  
  try {
    const client = await wgApi.getClient(user.clientId);
    const qrCode = await wgApi.getClientQRCode(user.clientId);
    
    res.render('client/dashboard', { client, qrCode, user });
  } catch (error) {
    res.render('client/dashboard', { error: 'Ошибка получения данных клиента' });
  }
});

// Client - Download config
app.get('/client/config/:clientId', requireAuth, async (req, res) => {
  const { clientId } = req.params;
  const user = await User.findOne({ where: { telegramId: req.session.telegramId } });
  
  if (!user || user.clientId !== parseInt(clientId)) {
    return res.status(403).send('Доступ запрещен');
  }
  
  try {
    const config = await wgApi.getClientConfig(parseInt(clientId));
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="${user.clientName || 'wireguard'}.conf"`);
    res.send(config);
  } catch (error) {
    res.status(500).send('Ошибка получения конфигурации');
  }
});

// Logout
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// Initialize database and start server
async function start() {
  try {
    await sequelize.sync();
    console.log('Database initialized');
    
    app.listen(PORT, () => {
      console.log(`WG Panel running on port ${PORT}`);
      console.log(`Open http://localhost:${PORT} in your browser`);
    });
  } catch (error) {
    console.error('Failed to start:', error);
    process.exit(1);
  }
}

start();
