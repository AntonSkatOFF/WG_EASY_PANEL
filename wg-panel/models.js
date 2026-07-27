require('dotenv').config();

const { Sequelize } = require('sequelize');

// Initialize SQLite database
const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: './database.sqlite',
  logging: false
});

// User model - stores Telegram users and their access info
const User = sequelize.define('User', {
  telegramId: {
    type: Sequelize.STRING,
    allowNull: false,
    unique: true
  },
  username: {
    type: Sequelize.STRING,
    allowNull: true
  },
  firstName: {
    type: Sequelize.STRING,
    allowNull: true
  },
  lastName: {
    type: Sequelize.STRING,
    allowNull: true
  },
  role: {
    type: Sequelize.ENUM('admin', 'client', 'pending'),
    defaultValue: 'pending'
  },
  clientName: {
    type: Sequelize.STRING,
    allowNull: true,
    comment: 'Associated WireGuard client name'
  },
  clientId: {
    type: Sequelize.INTEGER,
    allowNull: true,
    comment: 'Associated WireGuard client ID from wg-easy'
  }
});

// Request model - stores pending requests from new users
const Request = sequelize.define('Request', {
  telegramId: {
    type: Sequelize.STRING,
    allowNull: false
  },
  username: {
    type: Sequelize.STRING,
    allowNull: true
  },
  requestedClientName: {
    type: Sequelize.STRING,
    allowNull: true
  },
  status: {
    type: Sequelize.ENUM('pending', 'approved', 'rejected'),
    defaultValue: 'pending'
  },
  adminNote: {
    type: Sequelize.TEXT,
    allowNull: true
  }
});

// Session model for express-session with Sequelize
const Session = sequelize.define('Session', {
  sid: {
    type: Sequelize.STRING,
    primaryKey: true
  },
  data: {
    type: Sequelize.TEXT,
    allowNull: false
  },
  expires: {
    type: Sequelize.DATE,
    allowNull: false
  }
});

// Relationships
User.hasMany(Request, { foreignKey: 'telegramId', as: 'requests' });
Request.belongsTo(User, { foreignKey: 'telegramId' });

module.exports = { sequelize, User, Request, Session };
